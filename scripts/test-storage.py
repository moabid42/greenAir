"""Exercise production migrations in a disposable container, never the evidence DB."""

import json
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4


IMAGE = (
    "timescale/timescaledb-ha:pg17@sha256:"
    "3f0b3f6bdf4912878444a36e6113a18346309583c4d1a61d81a0c511342a1afd"
)
ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, **kwargs)


def main():
    name = "greenair-storage-test-" + uuid4().hex[:12]
    try:
        run(
            "docker", "run", "--detach", "--name", name, "--publish",
            "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=disposable-test",
            "--env", "POSTGRES_DB=greenair_test", IMAGE,
            stdout=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 90
        while subprocess.run(
            ["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode:
            if time.monotonic() >= deadline:
                raise RuntimeError("disposable database did not become ready")
            time.sleep(0.5)
        bindings = json.loads(run(
            "docker", "inspect", name, "--format", "{{json .NetworkSettings.Ports}}",
            capture_output=True,
        ).stdout)
        port = bindings["5432/tcp"][0]["HostPort"]
        url = f"postgresql+psycopg://postgres:disposable-test@127.0.0.1:{port}/greenair_test"
        env = os.environ | {"GREENAIR_DATABASE_URL": url, "GREENAIR_TEST_DATABASE_URL": url}
        prefix = ("uv", "run", "--locked", "--directory", "services/backend")
        run(*prefix, "alembic", "upgrade", "head", env=env)
        run(*prefix, "pytest", "tests/test_ingestion_foundation.py", "-q", env=env)
        run(*prefix, "alembic", "downgrade", "base", env=env)
        remaining = run(
            "docker", "exec", name, "psql", "-U", "postgres", "-d", "greenair_test",
            "-Atc", "SELECT count(*) FROM pg_tables WHERE schemaname='public' "
            "AND tablename IN ('observations','raw_payload','source_watermark',"
            "'ingestion_feature','event_outbox','segment','segment_layer_value',"
            "'ingestion_manifest')", capture_output=True,
        ).stdout.strip()
        if remaining != "0":
            raise RuntimeError("downgrade left ingestion tables behind")
        run(*prefix, "alembic", "upgrade", "head", env=env)
        run(*prefix, "pytest", "tests/test_ingestion_foundation.py", "-q", env=env)
    finally:
        # Only the unique container created by this invocation; its anonymous
        # volume is disposable. Never issue compose down against existing data.
        subprocess.run(["docker", "rm", "--force", "--volumes", name], check=False)


if __name__ == "__main__":
    main()
