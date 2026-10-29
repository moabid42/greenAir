"""Pipeline status reports persisted facts and never manufactures traffic analytics."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from test_stored_serving import NOW, app_for, seed

from app.core.config import Settings
from app.main import create_app
from app.storage import models as db
from app.storage.repository import Repository


def test_status_uses_stored_counts_builds_and_null_analytics(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'status.sqlite'}")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    results, snapshot = seed(repository, NOW.date())
    with engine.begin() as conn:
        conn.execute(
            db.watermark.insert().values(
                source_id="osem",
                last_ts=NOW - timedelta(hours=1),
                last_offset=0,
                last_success_at=NOW - timedelta(minutes=5),
                state={
                    "_scheduler": {
                        "last_run_status": "UNREACHABLE",
                        "last_attempt_at": NOW.isoformat(),
                    }
                },
            )
        )
    with TestClient(app_for(results)) as client:
        response = client.get("/api/v1/data-status")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert body["mode"] == "stored"
        assert body["observations"] == 121
        assert body["roads"] == body["layers"] == 0
        assert body["client_uploads"] is None and body["total_requests"] is None
        assert any(b["build_id"] == snapshot.build_id for b in body["builds"])
        source = body["sources"][0]
        assert source["status"] == "UNREACHABLE"
        assert source["last_success_at"] == "2026-10-29T09:55:00Z"
        assert source["latest_observed_at"] == "2026-10-29T09:00:00Z"
        assert "url" not in source and "state" not in source
    engine.dispose()


def test_mock_status_does_not_invent_pipeline_counts():
    with TestClient(create_app(Settings(_env_file=None, serving_data_mode="mock"))) as client:
        body = client.get("/api/v1/data-status").json()
        assert body["mode"] == "mock" and body["observations"] is None
        assert body["sources"] == body["builds"] == []


def test_storage_failure_returns_typed_unavailable(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'empty.sqlite'}")
    from app.serving.stored import StoredRepository
    from app.storage.results import ResultRepository

    app = create_app(
        Settings(_env_file=None), StoredRepository(ResultRepository(Repository(engine)))
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/data-status")
        assert response.status_code == 503
        assert "unavailable" in response.json()["error"]["message"]
    engine.dispose()
