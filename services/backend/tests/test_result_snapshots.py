"""Stored-input processing behavior, independent of HTTP and public projections."""

import os
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, select
from test_ingestion_foundation import observation, raw
from test_ingestion_foundation import repository as repository  # noqa: F401

from app.processing.snapshots import day_bounds, process_day, process_sensors
from app.schemas.observation import ProviderValue
from app.schemas.snapshots import DayResult, SensorResult
from app.storage import models as db
from app.storage.repository import Repository
from app.storage.results import ResultRepository

NOW = datetime(2026, 10, 28, 12, tzinfo=UTC)
DAY = NOW.date()


def land(repository, *, source="model-weather", retrieved=NOW, values=None, provenance=None):
    ref = repository.land_raw(raw(source_id=source, retrieved_at_utc=retrieved))
    items = []
    for channel, number, unit, at, kind in values or [("wind_speed", 36, "km/h", NOW, "forecast")]:
        item = observation(
            ref,
            source=source,
            phenomenon=channel,
            value=number,
            unit=unit,
            ts_utc=at,
            kind=kind,
            provenance=ProviderValue(
                platform="stationary",
                raw_key=channel,
                raw_value=number,
                raw_unit=unit,
                interval_seconds=3600 if channel == "precip" else None,
                **(provenance or {}),
            ),
        )
        items.append(item)
    repository.ingest_page(ref, items)
    return ref


def test_stored_day_selects_latest_run_and_preserves_nulls_and_originals(repository):
    land(repository)
    later = NOW + timedelta(minutes=5)
    ref = land(
        repository,
        retrieved=later,
        values=[
            ("wind_speed", 18, "km/h", NOW, "forecast"),
            ("temp", None, "°C", NOW, "forecast"),
            ("pm25", 0, "µg/m³", NOW, "forecast"),
        ],
    )
    results = ResultRepository(repository)
    snapshot = process_day(results, DAY, now=later)
    day = DayResult.model_validate(snapshot.payload)
    assert snapshot.status == "PARTIAL" and len(day.instants) == 24
    assert day.model_series["wind_speed"][NOW.isoformat()] == 5  # no averaging old 10 with new 5
    assert day.model_series["pm2_5"][NOW.isoformat()] == 0
    assert day.model_series["temperature"] == {} and day.missing_model_slots["temperature"] == 24
    wind = next(r.observation for r in day.readings if r.observation.phenomenon == "wind_speed")
    assert wind.raw_unit == "km/h" and wind.raw_value == "18" and wind.unit == "m/s"
    assert wind.retrieved_at == later and wind.issued_at is None and wind.raw_ref == ref
    repeated = process_day(results, DAY, now=later + timedelta(minutes=2))
    assert repeated.build_id == snapshot.build_id and repeated.built_at == snapshot.built_at
    assert ResultRepository(repository).latest(f"days/{DAY}") == snapshot


def test_indoor_future_and_flagged_measurements_do_not_create_city_levels(repository):
    land(
        repository,
        source="indoor",
        values=[("temp", 35, "°C", NOW, "observation")],
        provenance={"exposure": "indoor", "sensor_id": "inside"},
    )
    land(
        repository,
        source="outdoor",
        values=[
            ("temp", 15, "°C", NOW, "observation"),
            ("temp", 20, "°C", NOW + timedelta(hours=1), "observation"),
        ],
        provenance={"exposure": "outdoor", "sensor_id": "outside"},
    )
    land(
        repository,
        source="osem",
        values=[("temp", 100, "°C", NOW, "observation")],
        provenance={"exposure": "outdoor", "sensor_id": "bad"},
    )
    snapshot = process_day(ResultRepository(repository), DAY, now=NOW)
    day = DayResult.model_validate(snapshot.payload)
    assert day.measured_levels["temperature"] == {NOW.isoformat(): 15}
    bad = next(r.observation for r in day.readings if r.observation.source == "osem")
    assert "out_of_range" in bad.qc_flags and not bad.usable
    sensors = SensorResult.model_validate(
        process_sensors(ResultRepository(repository), now=NOW).payload
    )
    assert {r.observation.value for r in sensors.readings} == {15, 35, 100}
    assert any(r.exposure == "indoor" for r in sensors.readings)


