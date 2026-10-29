"""Normalizer + QC: RawObservation -> Observation (docs/processing.md).

Values are never silently dropped: a failed check adds a QC flag and keeps the
value for traceability. Only provider keys without a known phenomenon are skipped,
and they are counted in the report.
"""

import math
from bisect import bisect_left
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.schemas.observations import (
    CANONICAL_UNITS,
    Observation,
    Phenomenon,
    QcFlag,
    RawObservation,
)

P = Phenomenon

# Provider keys (case-insensitive): openSenseMap German titles, ATRAI keys, generic names.
RAW_KEYS: dict[str, Phenomenon] = {
    "temperatur": P.TEMPERATURE,
    "temperature": P.TEMPERATURE,
    "rel. luftfeuchte": P.RELATIVE_HUMIDITY,
    "rel. humidity": P.RELATIVE_HUMIDITY,
    "relative humidity": P.RELATIVE_HUMIDITY,
    "humidity": P.RELATIVE_HUMIDITY,
    "luftdruck": P.PRESSURE,
    "pressure": P.PRESSURE,
    "pm1": P.PM1,
    "finedust pm1": P.PM1,
    "pm25": P.PM2_5,
    "pm2.5": P.PM2_5,
    "finedust pm2.5": P.PM2_5,
    "pm4": P.PM4,
    "finedust pm4": P.PM4,
    "pm10": P.PM10,
    "finedust pm10": P.PM10,
    "no2": P.NO2,
    "o3": P.O3,
    "wind speed": P.WIND_SPEED,
    "wind_speed": P.WIND_SPEED,
    "rain rate": P.PRECIPITATION,
    "precipitation": P.PRECIPITATION,
    "uv index": P.UV_INDEX,
    "uv-intensität": P.UV_INTENSITY,
    "uv intensity": P.UV_INTENSITY,
    "beleuchtungsstärke": P.ILLUMINANCE,
    "illuminance": P.ILLUMINANCE,
    # Open-Meteo hourly variables and Bright Sky weather fields (checked 2026-10-28).
    "temperature_2m": P.TEMPERATURE,
    "relative_humidity_2m": P.RELATIVE_HUMIDITY,
    "relative_humidity": P.RELATIVE_HUMIDITY,
    "wind_speed_10m": P.WIND_SPEED,
    "pm2_5": P.PM2_5,
    "nitrogen_dioxide": P.NO2,
    "ozone": P.O3,
    "uv_index": P.UV_INDEX,
}


def _identity(value: float) -> float:
    return value


Converter = Callable[[float], float]
_MASS = {"µg/m³": _identity, "ug/m3": _identity, "µg/m3": _identity, "ug/m³": _identity}

# Accepted provider units per phenomenon, after `_unit_key`, with the conversion to canonical.
CONVERSIONS: dict[Phenomenon, dict[str, Converter]] = {
    P.TEMPERATURE: {
        "°c": _identity,
        "c": _identity,
        "k": lambda v: v - 273.15,
        "°f": lambda v: (v - 32) * 5 / 9,
    },
    P.RELATIVE_HUMIDITY: {"%": _identity},
    P.PRESSURE: {
        "hpa": _identity,
        "mbar": _identity,
        "pa": lambda v: v / 100,
        "kpa": lambda v: v * 10,
    },
    P.PM1: _MASS,
    P.PM2_5: _MASS,
    P.PM4: _MASS,
    P.PM10: _MASS,
    P.NO2: _MASS,
    P.O3: _MASS,
    P.WIND_SPEED: {"m/s": _identity, "km/h": lambda v: v / 3.6},
    # Open-Meteo and Bright Sky report "mm" per hourly step; only valid for hourly values.
    P.PRECIPITATION: {"mm/h": _identity, "mm": _identity},
    P.UV_INDEX: {"1": _identity, "index": _identity, "": _identity},
    P.UV_INTENSITY: {"µw/cm²": _identity, "µw/cm2": _identity},
    P.ILLUMINANCE: {"lx": _identity, "lux": _identity},
}

