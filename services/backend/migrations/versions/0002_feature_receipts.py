"""Account for distinct provider records separately from sensor channel rows."""

from alembic import op

revision = "0002_feature_receipts"
down_revision = "0001_ingestion"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE ingestion_feature (
source_id TEXT NOT NULL,
feature_id TEXT NOT NULL,
build_key TEXT NOT NULL,
raw_ref BIGINT NOT NULL REFERENCES raw_payload(id),
outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('INGESTED','FILTERED','UNRESOLVED')),
reason TEXT,
observed_at TIMESTAMPTZ,
canonical_count INTEGER NOT NULL CHECK (canonical_count >= 0),
PRIMARY KEY (source_id, feature_id, build_key)
)""")
    op.execute("CREATE INDEX ix_ingestion_feature_raw ON ingestion_feature (raw_ref)")


def downgrade():
    op.execute("DROP TABLE ingestion_feature")
