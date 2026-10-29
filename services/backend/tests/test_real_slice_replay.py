"""Captured provider responses through storage, processing, HTTP and failure/restart."""

import os
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from real_slice_fixture import AS_OF, SELECTED, replay
from sqlalchemy import create_engine, delete, select

from app.core.config import Settings
from app.ingestion.adapters.weather import OpenMeteoAdapter
from app.ingestion.http import LandingHTTPClient
from app.ingestion.scheduler import Job, RequestSpec, Scheduler
from app.main import create_app
from app.processing.snapshots import process_day
from app.serving.stored import StoredRepository
from app.storage import models as db
from app.storage.repository import Repository
from app.storage.results import ResultRepository


def test_historical_capture_replay_into_real_api_survives_upstream_failure_and_restart(tmp_path):
    url = f"sqlite:///{tmp_path / 'replay.sqlite'}"
    engine = create_engine(url)
    db.metadata.create_all(engine)
    repository = Repository(engine)
    results, snapshot, counts = replay(repository)
    assert all(c["observations"] > 0 for c in counts.values())
    with TestClient(
        create_app(
            Settings(_env_file=None), repository=StoredRepository(results, clock=lambda: AS_OF)
        )
    ) as client:
        body = client.get(f"/v1/days/{SELECTED}").json()
        # Actual captured Open-Meteo fields project as model data; UBA remains measured.
        assert body["hours"][12]["tempC"] is not None
        assert body["hours"][12]["provenance"]["no2"]["kind"] == "model"
        assert body["hours"][12]["provenance"]["no2"]["issuedAt"] is None
        assert body["hours"][12]["rush"] is None
        sensors = client.get("/api/v1/sensors").json()
        assert {s["kind"] for s in sensors} == {"sensebox_home", "lubw"}
        assert all(s["source"] == "measured" for s in sensors)
        assert client.get("/api/v1/grid?date=2026-10-29").json()["cells"]["features"] == []
    watermark = repository.get_watermark("openmeteo_fcst")
    adapter = OpenMeteoAdapter("openmeteo_fcst", bbox=repository.bbox)
    job = Job(
        adapter.source_id,
        timedelta(hours=1),
        adapter,
        lambda wm, start, end: RequestSpec(**adapter.request(wm, start, end)),
    )
    later = AS_OF + timedelta(hours=8)
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(503, stream=httpx.ByteStream(b"fixture upstream unavailable"))
        )
    ) as http:
        failed = Scheduler(
            repository,
            LandingHTTPClient(http, repository, max_attempts=1),
            [job],
            campaign_start=AS_OF - timedelta(days=1),
            clock=lambda: later,
        ).run_once()[0]
    assert failed.status == "UNREACHABLE"
    after = repository.get_watermark("openmeteo_fcst")
    assert after.last_ts == watermark.last_ts and after.last_success_at == watermark.last_success_at
    assert after.state["_scheduler"]["last_run_status"] == "UNREACHABLE"
    # Rebuilding from stored inputs cannot move the original snapshot build/retrieval times.
    assert process_day(results, SELECTED, now=later).build_id == snapshot.build_id
    engine.dispose()
    restarted_engine = create_engine(url)
    restarted = ResultRepository(Repository(restarted_engine))
    try:
        with TestClient(
            create_app(
                Settings(_env_file=None),
                repository=StoredRepository(restarted, clock=lambda: later),
            )
        ) as client:
            body = client.get(f"/v1/days/{SELECTED}").json()
            assert body["status"] == "stale" and body["buildId"] == snapshot.build_id
            assert client.get("/v1/days/2030-01-01").status_code == 404
            status = client.get("/v1/status").json()
            assert (
                next(s for s in status["sources"] if s["id"] == "openmeteo_fcst")["status"]
                == "UNREACHABLE"
            )
    finally:
        restarted_engine.dispose()


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("GREENAIR_TEST_DATABASE_URL"),
    reason="requires dedicated migrated PostgreSQL",
)
def test_captured_sources_through_postgresql_processing_and_http():
    engine = create_engine(os.environ["GREENAIR_TEST_DATABASE_URL"])
    repository = Repository(engine)
    source_ids = ["openmeteo_fcst", "openmeteo_aq", "osem", "uba_226_5"]
    with engine.connect() as conn:
        assert not conn.scalar(
            select(db.raw_payload.c.id).where(db.raw_payload.c.source_id.in_(source_ids)).limit(1)
        ), "capture replay requires a dedicated empty test database"
        assert not conn.scalar(select(db.result_snapshot.c.build_id).limit(1)), (
            "capture replay requires no existing snapshots"
        )
    try:
        results, snapshot, _ = replay(repository)
        with TestClient(
            create_app(
                Settings(_env_file=None), repository=StoredRepository(results, clock=lambda: AS_OF)
            )
        ) as client:
            day = client.get(f"/v1/days/{SELECTED}").json()
            assert (
                day["buildId"] == snapshot.build_id
                and day["hours"][12]["provenance"]["no2"]["kind"] == "model"
            )
            assert {s["kind"] for s in client.get("/v1/sensors").json()["sensors"]} == {
                "sensebox_home",
                "lubw",
            }
    finally:
        with engine.begin() as conn:
            refs = select(db.raw_payload.c.id).where(db.raw_payload.c.source_id.in_(source_ids))
            ids = select(db.observations.c.id).where(db.observations.c.raw_ref.in_(refs))
            conn.execute(delete(db.result_snapshot))  # prechecked empty, dedicated test DB
            conn.execute(delete(db.outbox).where(db.outbox.c.event_id.in_(ids)))
            conn.execute(delete(db.observations).where(db.observations.c.raw_ref.in_(refs)))
            conn.execute(delete(db.feature_receipt).where(db.feature_receipt.c.raw_ref.in_(refs)))
            conn.execute(delete(db.manifest).where(db.manifest.c.raw_ref.in_(refs)))
            conn.execute(delete(db.watermark).where(db.watermark.c.source_id.in_(source_ids)))
            conn.execute(delete(db.raw_payload).where(db.raw_payload.c.source_id.in_(source_ids)))
        engine.dispose()
