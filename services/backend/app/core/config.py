from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GREENAIR_",
        env_file=SERVICE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "greenAir API"
    cors_origins: list[str] = []

    serving_data_mode: Literal["mock", "stored"] = "mock"
    database_url: str | None = None
    snapshot_stale_after_hours: float = Field(default=3, gt=0, le=168)

    station_data_mode: Literal["mock", "live"] = "mock"

    # Green City stationary senseBoxes; `heilbronn` selects the mobile bike boxes instead.
    opensensemap_base_url: str = "https://api.opensensemap.org"
    opensensemap_grouptag: str = "GreenCityHN"
    opensensemap_timeout_seconds: float = 30.0
    # "Live" threshold from the scoring draft (level L(t)); not a provider upload guarantee.
    station_stale_after_minutes: int = 30
