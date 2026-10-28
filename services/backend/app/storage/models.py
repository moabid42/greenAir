"""One-database schema. PostgreSQL extensions are installed by Alembic only.

SQLite variants support portable transaction tests; they do not emulate PostGIS
or TimescaleDB. Production deployments must run the PostgreSQL migration.
"""

from datetime import UTC

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.types import TypeDecorator, UserDefinedType

from app.schemas.observation import utc


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return utc(value) if value is not None else None

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        # SQLite drops tzinfo. PostgreSQL always supplies it for timestamptz.
        if value.tzinfo is None and dialect.name == "sqlite":
            value = value.replace(tzinfo=UTC)
        return utc(value)


class PostGISGeometry(UserDefinedType):
    cache_ok = True

    def __init__(self, subtype="Geometry"):
        self.subtype = subtype

    def get_col_spec(self, **kw):
        return f"geometry({self.subtype},4326)"


metadata = MetaData()
document = JSON().with_variant(JSONB(), "postgresql")
integer_id = BigInteger().with_variant(Integer(), "sqlite")


def geometry(subtype="Geometry"):
    return PostGISGeometry(subtype).with_variant(JSON(), "sqlite")


raw_payload = Table(
    "raw_payload",
    metadata,
    Column("id", integer_id, Identity(), primary_key=True),
    Column("source_id", Text, nullable=False),
    Column("url", Text, nullable=False),
    Column("method", String(16), nullable=False),
    Column("request_params", document, nullable=False),
    Column("request_body", LargeBinary),
    Column("http_status", Integer),
    Column("response_headers", document, nullable=False),
    Column("retrieved_at_utc", UTCDateTime(), nullable=False),
    Column("sha256", String(64), nullable=False),
    Column("body", LargeBinary, nullable=False),
    Column("error", Text),
    CheckConstraint("http_status IS NULL OR http_status BETWEEN 100 AND 599"),
    Index("ix_raw_source_retrieved", "source_id", "retrieved_at_utc"),
    Index("ix_raw_sha256", "sha256"),
)

observations = Table(
    "observations",
    metadata,
    # Timescale unique/primary keys must contain the time partition column.
    Column("id", String(64), primary_key=True),
    Column("ts_utc", UTCDateTime(), primary_key=True),
    Column("source", Text, nullable=False),
    Column("station_id", Text, nullable=False),
    Column("geom", geometry(), nullable=False),
    Column("phenomenon", Text, nullable=False),
    Column("value", Float, nullable=False),
    Column("unit", Text, nullable=False),
    Column("kind", String(16), nullable=False),
    Column("issued_at", UTCDateTime()),
    Column("qc_flags", JSON().with_variant(ARRAY(Text()), "postgresql"), nullable=False),
    Column("raw_ref", ForeignKey("raw_payload.id"), nullable=False),
    CheckConstraint("kind IN ('observation', 'forecast', 'derived')"),
    CheckConstraint("kind != 'forecast' OR issued_at IS NOT NULL"),
    UniqueConstraint(
        "source",
        "station_id",
        "phenomenon",
        "ts_utc",
        "issued_at",
        name="uq_observation_natural",
        postgresql_nulls_not_distinct=True,
    ),
    Index("ix_observations_station_phenomenon_time", "station_id", "phenomenon", "ts_utc"),
    Index("ix_observations_source_time", "source", "ts_utc"),
)

segment = Table(
    "segment",
    metadata,
    Column("id", integer_id, Identity(), primary_key=True),
    Column("collection", Text, nullable=False),
    Column("feature_id", Text, nullable=False),
    Column("osmid", Text),
    Column("geom", geometry("LineString"), nullable=False),
    Column("raw_ref", ForeignKey("raw_payload.id"), nullable=False),
    UniqueConstraint("collection", "feature_id", name="uq_segment_identity"),
    Index("ix_segment_osmid", "osmid"),
)

segment_layer_value = Table(
    "segment_layer_value",
    metadata,
    Column("id", integer_id, Identity(), primary_key=True),
    Column("collection", Text, nullable=False),
    Column("feature_id", Text, nullable=False),
    Column("built_at", UTCDateTime(), nullable=False),
    Column("segment_id", ForeignKey("segment.id")),
    Column("geom", geometry(), nullable=False),
    Column("properties", document, nullable=False),
    Column("number_of_boxes", Integer),
    Column("points_in_segment", Integer),
    Column("raw_ref", ForeignKey("raw_payload.id"), nullable=False),
    UniqueConstraint("collection", "feature_id", "built_at", name="uq_layer_build_identity"),
    Index("ix_layer_latest", "collection", "built_at"),
    Index("ix_layer_segment", "segment_id"),
)

watermark = Table(
    "source_watermark",
    metadata,
    Column("source_id", Text, primary_key=True),
    Column("last_ts", UTCDateTime()),
    Column("last_offset", BigInteger, nullable=False),
    Column("last_modified", Text),
    Column("last_success_at", UTCDateTime()),
    Column("state", document, nullable=False),
    CheckConstraint("last_offset >= 0"),
)

manifest = Table(
    "ingestion_manifest",
    metadata,
    Column("id", integer_id, Identity(), primary_key=True),
    Column("raw_ref", ForeignKey("raw_payload.id"), nullable=False),
    Column("source_id", Text, nullable=False),
    Column("url", Text, nullable=False),
    Column("retrieved_at_utc", UTCDateTime(), nullable=False),
    Column("http_status", Integer),
    Column("content_type", Text),
    Column("number_matched_reported", BigInteger),
    Column("rows_downloaded", BigInteger, nullable=False),
    Column("rows_ingested", BigInteger, nullable=False),
    Column("earliest_observed_at", UTCDateTime()),
    Column("latest_observed_at", UTCDateTime()),
    Column("sha256", String(64)),
    Column("status", String(16), nullable=False),
    Column("details", document, nullable=False),
    CheckConstraint("status IN ('SUCCESS', 'PARTIAL', 'UNREACHABLE', 'RESTRICTED')"),
    Index("ix_manifest_source_time", "source_id", "retrieved_at_utc"),
)

outbox = Table(
    "event_outbox",
    metadata,
    Column("event_id", String(64), primary_key=True),
    Column("topic", Text, nullable=False),
    Column("payload", document, nullable=False),
    Column("created_at", UTCDateTime(), nullable=False),
    Column("delivered_at", UTCDateTime()),
    Index("ix_outbox_pending", "delivered_at", "created_at"),
)

feature_receipt = Table(
    "ingestion_feature",
    metadata,
    Column("source_id", Text, primary_key=True),
    Column("feature_id", Text, primary_key=True),
    Column("build_key", Text, primary_key=True),
    Column("raw_ref", ForeignKey("raw_payload.id"), nullable=False),
    Column("outcome", String(16), nullable=False),
    Column("reason", Text),
    Column("observed_at", UTCDateTime()),
    Column("canonical_count", Integer, nullable=False),
    CheckConstraint("outcome IN ('INGESTED', 'FILTERED', 'UNRESOLVED')"),
    CheckConstraint("canonical_count >= 0"),
    Index("ix_ingestion_feature_raw", "raw_ref"),
)
