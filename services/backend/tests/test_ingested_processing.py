"""Synthetic adapter-shaped values exercise the stored -> processing boundary."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from test_ingestion_foundation import NOW, observation, raw
from test_ingestion_foundation import repository as repository  # noqa: F401

from app.processing.ingested import project_observation
from app.processing.normalizer import normalize_batch
from app.schemas.observation import ProviderValue
from app.schemas.observations import RawObservation
from app.storage import models as db
from app.storage.repository import observation_id


def value(**changes):
    return observation(
        provenance=ProviderValue(
            platform="stationary",
            sensor_id="sensor-1",
            raw_key="Temperatur",
            raw_value="288.65",
            raw_unit="K",
        ),
        **changes,
    )


def test_storage_projection_keeps_originals_and_all_times(repository):
    retrieved = NOW + timedelta(minutes=3)
    raw_ref = repository.land_raw(raw(retrieved_at_utc=retrieved))
    item = value(raw_ref=raw_ref, kind="forecast", issued_at=NOW - timedelta(hours=6))
    repository.ingest_page(raw_ref, [item])
    with repository.engine.connect() as conn:
        stored = conn.execute(select(db.observations)).mappings().one()
    # Models revalidated on read; physical storage preserves exact originals.
    stored = {k: stored[k] for k in type(item).model_fields}
    restored = type(item).model_validate(stored)
    assert restored == item
    result = project_observation(
        restored, retrieved_at=repository.get_raw(raw_ref).retrieved_at_utc
    )
    assert result.kind == "model" and result.phenomenon == "temperature"
    assert result.value == 15.5  # already converted by adapter; never convert K twice
    assert result.raw_value == "288.65" and result.raw_unit == "K"
    assert result.raw_key == "Temperatur" and result.sensor_id == "sensor-1"
    assert result.raw_ref == raw_ref and result.retrieved_at == retrieved
    assert result.issued_at == NOW - timedelta(hours=6) and result.observed_at == NOW


@pytest.mark.parametrize(
    "channel,unit,number,expected,expected_unit",
    [
        ("wind_speed", "km/h", 36, 10, "m/s"),
        ("pm25", "µg/m³", 0, 0, "µg/m³"),
        ("temp", "°C", None, None, "°C"),
        ("rh", "%", 51, 51, "%"),
    ],
)
def test_mapping_units_null_and_zero(channel, unit, number, expected, expected_unit):
    item = value(phenomenon=channel, unit=unit, value=number)
    projected = project_observation(item, retrieved_at=NOW)
    assert projected.value == expected and projected.unit == expected_unit
    assert projected.usable == (number is not None)


def test_unknown_issue_is_preserved_and_captured_builds_do_not_collapse(repository):
    first_ref = repository.land_raw(raw())
    second_ref = repository.land_raw(raw(retrieved_at_utc=NOW + timedelta(minutes=10)))
    items = [value(raw_ref=ref, kind="forecast") for ref in (first_ref, second_ref)]
    for item in items:
        assert repository.ingest_page(item.raw_ref, [item])["observations"] == 1
        assert repository.ingest_page(item.raw_ref, [item])["observations"] == 0
    results = [project_observation(item, retrieved_at=NOW) for item in items]
    assert all(result.issued_at is None for result in results)
    assert results[0].key != results[1].key


def test_mobile_and_parallel_sensor_identity_survive_storage(repository):
    raw_ref = repository.land_raw(raw())
    items = []
    for sample, sensor in [("a", "one"), ("b", "one"), ("a", "two")]:
        item = value(raw_ref=raw_ref)
        item = item.model_copy(
            update={
                "provenance": item.provenance.model_copy(
                    update={
                        "platform": "mobile",
                        "sample_id": sample,
                        "sensor_id": sensor,
                    }
                )
            }
        )
        items.append(item)
    assert len({observation_id(item) for item in items}) == 3
    assert repository.ingest_page(raw_ref, items)["observations"] == 3
    projected = [project_observation(item, retrieved_at=NOW) for item in items]
    assert len({result.key for result in projected}) == 3
    with pytest.raises(ValidationError, match="sample_id"):
        type(items[0]).model_validate(
            items[0].model_dump()
            | {
                "provenance": items[0].provenance.model_dump() | {"sample_id": None},
            }
        )


def test_dst_fold_times_are_distinct_and_naive_times_rejected():
    berlin = ZoneInfo("Europe/Berlin")
    moments = [datetime(2026, 10, 25, 2, 30, tzinfo=berlin, fold=fold) for fold in (0, 1)]
    results = [project_observation(value(ts_utc=t), retrieved_at=NOW) for t in moments]
    assert results[1].observed_at - results[0].observed_at == timedelta(hours=1)
    assert results[0].key != results[1].key
    with pytest.raises(ValidationError, match="timezone"):
        value(ts_utc=datetime(2026, 10, 25, 2, 30))
    with pytest.raises(ValueError, match="timezone"):
        project_observation(value(), retrieved_at=datetime(2026, 10, 25))
    assert results[0].observed_at.tzinfo == UTC


def test_boundary_rejects_unknowns_without_inventing_provenance_or_interval():
    for item, message in [
        (observation(), "provenance"),
        (value(phenomenon="cloud_cover", unit="%"), "unsupported"),
        (value(phenomenon="precip", unit="mm"), "hourly interval"),
        (value(geom={"type": "LineString", "coordinates": [[9.2, 49.1], [9.21, 49.11]]}), "point"),
    ]:
        with pytest.raises(ValueError, match=message):
            project_observation(item, retrieved_at=NOW)
    item = value(phenomenon="precip", unit="mm", value=2)
    item = item.model_copy(
        update={
            "provenance": item.provenance.model_copy(
                update={
                    "interval_seconds": 3600,
                }
            )
        }
    )
    assert project_observation(item, retrieved_at=NOW).value == 2


def test_legacy_raw_normalizer_preserves_extended_traceability():
    raw = RawObservation(
        source="synthetic",
        station_id="box",
        platform="mobile",
        kind="model",
        raw_key="wind_speed",
        raw_value=36,
        raw_unit="km/h",
        observed_at=NOW,
        longitude=9.2,
        latitude=49.1,
        sample_id="a",
        sensor_id="wind",
        raw_ref=42,
        issued_at=NOW - timedelta(hours=1),
        retrieved_at=NOW,
    )
    result = normalize_batch([raw]).observations[0]
    assert result.value == 10 and result.sensor_id == "wind" and result.raw_ref == 42
    assert result.issued_at == raw.issued_at
