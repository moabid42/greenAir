"""Synthetic scheduler tests; provider availability and completeness are separate."""

import json
import os
import subprocess
import sys
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import create_engine, delete, event, func, select
from worker_fixture import START, SyntheticAdapter

from app.ingestion.contracts import PageResult
from app.ingestion.http import LandingHTTPClient
from app.ingestion.scheduler import Job, RequestSpec, Scheduler, source_lock
from app.storage import models as db
from app.storage.repository import Repository

NOW = datetime(2026, 10, 28, 12, tzinfo=UTC)


@pytest.fixture
def repository():
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    db.metadata.create_all(engine)
    yield Repository(engine)
    engine.dispose()


def harness(repository, *, adapter=None, handler=None, clock=lambda: NOW, max_pages=100):
    source = "scheduler_synthetic"
    requests = []

    def request(watermark, start, end):
        requests.append((watermark.last_offset, start, end, watermark.state["_scheduler"]["mode"]))
        return RequestSpec(
            "https://example.test/synthetic", params={"offset": watermark.last_offset}
        )

    def respond(request):
        if handler is not None:
            return handler(request)
        body = json.dumps({"index": int(request.url.params["offset"]), "total": 3}).encode()
        return httpx.Response(
            200, stream=httpx.ByteStream(body), headers={"Content-Type": "application/json"}
        )

    client = httpx.Client(transport=httpx.MockTransport(respond))
    job = Job(source, timedelta(minutes=5), adapter or SyntheticAdapter(source), request)
    scheduler = Scheduler(
        repository,
        LandingHTTPClient(client, repository, sleep=lambda _: None),
        [job],
        campaign_start=START,
        clock=clock,
        max_pages=max_pages,
    )
    return scheduler, job, requests, client


def count(repository, table, condition=None):
    query = select(func.count()).select_from(table)
    if condition is not None:
        query = query.where(condition)
    with repository.engine.connect() as conn:
        return conn.scalar(query)


def test_due_times_gap_backfill_and_manual_replay(repository):
    clock = [NOW]
    scheduler, job, requests, client = harness(repository, clock=lambda: clock[0])
    with client:
        result = scheduler.run_once()[0]
        assert result.status == "SUCCESS" and result.pages == 3
        assert requests[0][1:] == (START, NOW, "backfill")
        assert scheduler.run_once()[0].status == "NOT_DUE"
        clock[0] += timedelta(minutes=5)
        assert scheduler.run_once()[0].status == "SUCCESS"
        assert requests[3][3] == "incremental"
        clock[0] += timedelta(minutes=11)
        assert scheduler.run_once()[0].status == "SUCCESS"
        assert requests[6][1] == START + timedelta(minutes=2)
        assert requests[6][3] == "backfill"
        assert scheduler.run_job(job, backfill=True).counts["observations"] == 0
        assert requests[9][1] == START
    assert count(repository, db.observations) == count(repository, db.outbox) == 3


def test_page_budget_resumes_offset_and_original_window(repository):
    clock = [NOW]
    scheduler, job, requests, client = harness(repository, clock=lambda: clock[0], max_pages=1)
    with client:
        assert scheduler.run_job(job).status == "PARTIAL"
        assert repository.get_watermark(job.source_id).last_offset == 1
        clock[0] += timedelta(hours=2)
        # Reconstructing the scheduler models a restart; its window stays fixed.
        restarted = Scheduler(
            repository, scheduler.http, [job], campaign_start=START, clock=lambda: clock[0]
        )
        assert restarted.run_job(job).pages == 2
        assert [request[0] for request in requests] == [0, 1, 2]
        assert all(request[1:3] == (START, NOW) for request in requests)
    assert count(repository, db.observations) == 3


@pytest.mark.parametrize("status,expected", [(403, "RESTRICTED"), (503, "UNREACHABLE")])
def test_http_failure_records_exact_raw_reference_and_does_not_advance(
    repository, status, expected
):
    scheduler, job, requests, client = harness(
        repository,
        handler=lambda _: httpx.Response(
            status,
            stream=httpx.ByteStream(b"failure evidence"),
            headers={"Content-Type": "text/plain"},
        ),
    )
    with client:
        result = scheduler.run_job(job)
        assert result.status == expected
        assert scheduler.run_job(job).status == "NOT_DUE"
    watermark = repository.get_watermark(job.source_id)
    assert watermark.last_offset == 0 and watermark.last_success_at is None
    assert count(repository, db.observations) == 0
    with repository.engine.connect() as conn:
        manifest = conn.execute(select(db.manifest)).mappings().one()
    raw = repository.get_raw(manifest["raw_ref"])
    assert raw.http_status == status and raw.body == b"failure evidence"
    assert manifest["status"] == expected and manifest["url"] == raw.url


