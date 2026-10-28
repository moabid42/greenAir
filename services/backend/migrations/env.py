"""Run explicitly, never from API startup."""

import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.storage.models import metadata

config = context.config
url = os.environ.get("GREENAIR_DATABASE_URL")
if not url:
    raise RuntimeError("set GREENAIR_DATABASE_URL explicitly before running migrations")
config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))


def run_migrations_offline():
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    engine = engine_from_config(
        config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with engine.connect() as connection:
        if connection.dialect.name != "postgresql":
            raise RuntimeError("production migrations require PostgreSQL/TimescaleDB/PostGIS")
        context.configure(connection=connection, target_metadata=metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
