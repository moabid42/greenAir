"""Versioned processing snapshots, kept independently of API process lifetime."""

from alembic import op

revision = "0004_result_snapshots"
down_revision = "0003_value_provenance"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE result_snapshot (
        build_id VARCHAR(64) PRIMARY KEY,
        resource_key TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        input_sha256 VARCHAR(64) NOT NULL,
        built_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(16) NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'UNAVAILABLE')),
        payload JSONB NOT NULL,
        CONSTRAINT uq_snapshot_input UNIQUE (resource_key, schema_version, input_sha256)
    )""")
    op.execute(
        "CREATE INDEX ix_snapshot_resource_build ON result_snapshot (resource_key, built_at)"
    )


def downgrade():
    op.execute("DROP TABLE result_snapshot")
