"""Real spatial projection. Grid cells summarize roads; they are not area surveys."""

import hashlib
import math
from collections import defaultdict
from datetime import UTC
from statistics import fmean

from app.processing.forecaster import Forecast, ForecastPoint
from app.schemas.observations import Phenomenon as P
from app.schemas.serving import (
    BestTimesResponse,
    CellProperties,
    GridCells,
    GridFeature,
    GridResponse,
    LineString,
    Polygon,
    ScoreComponent,
    ScoreSnapshot,
    SegmentDetail,
    SegmentFeature,
    SegmentProperties,
    SportProfile,
    TimeWindow,
)
from app.schemas.spatial import SpatialResult, SpatialStreet
from app.scoring.components import ramp, surface
from app.scoring.engine import score_hour
from app.scoring.profiles import WEIGHTS, Component, Profile
from app.scoring.score import best_windows

PROFILE = {
    SportProfile.RUNNING: Profile.RUNNING,
    SportProfile.CYCLING: Profile.ROAD_CYCLING,
    SportProfile.WALKING: Profile.WALKING,
}
ATTRIBUTION = ["ATRAI / senseBox:bike", "© OpenStreetMap contributors"]
MESSAGE = (
    "Rider-derived street attributes; survey and provider build times unknown. "
    "Air/weather are models; station IDW is a spatial estimate, not a street measurement. "
    "Confidence is an unvalidated heuristic; area rankings are withheld. "
    "Flow is a historical speed proxy."
)


def build_id(day_id, spatial_id):
    return hashlib.sha256(f"street-projection-v1:{day_id}:{spatial_id}".encode()).hexdigest()


def segment_features(result: SpatialResult):
    return [
        SegmentFeature(
            geometry=LineString(coordinates=s.segment.coordinates),
            properties=SegmentProperties(
                segment_id=int(s.segment.segment_id),
                name=s.name,
                resource_name=f"segments/{s.segment.segment_id}",
                coverage="partial",
                static_attributes=sorted(k for k in s.inputs if k != "geometry"),
            ),
        )
        for s in result.streets
    ]


def _local_values(street, hour):
    values = {
        "tempC": hour.temp_c,
        "humidity": hour.humidity,
        "pm25": hour.pm25,
        "no2": hour.no2,
        "windKmh": hour.wind_kmh,
    }
    if values["tempC"] is not None and street.layer.heat_anomaly is not None:
        values["tempC"] += street.layer.heat_anomaly
    if values["pm25"] is not None and street.layer.pm_source != "none":
        values["pm25"] *= street.layer.pm_ratio
    return values


def project_detail(street: SpatialStreet, profile, moment, day, spatial_id, *, clock):
    local_hour = next(h for h in day.hours if moment in h.instants)
    values = _local_values(street, local_hour)
    mappings = {
        P.TEMPERATURE: (values["tempC"], "°C"),
        P.RELATIVE_HUMIDITY: (values["humidity"], "%"),
        P.PM2_5: (local_hour.pm25, "µg/m³"),
        P.NO2: (values["no2"], "µg/m³"),
        P.WIND_SPEED: (values["windKmh"] / 3.6 if values["windKmh"] is not None else None, "m/s"),
    }
    # score_hour applies the layer's PM ratio/heat anomaly itself.
    mappings[P.TEMPERATURE] = (local_hour.temp_c, "°C")
    forecasts = {
        p: Forecast(p, None, "model_uncorrected", None, (ForecastPoint(moment, value, 0),))
        for p, (value, _) in mappings.items()
        if value is not None
    }
    horizon = max(0, int((moment - (day.retrieved_at or clock)).total_seconds() / 3600))
    computed = score_hour(
        street.segment,
        street.layer,
        PROFILE[profile],
        moment,
        horizon,
        forecasts,
        street.station_distance_km if street.station_distance_km is not None else math.inf,
    )
    missing = [key for key, value in values.items() if value is None]
    core_complete = not missing and bool(local_hour.instants)
    missing += [
        key
        for key in ("roughness", "overtaking_share", "flow")
        if getattr(street.layer, key) is None
    ]
    if street.layer.pm_source == "none":
        missing.append("street_pm_coverage")
    if street.layer.heat_anomaly is None:
        missing.append("street_heat_coverage")
    missing += ["greenery", "live_traffic", "provider_survey_time", "rain", "o3", "uv", "crowding"]
    methods = {
        Component.PM25: "city model × station IDW estimate from measured ratios"
        if street.layer.pm_source == "idw"
        else "city model × measured spatial ratio"
        if street.layer.pm_source == "samples"
        else "unadjusted city model; no street PM evidence",
        Component.APPARENT_TEMPERATURE: "city model + measured heat anomaly"
        if street.layer.heat_anomaly is not None
        else "unadjusted city weather model",
        Component.NO2: "city air model",
        Component.WIND: "city weather model",
        Component.DAYLIGHT: "solar elevation at street center; lighting unknown",
        Component.SURFACE: "historical rider-derived roughness percentage / 100",
        Component.OVERTAKING: "historical histogram share below 150 cm",
        Component.FLOW: "historical rider-derived normalized speed proxy",
    }
    components = [
        ScoreComponent(
            key=str(c),
            label=str(c).replace("_", " "),
            value=round(v * 100, 2),
            unit="goodness/100",
            weight=WEIGHTS[PROFILE[profile]].get(c, 0),
            source="forecast"
            if c in {Component.PM25, Component.NO2, Component.WIND, Component.APPARENT_TEMPERATURE}
            else "mixed",
            method=methods.get(c),
        )
        for c, v in computed.components.items()
    ]
    return SegmentDetail(
        segment_id=int(street.segment.segment_id),
        name=street.name,
        profile=profile,
        t=moment.astimezone(UTC).strftime("%Y-%m-%dT%H:00:00Z"),
        source="mixed",
        score=computed.score if core_complete else None,
        confidence=computed.confidence if core_complete else 0,
        components=components,
        gates=[k for k, v in computed.gates.items() if v < 1],
        missing=missing,
        build_id=build_id(day.build_id, spatial_id),
        spatial_build_id=spatial_id,
        pm_source=street.layer.pm_source,
        stale=day.status == "stale",
        message=MESSAGE,
    )


