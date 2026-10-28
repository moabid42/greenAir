"""Observation contracts at the ingestion -> processing boundary (`observations.raw`).

Adapters emit `RawObservation` with provider keys, units and values unchanged.
The normalizer turns them into `Observation` with a canonical phenomenon, unit,
UTC time and QC flags. See docs/processing.md.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

Platform = Literal["stationary", "mobile"]
# Keep measurements, model output and derived layers distinguishable (reference §16).
ValueKind = Literal["observation", "model", "derived"]


class Phenomenon(StrEnum):
    TEMPERATURE = "temperature"
    RELATIVE_HUMIDITY = "relative_humidity"
    PRESSURE = "pressure"
    PM1 = "pm1"
    PM2_5 = "pm2_5"
    PM4 = "pm4"
    PM10 = "pm10"
    NO2 = "no2"
    O3 = "o3"
    WIND_SPEED = "wind_speed"
    PRECIPITATION = "precipitation"
    UV_INDEX = "uv_index"
    UV_INTENSITY = "uv_intensity"
    ILLUMINANCE = "illuminance"


CANONICAL_UNITS: dict[Phenomenon, str] = {
    Phenomenon.TEMPERATURE: "°C",
    Phenomenon.RELATIVE_HUMIDITY: "%",
    Phenomenon.PRESSURE: "hPa",
    Phenomenon.PM1: "µg/m³",
    Phenomenon.PM2_5: "µg/m³",
    Phenomenon.PM4: "µg/m³",
    Phenomenon.PM10: "µg/m³",
    Phenomenon.NO2: "µg/m³",
    Phenomenon.O3: "µg/m³",
    Phenomenon.WIND_SPEED: "m/s",
    Phenomenon.PRECIPITATION: "mm/h",
    Phenomenon.UV_INDEX: "1",
    Phenomenon.UV_INTENSITY: "µW/cm²",
    Phenomenon.ILLUMINANCE: "lx",
}


class QcFlag(StrEnum):
    # Informational: the value is kept and usable.
    ASSUMED_UTC = "assumed_utc"
    ASSUMED_UNIT = "assumed_unit"
    # Blocking: the value is kept for traceability but not used downstream.
    NON_NUMERIC = "non_numeric"
    UNKNOWN_UNIT = "unknown_unit"
    OUT_OF_RANGE = "out_of_range"
    STUCK = "stuck"
    HUMID_PM = "humid_pm"


BLOCKING_FLAGS = frozenset(
    {QcFlag.NON_NUMERIC, QcFlag.UNKNOWN_UNIT, QcFlag.OUT_OF_RANGE, QcFlag.STUCK, QcFlag.HUMID_PM}
)

Longitude = Field(ge=-180, le=180)
Latitude = Field(ge=-90, le=90)


class RawObservation(BaseModel):
    """One provider value as received. `observed_at` may be naive when the provider
    omits a time zone; the normalizer then assumes UTC and flags it."""

    model_config = ConfigDict(frozen=True)

    source: str = Field(min_length=1)
    station_id: str = Field(min_length=1)
    platform: Platform
    kind: ValueKind = "observation"
    raw_key: str = Field(min_length=1)
    raw_value: str | float | int | None
    raw_unit: str | None = None
    observed_at: datetime
    longitude: float = Longitude
    latitude: float = Latitude
    retrieved_at: AwareDatetime | None = None
    # Distinguishes several mobile samples of one device at the same timestamp.
    sample_id: str | None = None
    sensor_id: str | None = None
    raw_ref: int | None = Field(default=None, gt=0)
    issued_at: AwareDatetime | None = None


class Observation(BaseModel):
    """Canonical value: fixed unit per phenomenon, UTC time, provenance and QC flags."""

    model_config = ConfigDict(frozen=True)

    source: str = Field(min_length=1)
    station_id: str = Field(min_length=1)
    platform: Platform
    kind: ValueKind
    phenomenon: Phenomenon
    value: float | None
    unit: str
    observed_at: AwareDatetime
    longitude: float = Longitude
    latitude: float = Latitude
    raw_key: str
    raw_value: str | None
    raw_unit: str | None
    retrieved_at: AwareDatetime | None = None
    sample_id: str | None = None
    sensor_id: str | None = None
    raw_ref: int | None = Field(default=None, gt=0)
    issued_at: AwareDatetime | None = None
    qc_flags: tuple[QcFlag, ...] = ()

    @field_validator("observed_at", "retrieved_at", "issued_at")
    @classmethod
    def _to_utc(cls, value: datetime | None) -> datetime | None:
        return value.astimezone(UTC) if value is not None else None

    @model_validator(mode="after")
    def _canonical_unit(self) -> "Observation":
        expected = CANONICAL_UNITS[self.phenomenon]
        if self.unit != expected:
            raise ValueError(f"{self.phenomenon} must use {expected!r}, got {self.unit!r}")
        return self

    @property
    def key(self) -> tuple:
        """Idempotent upsert identity; includes the source, unlike station/time alone."""
        return (
            self.source,
            self.station_id,
            self.phenomenon,
            self.observed_at,
            self.sample_id,
            self.sensor_id,
            (self.issued_at or self.raw_ref) if self.kind == "model" else self.issued_at,
        )

    @property
    def usable(self) -> bool:
        return self.value is not None and not BLOCKING_FLAGS.intersection(self.qc_flags)
