"""Explicit user-approved ingestion settings, independent of FastAPI startup."""

from datetime import UTC, datetime
from math import isfinite

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import SERVICE_ROOT


class IngestionSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GREENAIR_",
        env_file=SERVICE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    bbox: tuple[float, float, float, float] = (9.05, 49.05, 9.35, 49.25)
    campaign_start: datetime = datetime(2025, 12, 5, tzinfo=UTC)
    page_size: int = Field(default=1000, ge=1, le=5000)
    request_timeout_seconds: float = Field(default=30, gt=0, le=120)
    max_attempts: int = Field(default=3, ge=1, le=5)
    max_response_bytes: int = Field(default=16_777_216, ge=1024, le=268_435_456)

    @field_validator("bbox")
    @classmethod
    def valid_bbox(cls, value):
        west, south, east, north = value
        if not all(isfinite(x) for x in value):
            raise ValueError("bbox must contain finite coordinates")
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("bbox must be ordered west,south,east,north in WGS84")
        return value

    @field_validator("campaign_start")
    @classmethod
    def aware_campaign_start(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("campaign_start requires an explicit time zone")
        return value.astimezone(UTC)
