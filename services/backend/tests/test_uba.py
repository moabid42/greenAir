"""Explicitly synthetic UBA values using actual probe column order and IDs."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine

from app.ingestion.adapters.uba import MEASURE_COLUMNS, UbaAdapter, local_timestamp
from app.ingestion.contracts import RawPayload, Watermark
from app.storage import models as db
from app.storage.repository import Repository

BBOX = (9.05, 49.05, 9.35, 49.25)
NOW = datetime(2026, 10, 28, 16, tzinfo=UTC)


def raw(station="226", component="1", records=None, day="2026-10-27", source="uba"):
    params = {
        "station": station,
        "component": component,
        "scope": 2,
        "date_from": day,
        "date_to": day,
        "time_from": 1,
        "time_to": 24,
    }
    payload = {
        "request": {**params, "scope": "2"},
        "indices": {"data": {"station id": {"date start": MEASURE_COLUMNS}}},
        "data": {
            station: records
            if records is not None
            else {
                f"{day} 00:00:00": [int(component), 2, 0, f"{day} 01:00:00", "0"],
                f"{day} 23:00:00": [int(component), 2, None, f"{day} 24:00:00", None],
            }
        },
    }
    return RawPayload(
        source_id=source,
        url="https://example.test/synthetic-uba",
        request_params=params,
        http_status=200,
        response_headers={"content-type": "application/json"},
        retrieved_at_utc=NOW,
        body=json.dumps(payload).encode(),
    )


@pytest.mark.parametrize(
    "station,component,code,phenomenon",
    [
        ("226", "1", "DEBW015", "pm10"),
        ("226", "3", "DEBW015", "o3"),
        ("226", "5", "DEBW015", "no2"),
        ("226", "9", "DEBW015", "pm25"),
        ("353", "5", "DEBW152", "no2"),
    ],
)
def test_verified_station_component_metadata_and_interval_end(station, component, code, phenomenon):
    adapter = UbaAdapter(station, component, bbox=BBOX)
    page = adapter.decode(raw(station, component), 1, Watermark(source_id="uba"))
    assert len(page.observations) == 1
    item = page.observations[0]
    assert item.source == "uba" and item.station_id == code
    assert item.phenomenon == phenomenon and item.unit == "µg/m³"
    assert item.value == 0 and item.qc_flags == []
    assert item.ts_utc == datetime(2026, 10, 27, 0, tzinfo=UTC)
    assert item.kind == "observation" and item.issued_at is None
    assert item.geom.coordinates == ([9.2248, 49.1655] if station == "226" else [9.2259, 49.146])
    assert page.manifest.rows_downloaded == 2
    assert page.manifest.details["missing_values"] == 1
    assert len(page.receipts) == 2
    assert page.receipts[1].outcome == "FILTERED"


def test_24_hour_endings_and_dst_are_explicit_without_a_guessed_fold():
    assert local_timestamp("2026-10-27 24:00:00") == datetime(2026, 10, 27, 23, tzinfo=UTC)
    assert local_timestamp("2026-07-01 01:00:00") == datetime(2026, 6, 30, 23, tzinfo=UTC)
    with pytest.raises(ValueError, match="ambiguous"):
        local_timestamp("2026-10-25 02:00:00")
    with pytest.raises(ValueError, match="nonexistent"):
        local_timestamp("2026-03-29 02:00:00")
    with pytest.raises(ValueError, match="24-hour"):
        local_timestamp("2026-10-27 24:01:00")
    records = {"2026-10-25 02:00:00": [1, 2, 20, "2026-10-25 03:00:00", None]}
    page = UbaAdapter("226", "1", bbox=BBOX).decode(
        raw(records=records, day="2026-10-25"), 1, Watermark(source_id="uba")
    )
    assert page.observations == []
    assert page.receipts[0].outcome == "UNRESOLVED"
    assert page.manifest.details["unresolved_count"] == 1
    assert "ambiguous" in page.receipts[0].reason


def test_native_day_cursor_advances_empty_pages_and_resumes_with_read_only_scheduler_state():
    start, end = datetime(2025, 12, 5, tzinfo=UTC), datetime(2025, 12, 8, tzinfo=UTC)
    adapter = UbaAdapter("353", "5", bbox=BBOX, source_id="uba_353_5")
    watermark = Watermark(
        source_id=adapter.source_id, state={"_scheduler": {"window_end": end.isoformat()}}
    )
    request = adapter.request(watermark, start, end)
    assert request["params"]["date_from"] == "2025-12-05"
    assert request["params"]["time_from"] == 1 and request["params"]["time_to"] == 24
    page = adapter.decode(
        raw("353", "5", records={}, day="2025-12-05", source=adapter.source_id), 1, watermark
    )
    assert page.next_watermark.state["more"]
    assert page.next_watermark.state["_scheduler"] == watermark.state["_scheduler"]
    restarted = UbaAdapter("353", "5", bbox=BBOX, source_id=adapter.source_id)
    next_request = restarted.request(page.next_watermark, start, end)
    assert next_request["params"]["date_from"] == "2025-12-06"
    assert page.next_watermark.last_ts is None


def test_unknown_station_scope_and_moved_geometry_are_rejected():
    with pytest.raises(ValueError, match="only hourly NO2"):
        UbaAdapter("353", "1", bbox=BBOX)
    payload = raw()
    altered = json.loads(payload.body)
    altered["data"]["226"]["2026-10-27 00:00:00"][1] = 6
    payload.body = json.dumps(altered).encode()
    page = UbaAdapter("226", "1", bbox=BBOX).decode(payload, 1, Watermark(source_id="uba"))
    assert page.receipts[0].outcome == "UNRESOLVED"
    page = UbaAdapter("226", "1", bbox=(9.05, 49.05, 9.20, 49.25)).decode(
        raw(), 1, Watermark(source_id="uba")
    )
    assert page.observations == []
    assert all(r.outcome == "FILTERED" for r in page.receipts)


def test_actual_schema_can_be_replayed_twice_without_duplicate_rows():
    engine = create_engine("sqlite://")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    adapter = UbaAdapter("226", "1", bbox=BBOX)
    ref = repository.land_raw(raw())
    counts = []
    for _ in range(2):
        page = adapter.decode(repository.get_raw(ref), ref, Watermark(source_id="uba"))
        counts.append(
            repository.ingest_page(
                ref, page.observations, receipts=page.receipts, manifest=page.manifest
            )["observations"]
        )
    assert counts == [1, 0]
    engine.dispose()


def test_namespaced_source_and_original_channel_survive_storage_and_projection():
    from app.processing.ingested import project_observation

    adapter = UbaAdapter("226", "1", bbox=BBOX, source_id="uba_226_1")
    page = adapter.decode(raw(source="uba_226_1"), 7, Watermark(source_id="uba_226_1"))
    item = page.observations[0]
    assert item.source == "uba_226_1" and item.provenance.sensor_id == "226:1:2"
    assert item.provenance.interval_seconds == 3600 and item.provenance.raw_value == 0
    assert item.provenance.raw_key == "1" and item.provenance.exposure == "outdoor"
    projected = project_observation(item, retrieved_at=NOW)
    assert projected.kind == "observation" and projected.raw_ref == 7
    assert projected.value == 0 and projected.observed_at == item.ts_utc
