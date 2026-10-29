"""Selected real source captures through spatial processing, API and nullable contracts."""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from real_slice_fixture import SELECTED, replay
from spatial_fixture import AS_OF, replay_layers
from sqlalchemy import create_engine

from app.core.config import Settings
from app.main import create_app
from app.processing.stored_spatial import process_spatial
from app.serving.stored import StoredRepository
from app.storage import models as db
from app.storage.repository import Repository


@pytest.fixture
def seeded(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'spatial.sqlite'}")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    results, day, _ = replay(repository)
    replay_layers(repository)
    spatial = process_spatial(results, since=AS_OF - timedelta(days=7), now=AS_OF)
    provider = StoredRepository(results, clock=lambda: AS_OF)
    with TestClient(create_app(Settings(_env_file=None), repository=provider)) as client:
        yield client, spatial, results, provider
    engine.dispose()


def test_real_grid_carries_static_coverage_and_city_model_values_without_fake_pollution(seeded):
    client, spatial, _, _ = seeded
    day = client.get(f"/api/v1/day?date={SELECTED}").json()
    response = client.get(f"/api/v1/grid?date={SELECTED}")
    assert response.status_code == 200
    grid = response.json()
    assert grid["source"] == "mixed" and grid["status"] == "partial"
    assert grid["stale"] and grid["spatialObservedAt"] is None
    assert grid["coverage"] == {
        "roads": 2,
        "roughness": 1,
        "overtaking_share": 1,
        "flow": 1,
        "pm_spatial": 0,
    }
    assert len(grid["cells"]["features"]) == 2
    assert grid["capturedAt"] and grid["buildId"] != spatial.build_id
    assert response.headers["x-data-source"] == "mixed"
    assert response.headers["x-build-id"] == grid["buildId"]
    for feature in grid["cells"]["features"]:
        p = feature["properties"]
        assert p["air"] == [h["factors"]["air"] for h in day["hours"]]
        assert p["heat"] == [h["factors"]["heat"] for h in day["hours"]]
        assert p["wind"] == [h["factors"]["wind"] for h in day["hours"]]
        assert p["green"] is None and p["confidence"] == 0 and p["recommendable"] is False
        assert p["coverage"]["pm_spatial"] == 0
        assert p["provenance"]["air"] == "city model; no street PM coverage"
        assert feature["geometry"]["coordinates"][0][0] == feature["geometry"]["coordinates"][0][-1]
        assert 9.05 <= feature["geometry"]["coordinates"][0][0][0] < 9.35
    surface = next(
        f["properties"]["surface"]
        for f in grid["cells"]["features"]
        if f["properties"]["surface"] is not None
    )
    assert surface == pytest.approx(77.8571428571)
    assert client.get("/v1/status").json()["spatial_source"] == "mixed"
    assert client.get("/api/v1/grid?date=2040-01-01").status_code == 404


def test_real_street_scores_join_ids_units_confidence_and_stable_restarts(seeded):
    client, spatial, results, provider = seeded
    segments = client.get("/v1/segments?page_size=100").json()
    assert segments["source"] == "mixed" and segments["build_id"] == spatial.build_id
    assert len(segments["features"]) == 2
    identifier = segments["features"][0]["properties"]["segment_id"]
    assert client.get(f"/v1/segments/{identifier}").json() == segments["features"][0]
    assert client.get("/v1/segments?bbox=6,48,7,49").json()["features"] == []
    moment = f"{SELECTED}T12:00:00Z"
    for profile in ("running", "cycling", "walking"):
        scores = client.get(f"/scores?profile={profile}&t={moment}").json()
        assert scores["version"] == "street-projection-v1"
        assert scores["source"] == "mixed" and scores["t"] == moment
        assert set(scores["scores"]) == {
            str(s["properties"]["segment_id"]) for s in segments["features"]
        }
        assert all(0 <= v[0] <= 100 and v[1] == 0 for v in scores["scores"].values())
        detail = provider.detail(identifier, profile, datetime.fromisoformat(moment))
        assert detail.confidence == 0 and detail.pm_source == "none" and detail.stale
        assert "street_pm_coverage" in detail.missing and detail.score is not None
        pm = next(c for c in detail.components if c.key == "pm25")
        assert pm.source == "forecast" and "city model" in pm.method
        assert detail.build_id == scores["build_id"]
        best = client.get(
            f"/v1/segments/{identifier}/bestTimes/{SELECTED}?profile={profile}"
        ).json()
        assert best["windows"] == [] and best["source"] == "mixed"
    point = segments["features"][0]["geometry"]["coordinates"][0]
    lookup = client.get(f"/score?lat={point[1]}&lon={point[0]}&profile=cycling&t={moment}")
    assert lookup.status_code == 200 and lookup.json()["segment_id"] == identifier
    assert client.get(f"/score?lat=48&lon=6&profile=cycling&t={moment}").status_code == 404
    restarted = StoredRepository(results, clock=lambda: AS_OF)
    assert restarted.grid(SELECTED) == provider.grid(SELECTED)
    assert restarted.segments() == provider.segments()


def test_partial_model_hours_never_gain_a_daylight_or_static_only_score(seeded):
    client, _, _, provider = seeded
    selected = SELECTED + timedelta(days=1)
    day = provider.day(selected)
    missing = next(h for h in day.hours if h.pm25 is None)
    moment = missing.instants[0].strftime("%Y-%m-%dT%H:00:00Z")
    scores = client.get(f"/scores?profile=cycling&t={moment}").json()
    assert scores["scores"] == {}
    segment = provider.segments()[0]
    point = segment.geometry.coordinates[0]
    detail = client.get(f"/score?lat={point[1]}&lon={point[0]}&profile=cycling&t={moment}").json()
    assert detail["score"] is None and detail["confidence"] == 0
    assert "pm25" in detail["missing"]
    grid = provider.grid(selected)
    assert all(f.properties.air[missing.hour] is None for f in grid.cells.features)


def test_real_segment_cursor_is_bound_to_build_and_geographic_filter(seeded):
    client, _, results, _ = seeded
    first = client.get("/v1/segments?page_size=1").json()
    token = first["next_page_token"]
    assert token.startswith(f"segments-{first['build_id']}-")
    second = client.get(f"/v1/segments?page_size=1&page_token={token}").json()
    assert first["features"][0] != second["features"][0]
    assert client.get(f"/v1/segments?bbox=9,49,10,50&page_token={token}").status_code == 400
    process_spatial(results, since=AS_OF - timedelta(days=7), now=AS_OF + timedelta(minutes=1))
    assert client.get(f"/v1/segments?page_token={token}").status_code == 400
    current = client.get("/v1/segments?page_size=1").json()
    assert current["build_id"] != first["build_id"]
    assert current["features"] == first["features"]