def project_scores(result, profile, moment, day, spatial_id, *, clock):
    details = [
        project_detail(s, profile, moment, day, spatial_id, clock=clock) for s in result.streets
    ]
    return ScoreSnapshot(
        profile=profile,
        t=moment.astimezone(UTC).strftime("%Y-%m-%dT%H:00:00Z"),
        source="mixed",
        version="street-projection-v1",
        build_id=build_id(day.build_id, spatial_id),
        scores={
            str(d.segment_id): (round(d.score), d.confidence, 0)
            for d in details
            if d.score is not None
        },
    )


def project_best(street, profile, selected, day, spatial_id, *, clock):
    instants = sorted(t for h in day.hours for t in h.instants)
    details = [project_detail(street, profile, t, day, spatial_id, clock=clock) for t in instants]
    scores = [d.score if d.confidence > 0 and not d.stale else None for d in details]
    windows = best_windows(scores, 3)
    return BestTimesResponse(
        name=f"segments/{street.segment.segment_id}/bestTimes/{selected}",
        segment_id=int(street.segment.segment_id),
        profile=profile,
        date=selected,
        source="mixed",
        windows=[TimeWindow(at=instants[w.start_index], score=w.score) for w in windows],
    )


def project_grid(result, day, spatial_id, generated_at, *, factor_function):
    # Fixed local metric lattice; one road is assigned by its vertex-mean center.
    # No interpolation into cells without roads, no fake park/greenery polygon.
    dx = 250 / (111_320 * math.cos(math.radians(49.1427)))
    dy = 250 / 111_320
    west, south, east, north = result.bbox
    buckets = defaultdict(list)
    for street in result.streets:
        x, y = street.segment.center
        buckets[(math.floor((x - west) / dx), math.floor((y - south) / dy))].append(street)
    features = []
    for (col, row), streets in sorted(buckets.items()):

        def average(values):
            values = [v for v in values if v is not None]
            return fmean(values) if values else None

        series = {k: [] for k in ("heat", "air", "wind", "traffic", "light")}
        for hour in day.hours:
            if not hour.instants:
                for key in series:
                    series[key].append(None)
                continue
            city_only = all(
                s.layer.pm_source == "none" and s.layer.heat_anomaly is None for s in streets
            )
            scores = (
                [hour.factors]
                if city_only
                else [factor_function(_local_values(s, hour)) for s in streets]
            )
            for key in ("heat", "air", "wind"):
                series[key].append(average(getattr(s, key) for s in scores))
            series["traffic"].append(
                average(s.layer.flow * 100 if s.layer.flow is not None else None for s in streets)
            )
            series["light"].append(hour.factors.light)
        covered = sum(s.layer.pm_source != "none" for s in streets)
        safety = average(
            ramp(Component.OVERTAKING, s.layer.overtaking_share) * 100
            if s.layer.overtaking_share is not None
            else None
            for s in streets
        )
        smoothness = average(
            surface(s.layer.roughness) * 100 if s.layer.roughness is not None else None
            for s in streets
        )
        x, y = west + col * dx, south + row * dy
        right, top = min(x + dx, east), min(y + dy, north)
        features.append(
            GridFeature(
                geometry=Polygon(
                    coordinates=[[(x, y), (right, y), (right, top), (x, top), (x, y)]]
                ),
                properties=CellProperties(
                    id=f"atrai-{col}-{row}",
                    place=streets[0].name,
                    **series,
                    safety=safety,
                    surface=smoothness,
                    green=None,
                    confidence=0,
                    recommendable=False,  # No validated area-level confidence model.
                    segment_ids=[int(s.segment.segment_id) for s in streets],
                    coverage={
                        "roads": len(streets),
                        "pm_spatial": covered,
                        **{
                            k: sum(getattr(s.layer, k) is not None for s in streets)
                            for k in ("roughness", "overtaking_share", "flow")
                        },
                    },
                    provenance={
                        "aggregation": (
                            "arithmetic means of available road attributes, assigned by road center"
                        ),
                        "air": "city model; no street PM coverage"
                        if not covered
                        else "city model plus spatial estimates from measured ratios",
                        "heat": "city model plus heat anomaly where covered",
                        "wind": "city weather model",
                        "light": "city solar calculation",
                        "traffic": "historical normalized speed proxy; not current traffic",
                        "safety": (
                            "historical close-pass histogram only; surface reported separately"
                        ),
                        "green": "unavailable",
                        "confidence": "no validated area-level confidence",
                    },
                ),
            )
        )
    return GridResponse(
        name=f"grids/{day.date}",
        date=day.date,
        cell_size_m=250,
        source="mixed",
        generated_at=max(day.generated_at, generated_at),
        cells=GridCells(features=features),
        status="partial",
        message=MESSAGE,
        build_id=build_id(day.build_id, spatial_id),
        captured_at=min((c.captured_at for c in result.captures), default=None),
        stale=day.status == "stale",
        attribution=day.attribution + ATTRIBUTION,
        coverage={
            "roads": len(result.streets),
            **{
                k: sum(getattr(s.layer, k) is not None for s in result.streets)
                for k in ("roughness", "overtaking_share", "flow")
            },
            "pm_spatial": sum(s.layer.pm_source != "none" for s in result.streets),
        },
    )
