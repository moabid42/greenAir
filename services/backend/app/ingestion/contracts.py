"""Adapter boundary: fetch/land raw first, then decode into canonical records."""

from datetime import datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.observation import Geometry, Observation, utc


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RawPayload(Contract):
    source_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    method: str = "GET"
    request_params: dict[str, Any] = Field(default_factory=dict)
    request_body: bytes | None = None
    http_status: int | None = Field(default=None, ge=100, le=599)
    response_headers: dict[str, str] = Field(default_factory=dict)
    retrieved_at_utc: datetime
    body: bytes
    error: str | None = None

    @field_validator("retrieved_at_utc")
    @classmethod
    def require_utc(cls, value):
        return utc(value)


class Watermark(Contract):
    source_id: str
    last_ts: datetime | None = None
    last_offset: int = Field(default=0, ge=0)
    last_modified: str | None = None
    last_success_at: datetime | None = None
    state: dict[str, Any] = Field(default_factory=dict)

    @field_validator("last_ts", "last_success_at")
    @classmethod
    def require_utc(cls, value):
        return utc(value) if value is not None else None


class Manifest(Contract):
    source_id: str
    url: str
    retrieved_at_utc: datetime
    http_status: int | None = None
    content_type: str | None = None
    number_matched_reported: int | None = Field(default=None, ge=0)
    rows_downloaded: int = Field(default=0, ge=0)
    rows_ingested: int = Field(default=0, ge=0)
    earliest_observed_at: datetime | None = None
    latest_observed_at: datetime | None = None
    sha256: str | None = None
    status: Literal["SUCCESS", "PARTIAL", "UNREACHABLE", "RESTRICTED"]
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("retrieved_at_utc", "earliest_observed_at", "latest_observed_at")
    @classmethod
    def require_utc(cls, value):
        return utc(value) if value is not None else None


class SegmentRecord(Contract):
    """Stable road identity. Snapshot properties also belong in LayerRecord."""

    collection: str
    feature_id: str
    osmid: str | None = None
    geom: Geometry
    raw_ref: int = Field(gt=0)


class LayerRecord(Contract):
    collection: str
    feature_id: str
    built_at: datetime
    geom: Geometry
    properties: dict[str, Any]
    raw_ref: int = Field(gt=0)
    segment_id: int | None = None
    number_of_boxes: int | None = Field(default=None, ge=0)
    points_in_segment: int | None = Field(default=None, ge=0)

    @field_validator("built_at")
    @classmethod
    def require_utc(cls, value):
        return utc(value)


class PageResult(Contract):
    observations: list[Observation] = Field(default_factory=list)
    segments: list[SegmentRecord] = Field(default_factory=list)
    layers: list[LayerRecord] = Field(default_factory=list)
    receipts: list["FeatureReceipt"] = Field(default_factory=list)
    next_watermark: Watermark | None = None
    manifest: Manifest | None = None


class FeatureReceipt(Contract):
    """Distinct source record accounted for in a completed page transaction.

    This ledger counts provider records, rather than multiplying a record by
    its canonical sensor channels. Adapters use a verified provider identity or
    explicitly documented content hash. Static layers supply a stable build key;
    observations use the default `observations` key.
    """

    source_id: str = Field(min_length=1)
    feature_id: str = Field(min_length=1)
    build_key: str = "observations"
    raw_ref: int = Field(gt=0)
    outcome: Literal["INGESTED", "FILTERED", "UNRESOLVED"]
    reason: str | None = None
    observed_at: datetime | None = None
    canonical_count: int = Field(default=0, ge=0)

    @field_validator("observed_at")
    @classmethod
    def require_utc(cls, value):
        return utc(value) if value is not None else None


class Adapter(Protocol):
    """No network parsing before Repository.land_raw commits raw_ref.

    The caller fetches and lands a response, then supplies the *persisted* raw
    bytes here. Adapter state advances only with Repository.ingest_page. Unknown
    units/timezones or fields must leave a PARTIAL manifest, not guessed values.
    """

    source_id: str

    def decode(self, raw: RawPayload, raw_ref: int, watermark: Watermark) -> PageResult: ...