def test_decode_failure_preserves_window_and_raw_without_checkpoint(repository):
    scheduler, job, _, client = harness(
        repository,
        handler=lambda _: httpx.Response(200, stream=httpx.ByteStream(b"invalid JSON")),
    )
    with client:
        assert scheduler.run_job(job).status == "PARTIAL"
    watermark = repository.get_watermark(job.source_id)
    assert watermark.last_offset == 0 and watermark.state["_scheduler"]["in_progress"]
    assert watermark.state["_scheduler"]["window_end"] == NOW.isoformat()
    assert count(repository, db.manifest) == count(repository, db.raw_payload) == 1


def test_missing_manifest_cannot_silently_ingest_or_advance(repository):
    class MissingManifest(SyntheticAdapter):
        def decode(self, raw, raw_ref, watermark):
            return PageResult()

    scheduler, job, _, client = harness(repository, adapter=MissingManifest())
    with client:
        result = scheduler.run_job(job)
    assert result.status == "PARTIAL" and "manifest" in result.error
    assert count(repository, db.observations) == 0
    assert repository.get_watermark(job.source_id).last_offset == 0


def test_source_lock_covers_manual_backfill_and_scheduled_runs(repository):
    scheduler, job, requests, client = harness(repository)
    with client, source_lock(repository.engine, job.source_id) as acquired:
        assert acquired
        assert scheduler.run_job(job).status == "LOCKED"
        assert scheduler.run_job(job, backfill=True).status == "LOCKED"
        assert requests == []
    assert count(repository, db.watermark) == 0


def test_manual_only_source_is_skipped_until_requested(repository):
    scheduler, job, requests, client = harness(repository)
    manual = Job(job.source_id, None, job.adapter, job.request)
    with client:
        assert scheduler.run_job(manual).status == "NOT_DUE"
        assert requests == []
        assert scheduler.run_job(manual, backfill=True).status == "SUCCESS"
        assert scheduler.run_job(manual).status == "NOT_DUE"


