"""Processing output contract (`scores.updated`). All values here are derived or
forecast, never observations; `scoring_version` names the formula draft used."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

from app.scoring.profiles import Profile

SCORING_VERSION = "docs/scoring.md v0.1"


class ScoreRecord(BaseModel):
    kind: Literal["derived"] = "derived"
    scoring_version: str = SCORING_VERSION
    segment_id: str
    profile: Profile
    at: AwareDatetime
    hours_ahead: int = Field(ge=1)
    score: float | None = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    components: dict[str, float]
    gates: dict[str, float]


class BestTime(BaseModel):
    segment_id: str
    profile: Profile
    windows: list[tuple[AwareDatetime, float]]


class ForecastSummary(BaseModel):
    kind: Literal["forecast"] = "forecast"
    phenomenon: str
    method: str
    correction: float | None
    points: int


class LayerRecord(BaseModel):
    kind: Literal["derived"] = "derived"
    segment_id: str
    pm_ratio: float
    pm_samples: int
    pm_source: Literal["samples", "idw", "none"]
    heat_anomaly: float | None
    heat_samples: int
    roughness: float | None
    overtaking_share: float | None
    flow: float | None


class NormalizationSummary(BaseModel):
    observations: int
    duplicates: int
    unmapped_keys: dict[str, int]
    qc_flags: dict[str, int]


class PipelineResult(BaseModel):
    issued_at: AwareDatetime
    generated_at: AwareDatetime
    normalization: NormalizationSummary
    forecasts: list[ForecastSummary]
    layers: list[LayerRecord]
    scores: list[ScoreRecord]
    best_times: list[BestTime]
