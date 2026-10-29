"""Spatial pattern, gates, final score, confidence and best time (docs/scoring.md §3, §5.4-§7)."""

import math
from collections.abc import Iterable, Mapping, Sequence
from typing import NamedTuple

from app.scoring.profiles import (
    AIR_GATE_PM25,
    HORIZON_SCALE_HOURS,
    IDW_COVERAGE,
    KAPPA,
    RAIN_LIMITS,
    STATION_DISTANCE_SCALE_KM,
    WEIGHTS,
    Component,
    Profile,
)


def shrink_ratio(median_ratio: float, samples: int, kappa: float = KAPPA) -> float:
    """§3.1 shrink a segment's median PM ratio toward 1 in log space."""
    if samples <= 0:
        return 1.0
    return math.exp(samples / (samples + kappa) * math.log(median_ratio))


def shrink_anomaly(median_anomaly: float, samples: int, kappa: float = KAPPA) -> float:
    """§3.2 shrink a segment's median temperature anomaly toward 0."""
    if samples <= 0:
        return 0.0
    return samples / (samples + kappa) * median_anomaly


def idw_ratio(neighbours: Iterable[tuple[float, float]]) -> float | None:
    """§3.4 inverse-distance-squared mean of (distance, ratio) pairs; None without neighbours."""
    weighted = total = 0.0
    for distance, ratio in neighbours:
        if distance <= 0:
            return ratio
        weight = distance**-2
        weighted += weight * ratio
        total += weight
    return weighted / total if total else None


def rain_gate(profile: Profile, rain_mm_h: float, soft: bool = False) -> float:
    """§5.4 hard gate 1[P < P_p], or the soft alternative 1 / (1 + (P/P_p)^4)."""
    limit = RAIN_LIMITS[profile]
    if soft:
        return 1 / (1 + (rain_mm_h / limit) ** 4)
    return 1.0 if rain_mm_h < limit else 0.0


def air_gate(pm25: float) -> float:
    return 1.0 if pm25 < AIR_GATE_PM25 else 0.0


def alert_gate(severe_weather_alert: bool) -> float:
    return 0.0 if severe_weather_alert else 1.0


def score(
    profile: Profile,
    goodness: Mapping[Component, float | None],
    gates: Iterable[float] = (),
) -> float | None:
    """§6.1 score 0-100. Components that are absent, None or weighted 0 are dropped
    from both sums; returns None when no weighted component has data."""
    weights = WEIGHTS[profile]
    numerator = denominator = 0.0
    for component, value in goodness.items():
        weight = weights.get(component, 0)
        if value is None or weight == 0:
            continue
        numerator += weight * value
        denominator += weight
    if denominator == 0:
        return None
    return 100 * math.prod(gates) * numerator / denominator


def confidence(
    samples: int | None,
    station_distance_km: float,
    hours_ahead: float,
    kappa: float = KAPPA,
) -> float:
    """§6.3 minimum of coverage, station proximity and forecast horizon terms.
    `samples=None` marks an IDW-filled segment (fixed coverage 0.3)."""
    coverage = IDW_COVERAGE if samples is None else 1 - math.exp(-samples / kappa)
    proximity = math.exp(-station_distance_km / STATION_DISTANCE_SCALE_KM)
    horizon = math.exp(-max(hours_ahead, 0) / HORIZON_SCALE_HOURS)
    return min(coverage, proximity, horizon)


class Window(NamedTuple):
    start_index: int
    score: float


def best_windows(hourly_scores: Sequence[float | None], count: int = 3) -> list[Window]:
    """§7 top one-hour windows by score. Neighbours of a chosen hour are skipped so
    the windows are distinct; hours without a score are ignored."""
    ranked = sorted(
        (index for index, value in enumerate(hourly_scores) if value is not None),
        key=lambda index: (-hourly_scores[index], index),
    )
    chosen: list[Window] = []
    for index in ranked:
        if len(chosen) == count:
            break
        if all(abs(index - window.start_index) > 1 for window in chosen):
            chosen.append(Window(index, hourly_scores[index]))
    return chosen


def route_score(segments: Iterable[tuple[float, float, float]]) -> tuple[float, float] | None:
    """§7 length-weighted score and minimum confidence of (length, score, confidence) segments."""
    total_length = weighted = 0.0
    lowest = math.inf
    for length, segment_score, segment_confidence in segments:
        total_length += length
        weighted += length * segment_score
        lowest = min(lowest, segment_confidence)
    if total_length <= 0:
        return None
    return weighted / total_length, lowest
