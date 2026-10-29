"""Spatial layer builder: slow pattern per street segment (docs/scoring.md §3).

Mobile samples are matched to the nearest segment within 20 m (the ATRAI rule)
and compared with the city level at the hour they were taken. Segments without
samples get an inverse-distance estimate from stationary boxes (§3.4).
Coordinates are WGS84 [longitude, latitude]; distances use a local
equirectangular projection, accurate to well below a metre at 20 m.
"""

import math
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from itertools import pairwise
from statistics import fmean, median
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.processing.temporal import floor_hour
from app.schemas.observations import Observation, Phenomenon
from app.scoring.profiles import KAPPA
from app.scoring.score import idw_ratio, shrink_anomaly, shrink_ratio

EARTH_RADIUS_M = 6_371_008.8
MATCH_DISTANCE_M = 20.0
# A PM reading of 0 means "below detection", not a street with no particles.
MIN_RATIO = 0.1

Point = tuple[float, float]


class Segment(BaseModel):
    """One street segment with optional static ATRAI attributes (§3.3)."""

    model_config = ConfigDict(frozen=True)

    segment_id: str = Field(min_length=1)
    coordinates: tuple[Point, ...] = Field(min_length=2)
    roughness: float | None = Field(default=None, ge=0, le=1)
    overtaking_share: float | None = Field(default=None, ge=0, le=1)
    flow: float | None = Field(default=None, ge=0, le=1)

    @property
    def length_m(self) -> float:
        return sum(distance_m(a, b) for a, b in pairwise(self.coordinates))

    @property
    def center(self) -> Point:
        return (
            fmean(lon for lon, _ in self.coordinates),
            fmean(lat for _, lat in self.coordinates),
        )


