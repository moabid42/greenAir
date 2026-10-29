"""Exercise daemon orchestration, persisted bootstrap decisions and partial inputs."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.ingestion import runtime
from app.ingestion.scheduler import RunResult
from app.ingestion.settings import IngestionSettings


def test_runtime_resumes_bootstrap_preserves_completed_layers_and_processes_partial(monkeypatch):
    now = datetime.now(UTC)
    marks = {
        "complete": SimpleNamespace(last_success_at=now, state={}),
        "resume": SimpleNamespace(last_success_at=now, state={"_scheduler": {"in_progress": True}}),
        "new": SimpleNamespace(last_success_at=None, state={}),
        "old": SimpleNamespace(last_success_at=now - timedelta(days=8), state={}),
        "deferred": SimpleNamespace(
            last_success_at=None,
            state={
                "_scheduler": {
                    "in_progress": True,
                    "next_due_at": (now + timedelta(hours=1)).isoformat(),
                }
            },
        ),
    }
    calls, processed, disposed = [], [], []
    jobs = [SimpleNamespace(source_id=k) for k in marks]
    engine = SimpleNamespace(dispose=lambda: disposed.append(True))
    repository = SimpleNamespace(get_watermark=lambda source: marks[source])

    class Scheduler:
        def __init__(self, repository, http, registered, **kwargs):
            self.jobs = registered

        def run_once(self):
            calls.append("normal")
            return [RunResult("weather", "PARTIAL")]

        def run_job(self, job, backfill=False):
            calls.append((job.source_id, backfill))
            return RunResult(job.source_id, "SUCCESS")

    monkeypatch.setattr(
        runtime, "IngestionSettings", lambda: IngestionSettings(database_url="sqlite://")
    )
    monkeypatch.setattr(runtime, "create_engine", lambda *a, **kw: engine)
    monkeypatch.setattr(runtime, "Repository", lambda *a, **kw: repository)
    monkeypatch.setattr(runtime, "LandingHTTPClient", lambda *a, **kw: None)
    monkeypatch.setattr(runtime, "Scheduler", Scheduler)
    monkeypatch.setattr(runtime, "get_jobs", lambda _: [])
    monkeypatch.setattr(runtime, "get_spatial_jobs", lambda _: jobs)
    monkeypatch.setattr(runtime.processing, "main", lambda args: processed.append(args) or 2)
    assert runtime.main(["--max-cycles", "2", "--interval", "1"]) == 0
    assert calls == ["normal", ("resume", False), ("new", True), ("old", True)] * 2
    assert processed == [[], ["--spatial", "--reference-days", "14"], []]
    assert disposed == [True]
