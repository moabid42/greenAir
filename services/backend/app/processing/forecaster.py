"""Forecaster: next hours of a city-level series (docs/scoring.md §4.3).

Output points are forecasts, not observations. Concentrations use the draft's
multiplicative form. Temperature uses the additive analogue (difference instead
of ratio), because a ratio of °C values is undefined around 0 °C.
"""

import math
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import fmean
from typing import Literal

from app.processing.temporal import Climatology, floor_hour
from app.schemas.observations import Observation, Phenomenon

Method = Literal["model_bias_corrected", "model_uncorrected", "climatology_decay"]
ADDITIVE = frozenset({Phenomenon.TEMPERATURE})
BIAS_WINDOW = timedelta(hours=24)
DECAY_HOURS = 6.0


@dataclass(frozen=True)
class ForecastPoint:
    at: datetime
    value: float
    hours_ahead: int


@dataclass(frozen=True)
class Forecast:
    phenomenon: Phenomenon
    issued_at: datetime
    method: Method
    correction: float | None
    points: tuple[ForecastPoint, ...]

    def at(self, moment: datetime) -> float | None:
        hour = floor_hour(moment)
        return next((point.value for point in self.points if point.at == hour), None)


def model_series(
    observations: Iterable[Observation], phenomenon: Phenomenon
) -> dict[datetime, float]:
    """Hourly mean of usable model values (`kind == "model"`), e.g. Open-Meteo."""
    hourly: dict[datetime, list[float]] = defaultdict(list)
    for obs in observations:
        if obs.phenomenon == phenomenon and obs.kind == "model" and obs.usable:
            hourly[floor_hour(obs.observed_at)].append(obs.value)
    return {hour: fmean(values) for hour, values in sorted(hourly.items())}


def model_correction(
    levels: Mapping[datetime, float],
    model: Mapping[datetime, float],
    issued_at: datetime,
    additive: bool = False,
    window: timedelta = BIAS_WINDOW,
) -> float | None:
    """§4.3 b(t0) = mean L / mean M over hours in [t0 - 24 h, t0] present in both;
    the difference of means for additive phenomena. None without overlap."""
    t0 = floor_hour(issued_at)
    hours = [hour for hour in levels if t0 - window <= hour <= t0 and hour in model]
    if not hours:
        return None
    mean_level = fmean(levels[hour] for hour in hours)
    mean_model = fmean(model[hour] for hour in hours)
    if additive:
        return mean_level - mean_model
    return mean_level / mean_model if mean_model > 0 else None


def forecast(
    phenomenon: Phenomenon,
    issued_at: datetime,
    levels: Mapping[datetime, float],
    model: Mapping[datetime, float] | None = None,
    climatology: Climatology | None = None,
    horizon_hours: int = 24,
    decay_hours: float = DECAY_HOURS,
) -> Forecast | None:
    """Prefer the bias-corrected model; without overlap use the raw model; without
    a model decay today's anomaly toward the climatology. None without both."""
    t0 = floor_hour(issued_at)
    additive = phenomenon in ADDITIVE
    hours = [t0 + timedelta(hours=step) for step in range(1, horizon_hours + 1)]

    if model:
        correction = model_correction(levels, model, t0, additive)
        method: Method = "model_bias_corrected" if correction is not None else "model_uncorrected"
        points = []
        for step, hour in enumerate(hours, start=1):
            if hour not in model:
                continue
            value = model[hour]
            if correction is not None:
                value = value + correction if additive else value * correction
            points.append(ForecastPoint(hour, value, step))
        return Forecast(phenomenon, t0, method, correction, tuple(points))

    if climatology is None:
        return None
    current = _latest(levels, t0)
    typical_now = climatology.at(t0)
    if current is None or typical_now is None:
        anomaly = 0.0 if additive else 1.0
    elif additive:
        anomaly = current - typical_now
    else:
        anomaly = current / typical_now if typical_now > 0 else 1.0
    points = []
    for step, hour in enumerate(hours, start=1):
        typical = climatology.at(hour)
        if typical is None:
            continue
        weight = math.exp(-step / decay_hours)
        value = typical + anomaly * weight if additive else typical * anomaly**weight
        points.append(ForecastPoint(hour, value, step))
    return Forecast(phenomenon, t0, "climatology_decay", anomaly, tuple(points))


def _latest(levels: Mapping[datetime, float], t0: datetime) -> float | None:
    past = [hour for hour in levels if hour <= t0]
    return levels[max(past)] if past else None