# Physically plausible ranges in canonical units; values outside get OUT_OF_RANGE.
PLAUSIBLE: dict[Phenomenon, tuple[float, float]] = {
    P.TEMPERATURE: (-40, 60),
    P.RELATIVE_HUMIDITY: (0, 100),
    P.PRESSURE: (850, 1100),
    P.PM1: (0, 1000),
    P.PM2_5: (0, 1000),
    P.PM4: (0, 1000),
    P.PM10: (0, 1000),
    P.NO2: (0, 1000),
    P.O3: (0, 1000),
    P.WIND_SPEED: (0, 75),
    P.PRECIPITATION: (0, 300),
    P.UV_INDEX: (0, 20),
    P.UV_INTENSITY: (0, 100_000),
    P.ILLUMINANCE: (0, 200_000),
}

PM = frozenset({P.PM1, P.PM2_5, P.PM4, P.PM10})
# Constant UV, light or rain (zero at night, dry days) is normal and not "stuck".
STUCK_CHECKED = PM | {P.TEMPERATURE, P.RELATIVE_HUMIDITY, P.PRESSURE}


def _unit_key(unit: str) -> str:
    # Providers use both U+00B5 (micro sign) and U+03BC (Greek mu); casefold() turns
    # the micro sign into Greek mu, so unify after folding.
    return unit.strip().casefold().replace("μ", "µ")


def _number(raw: str | float | int | None) -> float | None:
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def normalize(raw: RawObservation) -> Observation | None:
    """Map one raw value; returns None only for an unknown provider key."""
    phenomenon = RAW_KEYS.get(raw.raw_key.strip().casefold())
    if phenomenon is None:
        return None
    flags: list[QcFlag] = []

    observed_at = raw.observed_at
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=UTC)
        flags.append(QcFlag.ASSUMED_UTC)

    value = _number(raw.raw_value)
    if raw.raw_value is not None and value is None:
        flags.append(QcFlag.NON_NUMERIC)
    if raw.raw_unit is None:
        convert = _identity
        if value is not None:
            flags.append(QcFlag.ASSUMED_UNIT)
    else:
        convert = CONVERSIONS[phenomenon].get(_unit_key(raw.raw_unit))
        if convert is None:
            flags.append(QcFlag.UNKNOWN_UNIT)
    if value is not None and convert is not None:
        value = convert(value)
        low, high = PLAUSIBLE[phenomenon]
        if not low <= value <= high:
            flags.append(QcFlag.OUT_OF_RANGE)

    return Observation(
        source=raw.source,
        station_id=raw.station_id,
        platform=raw.platform,
        kind=raw.kind,
        phenomenon=phenomenon,
        value=value if convert is not None else None,
        unit=CANONICAL_UNITS[phenomenon],
        observed_at=observed_at,
        longitude=raw.longitude,
        latitude=raw.latitude,
        raw_key=raw.raw_key,
        raw_value=None if raw.raw_value is None else str(raw.raw_value),
        raw_unit=raw.raw_unit,
        retrieved_at=raw.retrieved_at,
        sample_id=raw.sample_id,
        sensor_id=raw.sensor_id,
        raw_ref=raw.raw_ref,
        issued_at=raw.issued_at,
        qc_flags=tuple(flags),
    )


@dataclass
class NormalizationReport:
    observations: list[Observation]
    unmapped_keys: Counter[str] = field(default_factory=Counter)
    duplicates: int = 0

    @property
    def flag_counts(self) -> Counter[QcFlag]:
        return Counter(flag for obs in self.observations for flag in obs.qc_flags)


