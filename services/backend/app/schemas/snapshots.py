"""Versioned processing artifacts, separate from public API projections."""

from datetime import date
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

from app.schemas.observations import Observation

VERSION = "conditions-v1"


class Reading(BaseModel):
    observation: Observation
    exposure: Literal["indoor", "outdoor"] | None = None
    station_name: str | None = None


class DayResult(BaseModel):
    date: date
    timezone: Literal["Europe/Berlin"] = "Europe/Berlin"
    # Exact UTC instants, including 23/25-hour Berlin days; serving handles slots.
    instants: list[AwareDatetime]
    readings: list[Reading]
    measured_levels: dict[str, dict[str, float]]
    model_series: dict[str, dict[str, float]]
    missing_model_slots: dict[str, int]
    issues: dict[str, int] = Field(default_factory=dict)


class SensorResult(BaseModel):
    readings: list[Reading]
    issues: dict[str, int] = Field(default_factory=dict)


class ResultSnapshot(BaseModel):
    build_id: str
    resource_key: str
    schema_version: Literal["conditions-v1"] = VERSION
    input_sha256: str
    built_at: AwareDatetime
    status: Literal["SUCCESS", "PARTIAL", "UNAVAILABLE"]
    payload: dict
