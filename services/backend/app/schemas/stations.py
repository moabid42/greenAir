from datetime import datetime
from typing import Literal

from pydantic import BaseModel

StationState = Literal["online", "stale", "no_data"]


class SensorReading(BaseModel):
    """Latest provider value for one sensor; `raw_value` keeps the original string."""

    sensor_id: str
    title: str
    unit: str | None
    sensor_type: str | None
    value: float | None
    raw_value: str | None
    measured_at: datetime | None


class StationSnapshot(BaseModel):
    """One openSenseMap box as reported by the provider, before status classification."""

    box_id: str
    name: str
    exposure: str | None
    grouptags: list[str]
    longitude: float
    latitude: float
    height_m: float | None
    last_measurement_at: datetime | None
    sensors: list[SensorReading]


class StationStatus(StationSnapshot):
    state: StationState
    age_minutes: float | None


class StationStatusResponse(BaseModel):
    source: Literal["opensensemap", "mock"] = "opensensemap"
    grouptag: str
    retrieved_at: datetime
    stale_after_minutes: int
    counts: dict[StationState, int]
    stations: list[StationStatus]
