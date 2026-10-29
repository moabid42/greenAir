"""Frontend contracts and real HTTP behavior, using synthetic data only."""

import urllib.request

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.serving.demo import DemoRepository


@pytest.fixture
def client(monkeypatch):
    def forbid_network(*args, **kwargs):
        raise AssertionError("The demo API must not fetch upstream data")

    monkeypatch.setattr(urllib.request, "urlopen", forbid_network)
    application = create_app(
        Settings(_env_file=None, serving_data_mode="mock", station_data_mode="mock")
    )
    with TestClient(application) as connection:
        yield connection


@pytest.mark.parametrize("selected", ["2026-10-29", "2026-06-20", "2026-03-29", "2026-10-25"])
def test_day_contract_and_dst_slots(client, selected):
    response = client.get("/api/v1/day", params={"date": selected})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "mock"
    assert body["date"] == selected
    assert body["timezone"] == "Europe/Berlin"
    assert body["generatedAt"].endswith("Z")
    assert [h["hour"] for h in body["hours"]] == list(range(24))
    for hour in body["hours"]:
        assert set(hour["factors"]) == {"heat", "air", "wind", "traffic", "light", "safety"}
        assert all(0 <= value <= 100 for value in hour["factors"].values())
    assert client.get(f"/v1/days/{selected}").json() == body
    assert response.headers["x-data-source"] == "mock"
    assert "max-age" in response.headers["cache-control"]


def test_grid_coverage_shapes_stability_and_compression(client):
    response = client.get("/api/v1/grid?date=2026-10-29", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    grid = response.json()
    assert grid["source"] == "mock"
    assert grid["cellSizeM"] == 250
    features = grid["cells"]["features"]
    assert len(features) > 1000
    ids = []
    points = []
    for feature in features:
        ring = feature["geometry"]["coordinates"][0]
        assert len(ring) == 5 and ring[0] == ring[-1]
        points.extend(ring)
        cell = feature["properties"]
        ids.append(cell["id"])
        assert 0 <= cell["green"] <= 1
        for factor in ("heat", "air", "wind", "traffic", "light"):
            assert len(cell[factor]) == 24
            assert all(0 <= value <= 100 for value in cell[factor])
    assert len(ids) == len(set(ids))
    assert min(p[0] for p in points) == 9.15
    assert max(p[0] for p in points) == 9.275
    assert min(p[1] for p in points) == 49.105
    assert max(p[1] for p in points) == 49.178
    another = client.get("/v1/grids/2026-10-30").json()["cells"]["features"]
    assert [f["properties"]["id"] for f in another] == ids
    assert [f["geometry"] for f in another] == [f["geometry"] for f in features]


def test_sensors_pagination_and_station_status_are_offline(client):
    sensors = client.get("/api/v1/sensors").json()
    assert len(sensors) == 3
    assert all(s["source"] == "mock" and s["id"].startswith("mock-") for s in sensors)
    first = client.get("/v1/sensors?page_size=2").json()
    second = client.get("/v1/sensors", params={"page_token": first["next_page_token"]}).json()
    assert first["sensors"] + second["sensors"] == sensors
    assert second["next_page_token"] == ""
    assert client.get("/v1/sensors/mock-1").json() == sensors[0]
    status = client.get("/stations/status")
    assert status.status_code == 200
    assert status.json()["source"] == "mock"
    assert sum(status.json()["counts"].values()) == 3


def test_street_score_ids_detail_and_best_times(client):
    params = {"profile": "cycling", "t": "2026-10-29T12:00:00Z"}
    snapshot = client.get("/scores", params=params)
    assert snapshot.status_code == 200
    snapshot = snapshot.json()
    assert snapshot["profile"] == "cycling" and snapshot["t"] == params["t"]
    assert snapshot["source"] == "mock"
    features = client.get("/segments").json()["features"]
    assert set(snapshot["scores"]) == {str(f["properties"]["segment_id"]) for f in features}
    for score, confidence, flags in snapshot["scores"].values():
        assert 0 <= score <= 100 and confidence == 0 and flags == 0
    detail = client.get("/score", params={**params, "lat": 49.1425, "lon": 9.2115})
    assert detail.status_code == 200
    detail = detail.json()
    assert detail["segment_id"] == 1
    assert abs(snapshot["scores"]["1"][0] - detail["score"]) <= 0.5
    best = client.get(
        "/best-time", params={"segment_id": 1, "profile": "cycling", "date": "2026-10-29"}
    )
    assert best.status_code == 200
    assert len(best.json()["windows"]) == 3
    assert client.get("/v1/segments/1").json() == features[0]
    assert client.get("/segments?bbox=0,0,1,1").json()["features"] == []
    status = client.get("/status").json()
    assert status["pipeline_connected"] is False
    assert snapshot["build_id"] == status["build_id"]


@pytest.mark.parametrize(
    ("path", "code", "status"),
    [
        ("/v1/days/2026-99-99", 400, "INVALID_ARGUMENT"),
        ("/api/v1/day?date=invalid", 422, "INVALID_ARGUMENT"),
        ("/v1/days/2019-01-01", 404, "NOT_FOUND"),
        ("/v1/sensors/missing", 404, "NOT_FOUND"),
        ("/v1/sensors?page_size=101", 400, "INVALID_ARGUMENT"),
        ("/v1/sensors?page_token=garbage", 400, "INVALID_ARGUMENT"),
        ("/v1/sensors?page_token=mock-v1-²", 400, "INVALID_ARGUMENT"),
        ("/v1/segments?bbox=nan,0,2,1", 400, "INVALID_ARGUMENT"),
        ("/v1/scores?profile=cycling&t=2026-02-30T12:00:00Z", 400, "INVALID_ARGUMENT"),
        ("/v1/scores?profile=cycling&t=2026-10-29T12:30:00Z", 400, "INVALID_ARGUMENT"),
        ("/v1/scores?profile=unsupported&t=2026-10-29T12:00:00Z", 400, "INVALID_ARGUMENT"),
        ("/score?lat=0&lon=0&profile=running&t=2026-10-29T12:00:00Z", 404, "NOT_FOUND"),
        ("/v1/segments/999/bestTimes/2026-10-29?profile=running", 404, "NOT_FOUND"),
    ],
)
def test_errors_have_google_style_envelope(client, path, code, status):
    response = client.get(path)
    assert response.status_code == code
    error = response.json()["error"]
    assert error["code"] == code and error["status"] == status
    assert error["details"][0]["@type"] == "type.googleapis.com/google.rpc.ErrorInfo"


def test_serving_provider_can_be_replaced_without_route_changes():
    class OtherProvider(DemoRepository):
        def sensors(self):
            return []

    with TestClient(create_app(Settings(_env_file=None), repository=OtherProvider())) as client:
        assert client.get("/api/v1/sensors").json() == []


@pytest.mark.parametrize("selected", ["2026-03-29", "2026-10-25"])
def test_best_times_are_real_distinct_local_hours_on_dst_days(client, selected):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    body = client.get(f"/v1/segments/1/bestTimes/{selected}?profile=running").json()
    moments = [datetime.fromisoformat(w["at"]) for w in body["windows"]]
    assert len(moments) == len(set(moments)) == 3
    assert all(str(m.astimezone(ZoneInfo("Europe/Berlin")).date()) == selected for m in moments)
