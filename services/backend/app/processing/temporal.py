"""Temporal profile builder: city level per hour (docs/scoring.md §4.1-§4.2).

Uses only usable stationary measurements (`kind == "observation"`). Hours are UTC
for storage; the climatology groups by Europe/Berlin local hour and weekday, so
rush hours stay at the same wall-clock time across DST changes.
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, tzinfo
from statistics import fmean, median
from typing import Literal
from zoneinfo import ZoneInfo

from app.schemas.observations import Observation, Phenomenon

LOCAL_TZ = ZoneInfo("Europe/Berlin")
LIVE_WINDOW = timedelta(minutes=30)


@dataclass(frozen=True)
class Calibration:
    """Linear correction toward a reference station: x_ref ≈ alpha * x + beta."""

    alpha: float = 1.0
    beta: float = 0.0

    def apply(self, value: float) -> float:
        return self.alpha * value + self.beta


def fit_calibration(pairs: Sequence[tuple[float, float]]) -> Calibration:
    """Least-squares fit of (box value, reference value) pairs on overlapping history."""
    if len(pairs) < 2:
        raise ValueError("calibration needs at least two pairs")
    xs = [x for x, _ in pairs]
    ys = [y for _, y in pairs]
    mean_x, mean_y = fmean(xs), fmean(ys)
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance == 0:
        raise ValueError("calibration needs varying box values")
    alpha = sum((x - mean_x) * (y - mean_y) for x, y in pairs) / variance
    return Calibration(alpha, mean_y - alpha * mean_x)


@dataclass(frozen=True)
class Level:
    value: float
    at: datetime
    stations: int
    method: Literal["median_live", "reference"]


def floor_hour(moment: datetime) -> datetime:
    return moment.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def _measurements(observations: Iterable[Observation], phenomenon: Phenomenon):
    return (
        obs
        for obs in observations
        if obs.phenomenon == phenomenon
        and obs.platform == "stationary"
        and obs.kind == "observation"
        and obs.usable
    )


def current_level(
    observations: Iterable[Observation],
    phenomenon: Phenomenon,
    now: datetime,
    live_window: timedelta = LIVE_WINDOW,
    calibrations: Mapping[str, Calibration] | None = None,
    reference: float | None = None,
) -> Level | None:
    """§4.1 median of the latest calibrated value of each live station. A station is
    live with a usable value in [now - live_window, now]. Without live stations the
    `reference` value is used; without both the level is unknown (None)."""
    calibrations = calibrations or {}
    latest: dict[tuple[str, str], Observation] = {}
    for obs in _measurements(observations, phenomenon):
        if not now - live_window <= obs.observed_at <= now:
            continue
        station = (obs.source, obs.station_id)
        if station not in latest or obs.observed_at > latest[station].observed_at:
            latest[station] = obs
    if latest:
        values = [
            calibrations.get(obs.station_id, Calibration()).apply(obs.value)
            for obs in latest.values()
        ]
        return Level(median(values), now, len(values), "median_live")
    if reference is not None:
        return Level(reference, now, 0, "reference")
    return None


def hourly_levels(
    observations: Iterable[Observation],
    phenomenon: Phenomenon,
    calibrations: Mapping[str, Calibration] | None = None,
) -> dict[datetime, float]:
    """City level per UTC hour: median over stations of each station's hourly mean."""
    calibrations = calibrations or {}
    per_station: dict[datetime, dict[tuple[str, str], list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for obs in _measurements(observations, phenomenon):
        value = calibrations.get(obs.station_id, Calibration()).apply(obs.value)
        per_station[floor_hour(obs.observed_at)][(obs.source, obs.station_id)].append(value)
    return {
        hour: median(fmean(values) for values in stations.values())
        for hour, stations in sorted(per_station.items())
    }


@dataclass
class Climatology:
    """§4.2 typical level by local (weekday, hour); weekday 0 is Monday."""

    values: dict[tuple[int, int], float]
    counts: dict[tuple[int, int], int]
    tz: tzinfo = field(default=LOCAL_TZ)

    def slot(self, moment: datetime) -> tuple[int, int]:
        local = moment.astimezone(self.tz)
        return local.weekday(), local.hour

    def at(self, moment: datetime) -> float | None:
        return self.values.get(self.slot(moment))


def climatology(
    levels: Mapping[datetime, float], tz: tzinfo = LOCAL_TZ, min_samples: int = 1
) -> Climatology:
    """Median of hourly levels per local (weekday, hour). On the night the clocks go
    back, two UTC hours share local hour 02; both count toward that slot."""
    grouped: dict[tuple[int, int], list[float]] = defaultdict(list)
    for hour, value in levels.items():
        local = hour.astimezone(tz)
        grouped[(local.weekday(), local.hour)].append(value)
    kept = {slot: values for slot, values in grouped.items() if len(values) >= min_samples}
    return Climatology(
        values={slot: median(values) for slot, values in kept.items()},
        counts={slot: len(values) for slot, values in kept.items()},
        tz=tz,
    )
