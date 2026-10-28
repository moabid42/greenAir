"""Provider-independent ingestion contracts; no source field assumptions."""

import math
import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# The task's approved common units. Unknown provider units must not be guessed.
UNITS = {
    **dict.fromkeys(("pm1", "pm25", "pm4", "pm10", "no2", "o3"), "µg/m³"),
    "temp": "°C",
    "rh": "%",
    "pressure_msl": "hPa",
    "wind_speed": "km/h",
    "wind_dir": "°",
    "precip": "mm",
    "cloud_cover": "%",
    "sunshine": "s",
    "uv_index": "1",
    "bike_count": "count",
    "speed": "km/h",
    "overtaking_distance": "m",
    "overtaking_confidence": "%",
}


def utc(value: datetime) -> datetime:
    """Reject timezone guesses; canonical values are normalized to UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("an explicit timestamp timezone is required")
    return value.astimezone(UTC)


class Geometry(BaseModel):
    """Small validated GeoJSON contract, keeping longitude before latitude."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: Literal["Point", "LineString", "Polygon", "MultiLineString", "MultiPolygon"]
    coordinates: list[Any]

    @model_validator(mode="after")
    def valid_coordinates(self):
        def point(item):
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                raise ValueError("WGS84 points need exactly [longitude, latitude]")
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in item):
                raise ValueError("coordinates must be numeric")
            lon, lat = item
            if not all(math.isfinite(v) for v in item) or not (
                -180 <= lon <= 180 and -90 <= lat <= 90
            ):
                raise ValueError("invalid WGS84 coordinates")

        def line(items, *, ring=False):
            if not isinstance(items, list) or len(items) < (4 if ring else 2):
                raise ValueError("insufficient geometry vertices")
            for item in items:
                point(item)
            if ring and items[0] != items[-1]:
                raise ValueError("polygon rings must be closed")

        def polygon(items):
            if not isinstance(items, list) or not items:
                raise ValueError("polygon must contain a ring")
            for ring in items:
                line(ring, ring=True)

        match self.type:
            case "Point":
                point(self.coordinates)
            case "LineString":
                line(self.coordinates)
            case "Polygon":
                polygon(self.coordinates)
            case "MultiLineString":
                if not self.coordinates:
                    raise ValueError("empty geometry")
                for item in self.coordinates:
                    line(item)
            case "MultiPolygon":
                if not self.coordinates:
                    raise ValueError("empty geometry")
                for item in self.coordinates:
                    polygon(item)
        return self

    def inside_bbox(self, bbox: tuple[float, float, float, float]) -> bool:
        west, south, east, north = bbox
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("bbox must be [west, south, east, north]")

        def inside(item):
            if len(item) == 2 and all(isinstance(v, (int, float)) for v in item):
                return west <= item[0] <= east and south <= item[1] <= north
            return all(inside(child) for child in item)

        return inside(self.coordinates)


class Observation(BaseModel):
    """Canonical ingest value. Source originals remain in the referenced raw body."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    source: str = Field(min_length=1)
    station_id: str = Field(min_length=1)
    geom: Geometry
    phenomenon: str
    value: float
    unit: str = Field(min_length=1)
    ts_utc: datetime
    kind: Literal["observation", "forecast", "derived"] = "observation"
    issued_at: datetime | None = None
    qc_flags: list[str] = Field(default_factory=list)
    raw_ref: int = Field(gt=0)

    @field_validator("ts_utc", "issued_at")
    @classmethod
    def require_utc(cls, value):
        return utc(value) if value is not None else None

    @model_validator(mode="after")
    def validate_contract(self):
        if self.geom.type not in {"Point", "LineString"}:
            raise ValueError("observation geometry must be Point or LineString")
        if self.phenomenon not in UNITS and not re.fullmatch(
            r"(?:pollen|surface)_[a-z][a-z0-9_]*", self.phenomenon
        ):
            raise ValueError("phenomenon is outside the controlled vocabulary")
        expected = UNITS.get(self.phenomenon)
        if expected and self.unit != expected:
            raise ValueError(f"canonical {self.phenomenon} unit is {expected}")
        if self.kind == "forecast" and self.issued_at is None:
            raise ValueError("forecast requires issued_at")
        return self
