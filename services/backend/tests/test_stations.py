import io
import json
import urllib.error
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.routes.stations import get_box_fetcher
from app.core.config import Settings
from app.ingestion.adapters import opensensemap
from app.ingestion.adapters.opensensemap import UpstreamError, fetch_boxes, parse_boxes
from app.main import create_app
from app.processing.station_status import classify

# Trimmed capture of GET /boxes?grouptag=GreenCityHN&full=true at 2026-10-28T17:08:18Z.
# Not a current observation.
FIXTURE = Path(__file__).parent / "fixtures" / "opensensemap_greencityhn_boxes_2026-10-28.json"


@pytest.fixture
def captured_boxes():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def by_name(snapshots):
    return {snapshot.name: snapshot for snapshot in snapshots}


def test_parse_keeps_raw_values_units_and_utc_times(captured_boxes):
    innenstadt = by_name(parse_boxes(captured_boxes))["Innenstadt"]

    assert innenstadt.box_id == "69bd6ceb867a8a00078d3c3f"
    assert (innenstadt.longitude, innenstadt.latitude, innenstadt.height_m) == (
        9.221977,
        49.142487,
        165,
    )
    assert innenstadt.exposure == "outdoor"
    assert innenstadt.last_measurement_at == datetime(2026, 10, 28, 17, 6, 4, 501000, tzinfo=UTC)
    pm25 = next(sensor for sensor in innenstadt.sensors if sensor.title == "PM25")
    assert (pm25.value, pm25.raw_value, pm25.unit) == (11.55, "11.55", "µg/m³")
    assert pm25.measured_at.tzinfo is not None


def test_parse_keeps_missing_measurements_as_none(captured_boxes):
    snapshots = by_name(parse_boxes(captured_boxes))

    never = snapshots["Hölderlin-Gymnasium Lauffen"]
    assert never.last_measurement_at is None
    assert never.height_m is None
    assert all(sensor.value is None and sensor.measured_at is None for sensor in never.sensors)

    partial = snapshots["EVGO Umwelt 1"]
    assert [sensor.value for sensor in partial.sensors] == [24.9, None, None]


def test_parse_handles_id_only_and_non_numeric_values(captured_boxes):
    box = captured_boxes[0]
    box["sensors"] = [
        {"_id": "a", "title": "Temperatur", "unit": "°C", "lastMeasurement": "6ae2"},
        {
            "_id": "b",
            "title": "PM10",
            "unit": "µg/m³",
            "lastMeasurement": {"value": "NaN", "createdAt": "2026-10-28T17:00:00.000Z"},
        },
    ]
    sensors = parse_boxes([box])[0].sensors

    assert sensors[0].value is None and sensors[0].raw_value is None
    assert sensors[1].value is None and sensors[1].raw_value == "NaN"


def test_classify_uses_threshold_and_distinguishes_no_data(captured_boxes):
    snapshots = by_name(parse_boxes(captured_boxes))
    now = datetime(2026, 10, 28, 17, 36, 4, 501000, tzinfo=UTC)
    stale_after = timedelta(minutes=30)

    online = classify(snapshots["Innenstadt"], now, stale_after)
    assert (online.state, online.age_minutes) == ("online", 30.0)
    late = classify(snapshots["Innenstadt"], now + timedelta(seconds=1), stale_after)
    assert late.state == "stale"
    assert classify(snapshots["EVGO Umwelt 1"], now, stale_after).state == "stale"
    never = classify(snapshots["Hölderlin-Gymnasium Lauffen"], now, stale_after)
    assert (never.state, never.age_minutes) == ("no_data", None)


def make_client(fetcher):
    application = create_app(Settings(_env_file=None))
    application.dependency_overrides[get_box_fetcher] = lambda: fetcher
    return TestClient(application)


def test_status_endpoint_reports_counts_and_threshold(captured_boxes):
    with make_client(lambda settings: captured_boxes) as client:
        response = client.get("/stations/status")

    assert response.status_code == 200
    body = response.json()
    assert body["grouptag"] == "GreenCityHN"
    assert body["stale_after_minutes"] == 30
    assert sum(body["counts"].values()) == 3
    assert body["counts"]["no_data"] == 1
    assert {station["name"] for station in body["stations"]} == {
        "Innenstadt",
        "EVGO Umwelt 1",
        "Hölderlin-Gymnasium Lauffen",
    }


def test_status_endpoint_returns_502_when_upstream_fails():
    def failing(settings):
        raise UpstreamError("HTTP 503")

    with make_client(failing) as client:
        response = client.get("/stations/status")

    assert response.status_code == 502
    assert "HTTP 503" in response.json()["error"]["message"]


class FakeResponse(io.BytesIO):
    def __init__(self, body, content_type="application/json; charset=utf-8"):
        super().__init__(body)
        self.headers = {"Content-Type": content_type}


def test_fetch_retries_server_errors_then_succeeds(monkeypatch):
    calls = []

    def urlopen(request, timeout):
        calls.append(request.full_url)
        if len(calls) == 1:
            raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, None)
        return FakeResponse(b"[]")

    monkeypatch.setattr(opensensemap.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(opensensemap.time, "sleep", lambda seconds: None)

    assert fetch_boxes("https://osm.example/", "GreenCityHN", timeout=5) == []
    assert calls == ["https://osm.example/boxes?grouptag=GreenCityHN&full=true"] * 2


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (urllib.error.HTTPError("u", 404, "missing", {}, None), "HTTP 404"),
        (FakeResponse(b"<html></html>", "text/html"), "unexpected content type"),
        (FakeResponse(b'{"code": "error"}'), "expected a JSON array"),
    ],
)
def test_fetch_rejects_unusable_responses_without_retrying(monkeypatch, response, message):
    calls = []

    def urlopen(request, timeout):
        calls.append(request)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(opensensemap.urllib.request, "urlopen", urlopen)

    with pytest.raises(UpstreamError, match=message):
        fetch_boxes("https://osm.example", "GreenCityHN", timeout=5)
    assert len(calls) == 1