def distance_m(a: Point, b: Point) -> float:
    """Haversine distance between two [lon, lat] points."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def point_to_line_m(point: Point, line: Sequence[Point]) -> float:
    """Shortest distance from a point to a polyline, in metres."""
    scale_x = math.radians(1) * EARTH_RADIUS_M * math.cos(math.radians(point[1]))
    scale_y = math.radians(1) * EARTH_RADIUS_M

    def project(p: Point) -> Point:
        return ((p[0] - point[0]) * scale_x, (p[1] - point[1]) * scale_y)

    best = math.inf
    for start, end in pairwise(line):
        (ax, ay), (bx, by) = project(start), project(end)
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length2))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


class SegmentIndex:
    """Grid index so each sample is compared only with nearby segments."""

    def __init__(self, segments: Iterable[Segment], max_distance_m: float = MATCH_DISTANCE_M):
        self.max_distance_m = max_distance_m
        self.cell_deg = 0.002  # about 150-220 m at Heilbronn's latitude
        self.cells: dict[tuple[int, int], list[Segment]] = defaultdict(list)
        for segment in segments:
            lons = [lon for lon, _ in segment.coordinates]
            lats = [lat for _, lat in segment.coordinates]
            pad_lat = max_distance_m / (math.radians(1) * EARTH_RADIUS_M)
            pad_lon = pad_lat / math.cos(math.radians(fmean(lats)))
            for cx in range(self._cell(min(lons) - pad_lon), self._cell(max(lons) + pad_lon) + 1):
                for cy in range(
                    self._cell(min(lats) - pad_lat), self._cell(max(lats) + pad_lat) + 1
                ):
                    self.cells[(cx, cy)].append(segment)

    def _cell(self, degrees: float) -> int:
        return math.floor(degrees / self.cell_deg)

    def nearest(
        self, point: Point, *, require_unique: bool = False
    ) -> tuple[Segment, float] | None:
        candidates = self.cells.get((self._cell(point[0]), self._cell(point[1])), [])
        best = min(
            ((segment, point_to_line_m(point, segment.coordinates)) for segment in candidates),
            key=lambda pair: pair[1],
            default=None,
        )
        if best is None or best[1] > self.max_distance_m:
            return None
        if require_unique and any(
            segment.segment_id != best[0].segment_id
            and abs(point_to_line_m(point, segment.coordinates) - best[1]) <= 0.01
            for segment in candidates
        ):
            return None
        return best


@dataclass(frozen=True)
class SegmentLayer:
    segment_id: str
    pm_ratio: float
    pm_samples: int
    pm_source: Literal["samples", "idw", "none"]
    heat_anomaly: float | None
    heat_samples: int
    roughness: float | None
    overtaking_share: float | None
    flow: float | None


@dataclass
class SpatialReport:
    layers: dict[str, SegmentLayer]
    matched: int = 0
    unmatched: int = 0
    without_level: int = 0
    skipped: dict[str, int] = field(default_factory=dict)


def build_layers(
    segments: Sequence[Segment],
    observations: Iterable[Observation],
    pm_levels: Mapping[datetime, float],
    temperature_reference: Mapping[datetime, float] | None = None,
    max_distance_m: float = MATCH_DISTANCE_M,
    kappa: float = KAPPA,
    *,
    require_unique_match: bool = False,
) -> SpatialReport:
    """§3.1 PM ratio r_i = x_i / L(t_i) and §3.2 anomaly T_i - T_ref(t_i) per segment,
    median and shrinkage. Uses usable mobile PM2.5 and temperature measurements;
    humid PM is already excluded by its QC flag."""
    index = SegmentIndex(segments, max_distance_m)
    temperature_reference = temperature_reference or {}
    ratios: dict[str, list[float]] = defaultdict(list)
    anomalies: dict[str, list[float]] = defaultdict(list)
    report = SpatialReport(layers={})

    for obs in observations:
        if not (obs.platform == "mobile" and obs.kind == "observation" and obs.usable):
            continue
        if obs.phenomenon == Phenomenon.PM2_5:
            reference, bucket = pm_levels, ratios
        elif obs.phenomenon == Phenomenon.TEMPERATURE:
            reference, bucket = temperature_reference, anomalies
        else:
            continue
        level = reference.get(floor_hour(obs.observed_at))
        if level is None or (bucket is ratios and level <= 0):
            report.without_level += 1
            continue
        match = index.nearest((obs.longitude, obs.latitude), require_unique=require_unique_match)
        if match is None:
            report.unmatched += 1
            continue
        report.matched += 1
        segment_id = match[0].segment_id
        if bucket is ratios:
            ratios[segment_id].append(max(obs.value / level, MIN_RATIO))
        else:
            anomalies[segment_id].append(obs.value - level)

    for segment in segments:
        pm = ratios.get(segment.segment_id, [])
        heat = anomalies.get(segment.segment_id, [])
        report.layers[segment.segment_id] = SegmentLayer(
            segment_id=segment.segment_id,
            pm_ratio=shrink_ratio(median(pm), len(pm), kappa) if pm else 1.0,
            pm_samples=len(pm),
            pm_source="samples" if pm else "none",
            heat_anomaly=shrink_anomaly(median(heat), len(heat), kappa) if heat else None,
            heat_samples=len(heat),
            roughness=segment.roughness,
            overtaking_share=segment.overtaking_share,
            flow=segment.flow,
        )
    return report


@dataclass(frozen=True)
class StationRatio:
    station_id: str
    location: Point
    ratio: float
    hours: int


def station_ratios(
    observations: Iterable[Observation],
    pm_levels: Mapping[datetime, float],
    min_hours: int = 24,
) -> list[StationRatio]:
    """§3.4 R_j = mean of the box's hourly PM2.5 / mean city level over the same hours."""
    hourly: dict[tuple[str, str], dict[datetime, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    locations: dict[tuple[str, str], Point] = {}
    for obs in observations:
        if (
            obs.phenomenon == Phenomenon.PM2_5
            and obs.platform == "stationary"
            and obs.kind == "observation"
            and obs.usable
        ):
            identity = (obs.source, obs.station_id)
            hourly[identity][floor_hour(obs.observed_at)].append(obs.value)
            locations[identity] = (obs.longitude, obs.latitude)
    result = []
    for station, hours in sorted(hourly.items()):
        shared = [hour for hour in hours if hour in pm_levels]
        mean_level = fmean(pm_levels[hour] for hour in shared) if shared else 0
        if len(shared) < min_hours or mean_level <= 0:
            continue
        mean_station = fmean(fmean(hours[hour]) for hour in shared)
        result.append(
            StationRatio(station[1], locations[station], mean_station / mean_level, len(shared))
        )
    return result


def fill_uncovered(
    report: SpatialReport,
    segments: Sequence[Segment],
    stations: Sequence[StationRatio],
    *,
    max_distance_m: float = math.inf,
) -> SpatialReport:
    """Give segments without PM samples an IDW ratio from the station ratios."""
    for segment in segments:
        layer = report.layers[segment.segment_id]
        if layer.pm_samples > 0 or not stations:
            continue
        nearby = [
            (distance_m(segment.center, s.location), s.ratio)
            for s in stations
            if distance_m(segment.center, s.location) <= max_distance_m
        ]
        if not nearby:
            continue
        ratio = idw_ratio(nearby)
        report.layers[segment.segment_id] = SegmentLayer(
            **{**layer.__dict__, "pm_ratio": ratio, "pm_source": "idw"}
        )
    return report