def test_community_humidity_rule_does_not_reject_official_or_model_values(repository):
    for source, kind in [
        ("osem", "observation"),
        ("uba_226_1", "observation"),
        ("model", "forecast"),
    ]:
        land(
            repository,
            source=source,
            values=[("rh", 90, "%", NOW, kind), ("pm25", 10, "µg/m³", NOW, kind)],
            provenance={"exposure": "outdoor"},
        )
    day = DayResult.model_validate(process_day(ResultRepository(repository), DAY, now=NOW).payload)
    flags = {
        r.observation.source: r.observation.qc_flags
        for r in day.readings
        if r.observation.phenomenon == "pm2_5"
    }
    assert "humid_pm" in flags["osem"] and not flags["uba_226_1"] and not flags["model"]


@pytest.mark.parametrize("selected,count", [(date(2026, 3, 29), 23), (date(2026, 10, 25), 25)])
def test_snapshot_axis_uses_actual_berlin_instants_without_duplicating_inputs(
    repository, selected, count
):
    start, end = day_bounds(selected)
    assert end - start == timedelta(hours=count)
    snapshot = process_day(ResultRepository(repository), selected, now=NOW)
    result = DayResult.model_validate(snapshot.payload)
    assert snapshot.status == "UNAVAILABLE" and len(result.instants) == count
    assert len(set(result.instants)) == count and not result.readings
    assert set(result.missing_model_slots.values()) == {count}


def test_unavailable_build_does_not_replace_last_available_snapshot(repository):
    land(repository)
    results = ResultRepository(repository)
    original = process_day(results, DAY, now=NOW)
    with repository.engine.begin() as conn:
        conn.execute(delete(db.outbox))
        conn.execute(delete(db.observations))
    failed = process_day(results, DAY, now=NOW + timedelta(hours=2))
    assert failed.status == "UNAVAILABLE" and failed.build_id != original.build_id
    assert results.latest(f"days/{DAY}") == original
    assert results.latest(f"days/{DAY}", include_unavailable=True) == failed
    empty = process_sensors(results, now=NOW)
    assert empty.status == "UNAVAILABLE" and results.latest("sensors") is None


def test_source_read_budget_fails_explicitly_and_cannot_publish_partial_truncation(repository):
    land(
        repository,
        values=[("temp", 10, "°C", NOW, "forecast"), ("pm25", 5, "µg/m³", NOW, "forecast")],
    )
    with pytest.raises(ValueError, match="budget exceeded"):
        ResultRepository(repository).observations(
            until=NOW + timedelta(hours=1), retrieved_before=NOW, max_rows=1
        )


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("GREENAIR_TEST_DATABASE_URL"), reason="requires migrated PostgreSQL"
)
def test_postgresql_geometry_latest_sensor_read_and_immutable_snapshot_restart():
    engine = create_engine(os.environ["GREENAIR_TEST_DATABASE_URL"])
    repository = Repository(engine)
    source = "snapshot_test_" + uuid4().hex
    moment = datetime(2095, 1, 12, 12, tzinfo=UTC)
    results = ResultRepository(repository)
    snapshot_ids = []
    try:
        land(
            repository,
            source=source,
            retrieved=moment,
            values=[
                ("temp", 15, "°C", moment - timedelta(hours=1), "observation"),
                ("temp", 16, "°C", moment, "observation"),
            ],
            provenance={"exposure": "outdoor", "sensor_id": "temperature"},
        )
        snapshot = process_day(results, moment.date(), now=moment)
        snapshot_ids.append(snapshot.build_id)
        sensors = process_sensors(results, now=moment)
        snapshot_ids.append(sensors.build_id)
        restarted = ResultRepository(Repository(engine))
        assert restarted.latest(snapshot.resource_key) == snapshot
        reading = next(
            r
            for r in SensorResult.model_validate(sensors.payload).readings
            if r.observation.source == source
        )
        assert reading.observation.value == 16 and reading.observation.longitude == 9.2109
        assert (
            process_sensors(restarted, now=moment + timedelta(minutes=1)).built_at
            == sensors.built_at
        )
    finally:
        with engine.begin() as conn:
            conn.execute(
                delete(db.result_snapshot).where(db.result_snapshot.c.build_id.in_(snapshot_ids))
            )
            ids = select(db.observations.c.id).where(db.observations.c.source == source)
            conn.execute(delete(db.outbox).where(db.outbox.c.event_id.in_(ids)))
            conn.execute(delete(db.observations).where(db.observations.c.source == source))
            conn.execute(delete(db.raw_payload).where(db.raw_payload.c.source_id == source))
        engine.dispose()
