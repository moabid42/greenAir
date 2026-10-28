"""Scoring engine: sport profile x segment x hour (docs/scoring.md §1, §5-§7).

Combines city-level forecasts (temporal), segment patterns (spatial) and the
score formulas. Scores are derived values, never observations.
"""

import math
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.processing.forecaster import Forecast
from app.processing.spatial import Point, Segment, SegmentLayer, distance_m
from app.processing.temporal import Climatology
from app.schemas.observations import Phenomenon
from app.scoring.components import (
    apparent_temperature,
    comfort,
    daylight,
    flow,
    ramp,
    surface,
)
from app.scoring.profiles import Component, Profile
from app.scoring.score import (
    Window,
    air_gate,
    alert_gate,
    best_windows,
    confidence,
    rain_gate,
    score,
)

P = Phenomenon
C = Component
SUNRISE_ELEVATION_DEG = -0.833  # upper limb at the horizon with refraction


def solar_elevation_deg(moment: datetime, point: Point) -> float:
    """Approximate sun elevation (NOAA general solar position), about ±0.5°."""
    t = moment.astimezone(UTC)
    hours = t.hour + t.minute / 60 + t.second / 3600
    g = 2 * math.pi / 365 * (t.timetuple().tm_yday - 1 + (hours - 12) / 24)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )
    declination = (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.00148 * math.sin(3 * g)
    )
    solar_minutes = hours * 60 + eqtime + 4 * point[0]
    hour_angle = math.radians(solar_minutes / 4 - 180)
    latitude = math.radians(point[1])
    cos_zenith = math.sin(latitude) * math.sin(declination) + math.cos(latitude) * math.cos(
        declination
    ) * math.cos(hour_angle)
    return 90 - math.degrees(math.acos(max(-1.0, min(1.0, cos_zenith))))


def contrast_exponent(no2_climatology: Climatology | None, moment: datetime) -> float:
    """§3.5 gamma(t) = 0.5 + typical NO2 now / max typical NO2, in [0.5, 1.5]; 1 without data."""
    if no2_climatology is None or not no2_climatology.values:
        return 1.0
    typical = no2_climatology.at(moment)
    peak = max(no2_climatology.values.values())
    if typical is None or peak <= 0:
        return 1.0
    return 0.5 + typical / peak


@dataclass(frozen=True)
class SegmentScore:
    segment_id: str
    profile: Profile
    at: datetime
    hours_ahead: int
    score: float | None
    confidence: float
    components: dict[Component, float]
    gates: dict[str, float]


def _value(forecasts: Mapping[Phenomenon, Forecast], phenomenon: Phenomenon, hour: datetime):
    forecast = forecasts.get(phenomenon)
    return forecast.at(hour) if forecast else None


def score_hour(
    segment: Segment,
    layer: SegmentLayer,
    profile: Profile,
    hour: datetime,
    hours_ahead: int,
    forecasts: Mapping[Phenomenon, Forecast],
    station_distance_km: float,
    severe_weather_alert: bool = False,
    no2_climatology: Climatology | None = None,
) -> SegmentScore:
    """Score one segment for one profile and hour. Components without data are
    dropped (§6.1) and the score is None when nothing is known."""
    goodness: dict[Component, float] = {}
    gates: dict[str, float] = {"alert": alert_gate(severe_weather_alert)}

    pm25 = _value(forecasts, P.PM2_5, hour)
    if pm25 is not None:
        pm25_here = pm25 * layer.pm_ratio ** contrast_exponent(no2_climatology, hour)
        goodness[C.PM25] = ramp(C.PM25, pm25_here)
        gates["air"] = air_gate(pm25_here)
    for phenomenon, component in ((P.NO2, C.NO2), (P.O3, C.O3), (P.UV_INDEX, C.UV)):
        value = _value(forecasts, phenomenon, hour)
        if value is not None:
            goodness[component] = ramp(component, value)

    temperature = _value(forecasts, P.TEMPERATURE, hour)
    humidity = _value(forecasts, P.RELATIVE_HUMIDITY, hour)
    wind = _value(forecasts, P.WIND_SPEED, hour)
    if wind is not None:
        goodness[C.WIND] = ramp(C.WIND, wind * 3.6)  # anchors are km/h
    if None not in (temperature, humidity, wind):
        local_temperature = temperature + (layer.heat_anomaly or 0.0)
        felt = apparent_temperature(local_temperature, humidity, wind)
        goodness[C.APPARENT_TEMPERATURE] = comfort(profile, felt)
    rain = _value(forecasts, P.PRECIPITATION, hour)
    if rain is not None:
        gates["rain"] = rain_gate(profile, rain)

    if layer.roughness is not None:
        goodness[C.SURFACE] = surface(layer.roughness)
    if layer.overtaking_share is not None:
        goodness[C.OVERTAKING] = ramp(C.OVERTAKING, layer.overtaking_share)
    if layer.flow is not None:
        goodness[C.FLOW] = flow(layer.flow)
    middle = hour + timedelta(minutes=30)
    is_day = solar_elevation_deg(middle, segment.center) > SUNRISE_ELEVATION_DEG
    goodness[C.DAYLIGHT] = daylight(profile, is_day)

    samples = {"samples": layer.pm_samples, "idw": None, "none": 0}[layer.pm_source]
    return SegmentScore(
        segment_id=segment.segment_id,
        profile=profile,
        at=hour,
        hours_ahead=hours_ahead,
        score=score(profile, goodness, gates.values()),
        confidence=confidence(samples, station_distance_km, hours_ahead),
        components=goodness,
        gates=gates,
    )


def score_segments(
    segments: Sequence[Segment],
    layers: Mapping[str, SegmentLayer],
    forecasts: Mapping[Phenomenon, Forecast],
    profiles: Iterable[Profile],
    issued_at: datetime,
    live_stations: Sequence[Point],
    horizon_hours: int = 24,
    severe_weather_alert: bool = False,
    no2_climatology: Climatology | None = None,
) -> list[SegmentScore]:
    """Scores for the next `horizon_hours` full hours after `issued_at`."""
    t0 = issued_at.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    profiles = list(profiles)
    results = []
    for segment in segments:
        nearest_m = min(
            (distance_m(segment.center, station) for station in live_stations), default=math.inf
        )
        for step in range(1, horizon_hours + 1):
            hour = t0 + timedelta(hours=step)
            for profile in profiles:
                results.append(
                    score_hour(
                        segment,
                        layers[segment.segment_id],
                        profile,
                        hour,
                        step,
                        forecasts,
                        nearest_m / 1000,
                        severe_weather_alert,
                        no2_climatology,
                    )
                )
    return results


def best_times(scores: Iterable[SegmentScore], count: int = 3) -> dict[tuple[str, Profile], list]:
    """§7 top distinct one-hour windows per segment and profile, as (hour, score)."""
    grouped: dict[tuple[str, Profile], list[SegmentScore]] = defaultdict(list)
    for item in scores:
        grouped[(item.segment_id, item.profile)].append(item)
    result = {}
    for key, items in grouped.items():
        items.sort(key=lambda item: item.at)
        windows: list[Window] = best_windows([item.score for item in items], count)
        result[key] = [(items[window.start_index].at, window.score) for window in windows]
    return result