def normalize_batch(
    raws: Iterable[RawObservation],
    stuck_run: int = 10,
    humid_threshold: float = 75.0,
    humid_window: timedelta = timedelta(minutes=5),
) -> NormalizationReport:
    """Normalize, deduplicate by `Observation.key`, then apply sensor checks to
    measurements (`kind == "observation"`; model output is smooth by design):
    `stuck_run` identical consecutive values of a stationary series are STUCK; PM
    with the nearest humidity of the same station above `humid_threshold` within
    `humid_window` is HUMID_PM (the ATRAI rule, reference §3.3)."""
    report = NormalizationReport(observations=[])
    seen: set[tuple] = set()
    for raw in raws:
        observation = normalize(raw)
        if observation is None:
            report.unmapped_keys[raw.raw_key] += 1
        elif observation.key in seen:
            report.duplicates += 1
        else:
            seen.add(observation.key)
            report.observations.append(observation)

    report.observations = quality_control(
        report.observations,
        stuck_run=stuck_run,
        humid_threshold=humid_threshold,
        humid_window=humid_window,
    )
    return report


def quality_control(
    observations: Iterable[Observation],
    *,
    stuck_run: int = 10,
    humid_threshold: float = 75.0,
    humid_window: timedelta = timedelta(minutes=5),
    sensor_sources: set[str] | None = None,
) -> list[Observation]:
    """QC already-canonical values without converting original provider values again.

    Source-specific sensor checks can be restricted to community measurements;
    range checks apply to all canonical inputs, including modelled values.
    """
    observations = list(observations)
    extra: dict[tuple, set[QcFlag]] = defaultdict(set)
    for obs in observations:
        if obs.value is not None:
            low, high = PLAUSIBLE[obs.phenomenon]
            if not math.isfinite(obs.value) or not low <= obs.value <= high:
                extra[obs.key].add(QcFlag.OUT_OF_RANGE)
    measurements = [
        obs
        for obs in observations
        if obs.kind == "observation" and (sensor_sources is None or obs.source in sensor_sources)
    ]
    _flag_stuck(measurements, stuck_run, extra)
    _flag_humid_pm(measurements, humid_threshold, humid_window, extra)
    return sorted(
        (
            obs.model_copy(update={"qc_flags": tuple(sorted(set(obs.qc_flags) | extra[obs.key]))})
            if extra.get(obs.key)
            else obs
            for obs in observations
        ),
        key=lambda obs: (obs.observed_at, obs.source, obs.station_id, obs.phenomenon),
    )


def _series(observations: list[Observation], phenomena: frozenset[Phenomenon]):
    series: dict[tuple, list[Observation]] = defaultdict(list)
    for obs in observations:
        if obs.phenomenon in phenomena:
            series[(obs.source, obs.station_id, obs.phenomenon, obs.sensor_id)].append(obs)
    for values in series.values():
        values.sort(key=lambda obs: obs.observed_at)
    return series


def _flag_stuck(observations: list[Observation], run: int, extra: dict) -> None:
    stationary = [obs for obs in observations if obs.platform == "stationary"]
    for values in _series(stationary, STUCK_CHECKED).values():
        start = 0
        for end in range(1, len(values) + 1):
            if end < len(values) and values[end].value == values[start].value:
                continue
            if values[start].value is not None and end - start >= run:
                for obs in values[start:end]:
                    extra[obs.key].add(QcFlag.STUCK)
            start = end


def _flag_humid_pm(
    observations: list[Observation], threshold: float, window: timedelta, extra: dict
) -> None:
    humidity: dict[tuple, list[Observation]] = defaultdict(list)
    for obs in observations:
        if obs.phenomenon == P.RELATIVE_HUMIDITY and obs.value is not None:
            humidity[(obs.source, obs.station_id)].append(obs)
    times: dict[tuple, list[datetime]] = {}
    for station, values in humidity.items():
        values.sort(key=lambda obs: obs.observed_at)
        times[station] = [obs.observed_at for obs in values]

    for obs in observations:
        station = (obs.source, obs.station_id)
        if obs.phenomenon not in PM or station not in humidity:
            continue
        index = bisect_left(times[station], obs.observed_at)
        candidates = humidity[station][max(index - 1, 0) : index + 1]
        nearest = min(candidates, key=lambda rh: abs(rh.observed_at - obs.observed_at))
        if abs(nearest.observed_at - obs.observed_at) <= window and nearest.value > threshold:
            extra[obs.key].add(QcFlag.HUMID_PM)
