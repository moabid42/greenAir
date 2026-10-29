"""Synthetic edge cases for a contract verified separately against landed data."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, func, select

from app.ingestion.adapters.osem import OsemAdapter
from app.ingestion.contracts import RawPayload, Watermark
from app.storage import models as db
from app.storage.repository import Repository

NOW = datetime(2026, 10, 28, 17, tzinfo=UTC)


def sensor(**changes):
    return {
        "_id": "sensor-exact",
        "title": "Temperatur",
        "unit": "°C",
        "lastMeasurement": {"value": "0", "createdAt": "2026-10-28T18:00:00+01:00"},
        **changes,
    }


def box(**changes):
    return {
        "_id": "box-exact",
        "exposure": "outdoor",
        "currentLocation": {"type": "Point", "coordinates": [9.214834, 49.144539, 200]},
        "sensors": [sensor()],
        **changes,
    }


def raw(boxes=None, **changes):
    return RawPayload(
        **(
            {
                "source_id": "osem",
                "url": "https://api.opensensemap.org/boxes",
                "retrieved_at_utc": NOW,
                "http_status": 200,
                "response_headers": {"content-type": "application/json"},
                "body": json.dumps([box()] if boxes is None else boxes).encode(),
            }
            | changes
        )
    )


def decode(payload=None):
    return OsemAdapter().decode(payload or raw(), 1, Watermark(source_id="osem"))


def test_sensor_identity_utc_box_point_and_zero_are_preserved():
    page = decode()
    observation = page.observations[0]
    assert observation.source == "osem"
    assert observation.station_id == "box-exact"
    assert observation.ts_utc == NOW
    assert observation.value == 0
    assert observation.geom.coordinates == [9.214834, 49.144539]
    assert page.receipts[0].feature_id == "box-exact:sensor-exact:2026-10-28T17:00:00+00:00"
    assert page.manifest.details["stationary_box_ids"] == ["box-exact"]
    assert page.next_watermark.state["more"] is False
    assert page.next_watermark.state["cursor"] == 0


def test_mobile_and_outside_current_points_do_not_feed_stationary_level():
    page = decode(
        raw(
            [
                box(exposure="mobile"),
                box(_id="outside", currentLocation={"type": "Point", "coordinates": [8, 49]}),
                box(_id="inside-indoor", exposure="indoor"),
            ]
        )
    )
    assert [item.station_id for item in page.observations] == ["inside-indoor"]
    assert [r.outcome for r in page.receipts] == ["FILTERED", "FILTERED", "INGESTED"]
    assert page.manifest.details["stationary_box_ids"] == ["inside-indoor"]


def test_missing_and_null_channels_are_skipped_without_zero_fabrication():
    page = decode(
        raw(
            [
                box(
                    sensors=[
                        sensor(lastMeasurement=None),
                        sensor(lastMeasurement={"value": None}),
                        {"_id": "no-reading", "title": "Temperatur", "unit": "°C"},
                    ]
                )
            ]
        )
    )
    assert not page.observations
    assert not page.receipts
    assert page.manifest.details["missing_readings"] == 3


@pytest.mark.parametrize(
    "changes",
    [
        {"unit": "K"},
        {"lastMeasurement": {"value": "NaN", "createdAt": "2026-10-28T17:00:00Z"}},
        {"lastMeasurement": {"value": "1", "createdAt": "2026-10-28T17:00:00"}},
        {"title": "Pressure", "unit": "hPa"},
        {"title": "Rain Rate", "unit": "mm/h"},
    ],
)
def test_unverified_units_times_and_reference_are_partial_and_replayable(changes):
    page = decode(raw([box(sensors=[sensor(**changes)])]))
    assert not page.observations
    assert page.receipts[0].outcome == "UNRESOLVED"
    assert page.manifest.status == "PARTIAL"


def test_explicit_sea_level_pressure_and_uv_index():
    page = decode(
        raw(
            [
                box(
                    sensors=[
                        sensor(title="Luftdruck (NN)", unit="hPa"),
                        sensor(_id="uv", title="UV-Index", unit="Idx"),
                    ]
                )
            ]
        )
    )
    assert [(o.phenomenon, o.unit) for o in page.observations] == [
        ("pressure_msl", "hPa"),
        ("uv_index", "1"),
    ]


def test_metadata_request_and_failure_do_not_create_readings_or_advance():
    adapter = OsemAdapter(metadata_only=True)
    wm = Watermark(source_id="osem_metadata")
    request = adapter.request(wm, NOW, NOW)
    assert request["params"] == {
        "bbox": "9.05,49.05,9.35,49.25",
        "limit": 20,
        "full": "false",
    }
    page = adapter.decode(raw(source_id="osem_metadata"), 1, wm)
    assert not page.observations and not page.receipts
    assert page.manifest.details["stationary_box_ids"] == ["box-exact"]
    failed = decode(raw(http_status=503))
    assert failed.manifest.status == "UNREACHABLE"
    assert failed.next_watermark is None


def test_raw_replay_twice_deduplicates_observations_and_feature_receipts():
    engine = create_engine("sqlite://")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    payload = raw()
    raw_ref = repository.land_raw(payload)
    for expected in [1, 0]:
        page = OsemAdapter().decode(
            repository.get_raw(raw_ref), raw_ref, repository.get_watermark("osem")
        )
        assert (
            repository.ingest_page(
                raw_ref,
                page.observations,
                receipts=page.receipts,
                manifest=page.manifest,
                watermark=page.next_watermark,
            )["observations"]
            == expected
        )
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(db.feature_receipt)) == 1
    engine.dispose()


def test_original_sensor_identity_exposure_and_parallel_channels_are_retained():
    page = decode(
        raw(
            [
                box(
                    exposure="indoor",
                    name="Indoor example",
                    sensors=[
                        sensor(
                            _id="first",
                            lastMeasurement={"value": "21.2", "createdAt": NOW.isoformat()},
                        ),
                        sensor(
                            _id="second",
                            lastMeasurement={"value": "22.3", "createdAt": NOW.isoformat()},
                        ),
                    ],
                )
            ]
        )
    )
    assert len(page.observations) == 2
    assert {item.provenance.sensor_id for item in page.observations} == {"first", "second"}
    assert all(item.provenance.exposure == "indoor" for item in page.observations)
    assert all(item.provenance.station_name == "Indoor example" for item in page.observations)
    assert page.observations[0].provenance.raw_value == "21.2"


def test_unknown_exposure_and_missing_measurements_are_explicit():
    page = decode(raw([box(exposure="unknown")]))
    assert page.observations == [] and page.manifest.status == "PARTIAL"
    page = decode(raw([box(sensors=[sensor(lastMeasurement={"value": None})])]))
    assert page.observations == [] and page.manifest.status == "PARTIAL"
    assert page.manifest.details["missing_readings"] == 1
