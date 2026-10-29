"""Per-value originals and identity, explicit nulls and unknown model issuance."""

from alembic import op

revision = "0003_value_provenance"
down_revision = "0002_feature_receipts"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE observations ADD COLUMN provenance JSONB")
    op.execute("ALTER TABLE observations ALTER COLUMN value DROP NOT NULL")
    op.execute("ALTER TABLE observations DROP CONSTRAINT uq_observation_natural")
    # Revision 0001 did not name its issuance check; PostgreSQL derives the
    # name from referenced columns. Discover it rather than assume a suffix.
    op.execute("""DO $$ DECLARE constraint_name TEXT; BEGIN
        FOR constraint_name IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'observations'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%issued_at%'
        LOOP EXECUTE format('ALTER TABLE observations DROP CONSTRAINT %I', constraint_name);
        END LOOP;
        END $$""")


def downgrade():
    # Fail transactionally rather than silently drop values incompatible with 0002.
    op.execute("ALTER TABLE observations ALTER COLUMN value SET NOT NULL")
    op.execute("ALTER TABLE observations ADD CHECK (kind != 'forecast' OR issued_at IS NOT NULL)")
    op.execute("""ALTER TABLE observations ADD CONSTRAINT uq_observation_natural
        UNIQUE NULLS NOT DISTINCT (source, station_id, phenomenon, ts_utc, issued_at)""")
    op.execute("ALTER TABLE observations DROP COLUMN provenance")
