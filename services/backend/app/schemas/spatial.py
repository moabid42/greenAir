"""Versioned, traceable spatial artifacts; static input time is not observation time."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

from app.processing.spatial import Segment, SegmentLayer

SPATIAL_VERSION = "spatial-v1"


class SpatialInput(BaseModel):
    collection: str
    feature_id: str
    raw_ref: int
    captured_at: AwareDatetime
    unit: str
    method: str
    boxes: int | None = None
    points: int | None = None


class SpatialStreet(BaseModel):
    name: str
    segment: Segment
    layer: SegmentLayer
    inputs: dict[str, SpatialInput]
    station_distance_km: float | None = None


class CaptureSummary(BaseModel):
    collection: str
    captured_at: AwareDatetime
    retrieved_at: AwareDatetime
    reported_total: int
    local: int
    filtered: int
    raw_refs: list[int]
    guarantee: Literal["count-consistent offset capture"] = "count-consistent offset capture"


class SpatialResult(BaseModel):
    streets: list[SpatialStreet]
    captures: list[CaptureSummary]
    reference_start: AwareDatetime
    reference_end: AwareDatetime
    measured_levels: dict[str, dict[str, float]]
    observation_raw_refs: list[int]
    issues: dict[str, int] = Field(default_factory=dict)
    pm_coverage: dict[str, int] = Field(default_factory=dict)
    methods: list[str] = Field(
        default_factory=lambda: [
            "unique exact directed geometry and opaque osmid join",
            "roughness percentage / 100; overtaking share below 150 cm; normalized flow proxy",
            "PM sample ratios against measured stationary UTC hourly levels; median and shrinkage",
            "station IDW requires 24 shared hours, within 2 km; no forecast as spatial evidence",
            "provider survey/build time unknown; zero PM confidence when no spatial evidence",
        ]
    )