def test_registry_and_source_identity_fail_closed(repository):
    scheduler, job, _, client = harness(repository)
    with client, pytest.raises(ValueError, match="unknown source"):
        scheduler.run_once(source="not_registered")
    with pytest.raises(ValueError, match="identities"):
        Job("other", job.cadence, job.adapter, job.request)
    with pytest.raises(ValueError, match="positive"):
        Job(job.source_id, timedelta(0), job.adapter, job.request)


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("GREENAIR_TEST_DATABASE_URL"), reason="requires migrated PostgreSQL"
)
def test_killed_worker_restarts_from_committed_page_without_gaps_or_duplicates():
    """Kill only this test's confirmed-running child, blocked before page two lands."""
    engine = create_engine(os.environ["GREENAIR_TEST_DATABASE_URL"])
    repository = Repository(engine)
    source = "scheduler_kill_test_" + uuid4().hex
    requests, blocked, release = [], threading.Event(), threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            params = parse_qs(urlsplit(self.path).query)
            index = int(params["offset"][0])
            requests.append(params)
            if index == 1 and not release.is_set():
                blocked.set()
                release.wait(30)
            body = json.dumps({"index": index, "total": 3}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    backend = Path(__file__).resolve().parents[1]
    env = os.environ | {
        "GREENAIR_DATABASE_URL": os.environ["GREENAIR_TEST_DATABASE_URL"],
        "GREENAIR_FIXTURE_SOURCE": source,
        "GREENAIR_FIXTURE_URL": f"http://127.0.0.1:{server.server_port}/synthetic",
        "PYTHONPATH": str(backend / "tests") + os.pathsep + str(backend),
    }
    command = [
        sys.executable,
        "-m",
        "app.ingestion.worker",
        "--backfill",
        "--source",
        source,
        "--registry",
        "worker_fixture:get_jobs",
        "--bus",
        "memory",
    ]
    child = None
    try:
        child = subprocess.Popen(
            command, cwd=backend, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        assert blocked.wait(20), "child never reached the second page"
        assert child.poll() is None, "child must be confirmed running before SIGKILL"
        assert repository.get_watermark(source).last_offset == 1
        assert count(repository, db.observations, db.observations.c.source == source) == 1
        with source_lock(engine, source) as acquired:
            assert not acquired, "another process must not enter even for manual backfill"
        original_window = repository.get_watermark(source).state["_scheduler"].copy()
        child.kill()
        child.communicate(timeout=10)
        release.set()
        restarted = subprocess.run(
            command, cwd=backend, env=env, capture_output=True, text=True, timeout=30
        )
        assert restarted.returncode == 0, restarted.stdout + restarted.stderr
        assert repository.get_watermark(source).last_offset == 3
        assert count(repository, db.observations, db.observations.c.source == source) == 3
        with engine.connect() as conn:
            values = (
                conn.execute(
                    select(db.observations.c.value)
                    .where(db.observations.c.source == source)
                    .order_by(db.observations.c.ts_utc)
                )
                .scalars()
                .all()
            )
        assert values == [0, 1, 2]
        assert [int(params["offset"][0]) for params in requests] == [0, 1, 1, 2]
        assert all(params["window_end"] == [original_window["window_end"]] for params in requests)
        repeated = subprocess.run(
            command, cwd=backend, env=env, capture_output=True, text=True, timeout=30
        )
        assert repeated.returncode == 0, repeated.stdout + repeated.stderr
        assert count(repository, db.observations, db.observations.c.source == source) == 3
        assert '"observations": 0' in repeated.stdout
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.communicate(timeout=10)
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        with engine.begin() as conn:
            ids = select(db.observations.c.id).where(db.observations.c.source == source)
            conn.execute(delete(db.outbox).where(db.outbox.c.event_id.in_(ids)))
            conn.execute(delete(db.observations).where(db.observations.c.source == source))
            conn.execute(delete(db.manifest).where(db.manifest.c.source_id == source))
            conn.execute(delete(db.watermark).where(db.watermark.c.source_id == source))
            conn.execute(delete(db.raw_payload).where(db.raw_payload.c.source_id == source))
        engine.dispose()


def test_registry_is_real_bounded_and_request_bindings_are_distinct():
    from app.ingestion.contracts import Watermark
    from app.ingestion.registry import get_jobs
    from app.ingestion.settings import IngestionSettings

    jobs = get_jobs(IngestionSettings(database_url="postgresql+psycopg://unused/test"))
    assert len(jobs) == 9 and len({job.source_id for job in jobs}) == 9
    for job in jobs:
        assert job.lookback == timedelta(days=1)
        spec = job.request(Watermark(source_id=job.source_id), NOW - timedelta(days=1), NOW)
        if job.source_id.startswith("uba"):
            _, station, component = job.source_id.split("_")
            assert spec.params["station"] == station and spec.params["component"] == component
        if job.source_id.startswith("openmeteo"):
            assert spec.params["forecast_days"] == 2 and spec.params["timeformat"] == "unixtime"
        assert spec.method == "GET"


def test_rate_limit_deferral_survives_restart_even_for_manual_backfill(repository):
    clock = [NOW]
    scheduler, job, _, client = harness(
        repository,
        clock=lambda: clock[0],
        handler=lambda _: httpx.Response(
            429,
            stream=httpx.ByteStream(b"rate limited"),
            headers={"Retry-After": "86400"},
        ),
    )
    with client:
        assert scheduler.run_once()[0].status == "UNREACHABLE"
        assert count(repository, db.raw_payload) == 1
        clock[0] += timedelta(hours=2)
        restarted = Scheduler(
            repository, scheduler.http, [job], campaign_start=START, clock=lambda: clock[0]
        )
        assert restarted.run_once()[0].status == "NOT_DUE"
        assert restarted.run_once(backfill=True)[0].status == "NOT_DUE"
        wm = repository.get_watermark(job.source_id)
        assert wm.last_success_at is None and wm.last_offset == 0
        assert datetime.fromisoformat(wm.state["_scheduler"]["retry_after_at"]) == NOW + timedelta(
            days=1
        )


def test_invalid_partial_payload_does_not_become_last_success(repository):
    from app.ingestion.adapters.osem import OsemAdapter
    from app.ingestion.contracts import Watermark

    adapter = OsemAdapter()
    job = Job(
        "osem", timedelta(minutes=5), adapter, lambda *args: RequestSpec("https://example.test/bad")
    )
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                stream=httpx.ByteStream(b"invalid json"),
                headers={"content-type": "application/json"},
            )
        )
    ) as client:
        scheduler = Scheduler(
            repository, LandingHTTPClient(client, repository), [job], campaign_start=START
        )
        assert scheduler.run_once()[0].status == "PARTIAL"
    wm = repository.get_watermark("osem")
    assert wm.last_success_at is None and wm.last_ts is None
    assert wm.last_offset == Watermark(source_id="osem").last_offset


def test_one_broken_request_builder_does_not_stop_independent_jobs(repository):
    scheduler, job, _, client = harness(repository)
    broken_adapter = SyntheticAdapter("broken_source")

    def broken(*args):
        raise ValueError("synthetic request failure")

    scheduler.jobs = [Job("broken_source", job.cadence, broken_adapter, broken), job]
    with client:
        results = scheduler.run_once()
    assert [r.status for r in results] == ["PARTIAL", "SUCCESS"]
    assert "synthetic request failure" in results[0].error
