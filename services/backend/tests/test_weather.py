"""Synthetic values using probe-verified schemas; no claims about live coverage."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, func, select

from app.ingestion.adapters.weather import (
    AQ_FIELDS,
    BRIGHTSKY_FIELDS,
    WEATHER_FIELDS,
    BrightSkyAdapter,
    OpenMeteoAdapter,
)
from app.ingestion.contracts import RawPayload, Watermark
from app.storage import models as db
from app.storage.repository import Repository

BBOX = (9.05, 49.05, 9.35, 49.25)
NOW = datetime(2026, 10, 28, 16, tzinfo=UTC)
ISSUE = NOW - timedelta(hours=3)  # Explicit synthetic model issue, not retrieval.


def raw(source, payload, params=None):
    return RawPayload(
        source_id=source,
        url="https://example.test/synthetic-weather",
        http_status=200,
        response_headers={"content-type": "application/json"},
        retrieved_at_utc=NOW,
        body=json.dumps(payload).encode(),
        request_params=params or {},
    )


def sky(record=None, sources=None):
    return {
        "sources": sources
        or [
            {
                "id": 324158,
                "dwd_station_id": "15547",
                "observation_type": "historical",
                "lon": 9.1428,
                "lat": 49.1259,
            }
        ],
        "weather": [
            record
            or {
                "source_id": 324158,
                "timestamp": NOW.isoformat(),
                **{field: None for field in BRIGHTSKY_FIELDS},
                "wind_speed": 0,
                "sunshine": 2,
            }
        ],
    }


def meteo(source="openmeteo_fcst"):
    fields = AQ_FIELDS if source == "openmeteo_aq" else WEATHER_FIELDS
    return {
        "longitude": 9.202922,
        "latitude": 49.13525,
        "utc_offset_seconds": 0,
        "generationtime_ms": 1.234,
        "hourly_units": {
            "time": "unixtime",
            **{
                field: "" if field == "uv_index" else unit.replace("µ", "μ")
                for field, (_, unit) in fields.items()
            },
        },
        "hourly": {
            "time": [int(NOW.timestamp()), int(NOW.timestamp()) + 3600],
            **{field: [0, None] for field in fields},
        },
    }


def test_city_station_sunshine_conversion_nulls_and_empty_qc():
    adapter = BrightSkyAdapter(bbox=BBOX)
    page = adapter.decode(raw("brightsky", sky()), 1, Watermark(source_id="brightsky"))
    values = {item.phenomenon: item for item in page.observations}
    assert values["wind_speed"].value == 0
    assert values["sunshine"].value == 120
    assert values["sunshine"].unit == "s"
    assert values["wind_speed"].geom.coordinates == [9.1428, 49.1259]
    assert values["wind_speed"].station_id == "15547"
    assert all(item.qc_flags == [] and item.issued_at is None for item in values.values())
    assert "temp" not in values
    assert page.receipts[0].canonical_count == 2
    assert page.manifest.rows_downloaded == 1
    assert page.manifest.status == "PARTIAL"


def test_per_field_fallback_keeps_real_station_and_rejects_outside_bbox():
    payload = sky()
    payload["sources"].extend(
        [
            {
                "id": 99,
                "dwd_station_id": "outside",
                "observation_type": "historical",
                "lon": 9.3525,
                "lat": 49.128,
            },
            {
                "id": 100,
                "dwd_station_id": "second-local",
                "observation_type": "historical",
                "lon": 9.22,
                "lat": 49.15,
            },
        ]
    )
    record = payload["weather"][0]
    record.update(
        temperature=15,
        relative_humidity=61,
        fallback_source_ids={"temperature": 99, "relative_humidity": 100},
    )
    page = BrightSkyAdapter(bbox=BBOX).decode(
        raw("brightsky", payload), 1, Watermark(source_id="brightsky")
    )
    values = {item.phenomenon: item for item in page.observations}
    assert "temp" not in values
    assert values["rh"].station_id == "second-local"
    assert values["rh"].geom.coordinates == [9.22, 49.15]
    assert page.manifest.details["outside_bbox_by_field"] == {"temperature": 1}
    assert len(page.manifest.details["source_provenance"]) == 3
    assert len(page.receipts) == 1  # Provider record, not one per sensor channel.


def test_brightsky_current_uses_sixty_minute_fields_and_forecast_requires_resolver():
    payload = sky()
    record = payload["weather"][0]
    record.update(wind_speed_60=12, sunshine_60=3, wind_speed_10=99)
    payload["weather"] = record
    page = BrightSkyAdapter(bbox=BBOX, current=True).decode(
        raw("brightsky", payload), 1, Watermark(source_id="brightsky")
    )
    assert {o.phenomenon: o.value for o in page.observations} == {"wind_speed": 12, "sunshine": 180}
    payload["sources"][0]["observation_type"] = "forecast"
    unresolved = BrightSkyAdapter(bbox=BBOX, current=True).decode(
        raw("brightsky", payload), 1, Watermark(source_id="brightsky")
    )
    assert unresolved.observations == []
    assert unresolved.receipts[0].outcome == "UNRESOLVED"
    adapter = BrightSkyAdapter(bbox=BBOX, current=True, issue_resolver=lambda *_: ISSUE)
    result = adapter.decode(raw("brightsky", payload), 1, Watermark(source_id="brightsky"))
    assert all(o.kind == "forecast" and o.issued_at == ISSUE for o in result.observations)


def test_brightsky_daily_cursor_survives_restart_and_empty_page():
    start, end = NOW - timedelta(days=3), NOW
    adapter = BrightSkyAdapter(bbox=BBOX)
    watermark = Watermark(
        source_id="brightsky", state={"_scheduler": {"window_end": end.isoformat()}}
    )
    request = adapter.request(watermark, start, end)
    page = adapter.decode(
        raw("brightsky", {"weather": [], "sources": []}, request["params"]), 1, watermark
    )
    assert page.next_watermark.state["more"]
    assert page.next_watermark.state["_scheduler"] == watermark.state["_scheduler"]
    restarted = BrightSkyAdapter(bbox=BBOX)
    next_request = restarted.request(page.next_watermark, start, end)
    assert next_request["params"]["date"] == request["params"]["last_date"]
    assert next_request["params"]["dwd_station_id"] == "15547"


@pytest.mark.parametrize("source", ["openmeteo_fcst", "openmeteo_aq"])
def test_meteo_forecast_uses_returned_units_grid_and_preserves_nulls(source):
    adapter = OpenMeteoAdapter(source, bbox=BBOX, issue_resolver=lambda *_: ISSUE)
    page = adapter.decode(raw(source, meteo(source)), 1, Watermark(source_id=source))
    assert len(page.observations) == 2 * len(adapter.fields)
    assert len(page.receipts) == 2
    assert page.receipts[0].canonical_count == len(adapter.fields)
    assert page.receipts[1].canonical_count == len(adapter.fields)
    assert all(item.kind == "forecast" and item.issued_at == ISSUE for item in page.observations)
    assert all(item.value in (0, None) for item in page.observations)
    assert all(item.geom.coordinates == [9.202922, 49.13525] for item in page.observations)
    assert page.manifest.rows_downloaded == 2
    assert page.manifest.details["missing_by_field"]
    assert not page.next_watermark.state["more"]
    if source == "openmeteo_aq":
        assert {o.unit for o in page.observations if o.phenomenon == "pm25"} == {"µg/m³"}
        assert {o.unit for o in page.observations if o.phenomenon == "european_aqi"} == {"EAQI"}


def test_unknown_units_misaligned_arrays_and_outside_grid_are_not_reinterpreted():
    adapter = OpenMeteoAdapter("openmeteo_fcst", bbox=BBOX, issue_resolver=lambda *_: ISSUE)
    payload = meteo()
    payload["hourly_units"]["temperature_2m"] = "unexpected"
    payload["hourly"]["precipitation"] = [9]
    page = adapter.decode(raw("openmeteo_fcst", payload), 1, Watermark(source_id="openmeteo_fcst"))
    assert not {"temp", "precip"} & {o.phenomenon for o in page.observations}
    assert page.receipts[0].outcome == "UNRESOLVED"
    payload["longitude"] = 10
    page = adapter.decode(raw("openmeteo_fcst", payload), 1, Watermark(source_id="openmeteo_fcst"))
    assert page.observations == []
    assert {r.outcome for r in page.receipts} == {"FILTERED"}


def test_meteo_does_not_invent_issue_time_and_rejects_implicit_timezones():
    adapter = OpenMeteoAdapter("openmeteo_fcst", bbox=BBOX, issue_resolver=None)
    page = adapter.decode(raw("openmeteo_fcst", meteo()), 1, Watermark(source_id="openmeteo_fcst"))
    assert all(item.issued_at is None for item in page.observations)
    assert page.receipts[0].build_key == "capture:1"
    assert page.manifest.details["issued_at"] is None
    adapter.issue_resolver = lambda *_: NOW.replace(tzinfo=None)
    with pytest.raises(ValueError, match="explicit timestamp"):
        adapter.decode(raw("openmeteo_fcst", meteo()), 1, Watermark(source_id="openmeteo_fcst"))


@pytest.mark.parametrize("source", ["brightsky", "openmeteo_fcst", "openmeteo_aq"])
def test_identical_weather_snapshot_inserts_zero_rows_on_second_replay(source):
    engine = create_engine("sqlite://")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    adapter = (
        BrightSkyAdapter(bbox=BBOX)
        if source == "brightsky"
        else OpenMeteoAdapter(source, bbox=BBOX, issue_resolver=lambda *_: ISSUE)
    )
    payload = raw(source, sky() if source == "brightsky" else meteo(source))
    ref = repository.land_raw(payload)
    counts = []
    for _ in range(2):
        page = adapter.decode(repository.get_raw(ref), ref, Watermark(source_id=source))
        counts.append(
            repository.ingest_page(
                ref, page.observations, receipts=page.receipts, manifest=page.manifest
            )["observations"]
        )
    assert counts[0] > 0
    assert counts[1] == 0
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(db.feature_receipt)) == len(
            page.receipts
        )
    engine.dispose()


def test_meteo_original_units_nulls_and_unknown_issue_survive_processing():
    from app.processing.ingested import project_observation

    payload = meteo()
    payload["hourly"]["wind_speed_10m"] = [36, None]
    page = OpenMeteoAdapter("openmeteo_fcst", bbox=BBOX).decode(
        raw("openmeteo_fcst", payload), 21, Watermark(source_id="openmeteo_fcst")
    )
    wind = [item for item in page.observations if item.phenomenon == "wind_speed"]
    processed = [project_observation(item, retrieved_at=NOW) for item in wind]
    assert [item.value for item in processed] == [10, None]
    assert processed[0].raw_key == "wind_speed_10m" and processed[0].raw_unit == "km/h"
    assert processed[0].raw_value == "36" and processed[0].issued_at is None
    assert processed[0].raw_ref == 21 and processed[0].kind == "model"
    assert processed[1].raw_value is None and not processed[1].usable


@pytest.mark.parametrize("times", [[0, 0], [3600, 0], [0, 7200], [0] * 49])
def test_unverified_hourly_axes_are_rejected(times):
    payload = meteo()
    payload["hourly"]["time"] = times
    with pytest.raises(ValueError, match="hourly|forecast bound"):
        OpenMeteoAdapter("openmeteo_fcst", bbox=BBOX).decode(
            raw("openmeteo_fcst", payload), 1, Watermark(source_id="openmeteo_fcst")
        )


def test_brightsky_original_sunshine_and_namespaced_source_are_preserved():
    adapter = BrightSkyAdapter(bbox=BBOX, source_id="brightsky_current")
    page = adapter.decode(
        raw("brightsky_current", sky()), 1, Watermark(source_id="brightsky_current")
    )
    sunshine = next(item for item in page.observations if item.phenomenon == "sunshine")
    assert sunshine.source == "brightsky_current" and sunshine.provenance.raw_value == 2
    assert sunshine.provenance.raw_unit == "min" and sunshine.value == 120
