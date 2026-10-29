"""Synthetic stored inputs through processing, real repository and actual HTTP."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from test_ingestion_foundation import observation, raw

from app.core.config import Settings
from app.main import create_app
from app.processing.snapshots import day_bounds, process_day, process_sensors
from app.schemas.observation import ProviderValue
from app.serving.stored import StoredRepository
from app.storage import models as db
from app.storage.repository import Repository
from app.storage.results import ResultRepository

NOW = datetime(2026, 10, 29, 10, tzinfo=UTC)


def seed(repository, selected, *, retrieved=NOW, missing=False):
    start, end = day_bounds(selected)
    for source, channels in [
        ("openmeteo_fcst", [("temp", 10, "°C"), ("rh", 60, "%"), ("wind_speed", 36, "km/h")]),
        ("openmeteo_aq", [("pm25", 0, "µg/m³"), ("no2", 20, "µg/m³")]),
    ]:
        ref = repository.land_raw(raw(source_id=source, retrieved_at_utc=retrieved))
        items = []
        for i in range(int((end - start).total_seconds() / 3600)):
            for channel, value, unit in channels:
                items.append(
                    observation(
                        ref,
                        source=source,
                        phenomenon=channel,
                        unit=unit,
                        value=None if missing and i > 1 else value,
                        ts_utc=start + timedelta(hours=i),
                        kind="forecast",
                        provenance=ProviderValue(
                            platform="stationary", raw_key=channel, raw_value=value, raw_unit=unit
                        ),
                    )
                )
        repository.ingest_page(ref, items)
    ref = repository.land_raw(raw(source_id="osem", retrieved_at_utc=retrieved))
    repository.ingest_page(
        ref,
        [
            observation(
                ref,
                source="osem",
                phenomenon="temp",
                unit="°C",
                value=0,
                ts_utc=retrieved - timedelta(hours=1),
                provenance=ProviderValue(
                    platform="stationary",
                    exposure="indoor",
                    station_name="Indoor synthetic example",
                    sensor_id="sensor-exact",
                    raw_key="Temperatur",
                    raw_value="0",
                    raw_unit="°C",
                ),
            )
        ],
    )
    results = ResultRepository(repository)
    snapshot = process_day(results, selected, now=retrieved)
    process_sensors(results, now=retrieved)
    return results, snapshot


@pytest.fixture
def stored(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'stored.sqlite'}")
    db.metadata.create_all(engine)
    yield Repository(engine)
    engine.dispose()


def app_for(results, clock=lambda: NOW):
    provider = StoredRepository(results, clock=clock)
    return create_app(Settings(_env_file=None), repository=provider)


def test_real_http_day_and_sensors_use_stored_values_and_no_synthetic_grid(stored):
    results, snapshot = seed(stored, NOW.date())
    with TestClient(app_for(results)) as client:
        response = client.get("/api/v1/day?date=2026-10-29")
        assert response.status_code == 200
        body = response.json()
        assert response.headers["x-data-source"] == "forecast"
        assert response.headers["x-build-id"] == snapshot.build_id
        assert body["source"] == "forecast" and body["status"] == "partial"
        assert body["generatedAt"] == snapshot.built_at.isoformat().replace("+00:00", "Z")
        hour = body["hours"][12]
        assert hour["tempC"] == 10 and hour["pm25"] == 0 and hour["windKmh"] == 36
        assert (
            hour["rush"] is None
            and hour["factors"]["traffic"] is None
            and hour["factors"]["safety"] is None
        )
        assert hour["provenance"]["pm25"]["kind"] == "model"
        assert hour["provenance"]["pm25"]["issuedAt"] is None
        assert hour["provenance"]["pm25"]["rawRefs"]
        assert hour["provenance"]["daylight"]["kind"] == "derived"
        assert client.get("/v1/days/2026-10-29").json() == body
        grid = client.get("/api/v1/grid?date=2026-10-29").json()
        assert grid["source"] == "unavailable" and grid["cells"]["features"] == []
        sensors = client.get("/api/v1/sensors").json()
        assert len(sensors) == 1 and sensors[0]["latest"]["Temperature"] == 0
        assert (
            sensors[0]["source"] == "measured"
            and sensors[0]["exposure"] == "indoor"
            and sensors[0]["stale"]
        )
        assert sensors[0]["channelProvenance"]["Temperature"]["observedAt"]
        status = client.get("/v1/status").json()
        assert status["pipeline_connected"] and status["spatial_source"] == "unavailable"
        assert status["available_dates"] == ["2026-10-29"]
        assert client.get("/v1/segments").json()["source"] == "unavailable"
        assert client.get("/scores?profile=running&t=2026-10-29T12:00:00Z").json()["scores"] == {}
        assert (
            client.get("/best-time?segment_id=1&profile=running&date=2026-10-29").status_code == 404
        )
        assert client.get("/api/v1/day?date=2026-10-31").status_code == 404


def test_partial_and_stale_results_survive_restart_without_becoming_current(stored):
    results, snapshot = seed(stored, NOW.date(), missing=True)
    later = NOW + timedelta(days=2)
    with TestClient(
        app_for(ResultRepository(Repository(stored.engine)), clock=lambda: later)
    ) as client:
        body = client.get("/api/v1/day?date=2026-10-29").json()
        assert body["status"] == "stale" and body["buildId"] == snapshot.build_id
        assert body["hours"][15]["tempC"] is None and body["hours"][15]["factors"]["heat"] is None
        assert body["retrievedAt"] == NOW.isoformat().replace("+00:00", "Z")
        assert "tempC" in body["hours"][15]["missing"]


@pytest.mark.parametrize("selected,count", [(date(2026, 3, 29), 0), (date(2026, 10, 25), 2)])
def test_dst_slots_keep_actual_instants_and_explicit_spring_gap(stored, selected, count):
    results, _ = seed(stored, selected)
    with TestClient(app_for(results)) as client:
        body = client.get(f"/v1/days/{selected}").json()
    assert len(body["hours"]) == 24
    slot = body["hours"][2]
    assert len(slot["instants"]) == count
    if count == 0:
        assert slot["tempC"] is None and slot["factors"]["heat"] is None
    else:
        assert slot["tempC"] == 10
        assert slot["provenance"]["tempC"]["method"] == "mean_of_actual_utc_instants"
        assert len(slot["provenance"]["tempC"]["observedAt"]) == 2


def test_explicit_provider_selection_is_lazy_and_database_failures_are_typed(tmp_path):
    url = f"sqlite:///{tmp_path / 'missing.sqlite'}"
    app = create_app(Settings(_env_file=None, serving_data_mode="stored", database_url=url))
    assert not (tmp_path / "missing.sqlite").exists()  # No connection on app construction.
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        response = client.get("/v1/days/2026-10-29")
        assert response.status_code == 503 and response.json()["error"]["status"] == "UNAVAILABLE"
        assert "sqlite" not in response.text and "password" not in response.text
    with pytest.raises(ValueError, match="DATABASE_URL"):
        create_app(Settings(_env_file=None, serving_data_mode="stored"))
