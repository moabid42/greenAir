"""Synthetic values shaped by actual probe refs 19–26; not live data fixtures."""

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, select

from app.ingestion.adapters.atrai_segments import AtraiSegmentAdapter
from app.ingestion.contracts import RawPayload, Watermark
from app.storage import models as db
from app.storage.repository import Repository

BBOX = (9.05, 49.05, 9.35, 49.25)
NOW = datetime(2026, 10, 28, 16, tzinfo=UTC)
LINE = {"type": "LineString", "coordinates": [[9.21, 49.14], [9.22, 49.15]]}


def raw(source, properties, *, offset=0, total=1, timestamp=NOW, geometry=LINE):
    payload = {
        "type": "FeatureCollection",
        "offset": offset,
        "limit": 3,
        "numberMatched": total,
        "numberReturned": 1,
        "features": [{"type": "Feature", "geometry": geometry, "properties": properties}],
    }
    return RawPayload(
        source_id=source,
        url="https://example.test/verified-shape",
        request_params={"offset": offset, "limit": 3, "f": "json"},
        http_status=200,
        response_headers={"content-type": "application/json"},
        retrieved_at_utc=timestamp,
        body=json.dumps(payload).encode(),
    )


def test_segment_properties_scale_and_confidence_are_retained_without_normalization():
    source = "atrai_bumpy_roads_heilbronn"
    properties = {
        "id": 6,
        "osmid": "123",
        "Normalized Roughness": 22.14,
        "Number of Boxes": 0,
        "a future nullable field": None,
    }
    adapter = AtraiSegmentAdapter(source, "bumpy_roads_heilbronn", bbox=BBOX)
    page = adapter.decode(raw(source, properties), 1, Watermark(source_id=source))
    assert page.observations == []
    assert page.layers[0].properties == properties
    assert page.layers[0].number_of_boxes == 0
    assert page.layers[0].points_in_segment is None
    assert page.receipts[0].outcome == "INGESTED"


def test_capture_replay_is_idempotent_and_new_capture_keeps_stable_road_id():
    engine = create_engine("sqlite://")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    source = "atrai_road_network_heilbronn"
    adapter = AtraiSegmentAdapter(source, "road_network_heilbronn", bbox=BBOX)
    properties = {"index": "(11, 22, 0)", "osmid": "123", "name": "Synthetic road"}
    ids = []
    for day in (0, 0, 1):
        payload = raw(source, properties, timestamp=NOW + timedelta(days=day))
        ref = repository.land_raw(payload)
        page = adapter.decode(payload, ref, Watermark(source_id=source))
        inserted = repository.ingest_page(
            ref,
            layers=page.layers,
            segments=page.segments,
            receipts=page.receipts,
            manifest=page.manifest,
        )
        ids.append(inserted)
    assert ids == [
        {"observations": 0, "layers": 1, "segments": 1},
        {"observations": 0, "layers": 0, "segments": 0},
        {"observations": 0, "layers": 1, "segments": 0},
    ]
    with engine.connect() as conn:
        assert len(conn.execute(select(db.segment)).all()) == 1
        assert len(conn.execute(select(db.segment_layer_value)).all()) == 2
    engine.dispose()


def test_page_cursor_keeps_capture_time_across_midnight_and_filters_outside_geometry():
    source = "atrai_bumpy_roads_heilbronn"
    adapter = AtraiSegmentAdapter(source, "bumpy_roads_heilbronn", bbox=BBOX)
    first = adapter.decode(raw(source, {"id": 1}, total=2), 1, Watermark(source_id=source))
    assert first.next_watermark.state["more"]
    next_raw = raw(
        source,
        {"id": 2},
        offset=1,
        total=2,
        timestamp=NOW + timedelta(days=1),
        geometry={"type": "LineString", "coordinates": [[49.14, 9.21], [49.15, 9.22]]},
    )
    second = adapter.decode(next_raw, 2, first.next_watermark)
    assert second.layers == []
    assert second.receipts[0].outcome == "FILTERED"
    assert second.receipts[0].build_key == first.receipts[0].build_key
    assert not second.next_watermark.state["more"]


def test_requests_are_bounded_city_only_and_do_not_claim_server_filters():
    import pytest

    adapter = AtraiSegmentAdapter("roads", "road_network_heilbronn", bbox=BBOX, page_size=250)
    request = adapter.request(Watermark(source_id="roads", last_offset=500), NOW, NOW)
    assert request["params"] == {"f": "json", "limit": 250, "offset": 500}
    assert "road_network_heilbronn" in request["url"]
    with pytest.raises(ValueError):
        AtraiSegmentAdapter("global", "osem_bike_data", bbox=BBOX)
    with pytest.raises(ValueError):
        AtraiSegmentAdapter("roads", "road_network_heilbronn", bbox=BBOX, page_size=0)


def test_changing_total_and_mismatched_source_do_not_advance_capture():
    import pytest

    adapter = AtraiSegmentAdapter("rough", "bumpy_roads_heilbronn", bbox=BBOX)
    first = adapter.decode(raw("rough", {"id": 1}, total=2), 1, Watermark(source_id="rough"))
    with pytest.raises(ValueError, match="total changed"):
        adapter.decode(raw("rough", {"id": 2}, offset=1, total=3), 2, first.next_watermark)
    with pytest.raises(ValueError, match="sources must match"):
        adapter.decode(raw("another", {"id": 1}), 1, Watermark(source_id="rough"))


def test_capture_accounting_rejects_duplicate_pages_and_preserves_last_success():
    from app.storage.spatial import SpatialRepository

    engine = create_engine("sqlite://")
    db.metadata.create_all(engine)
    repository = Repository(engine)
    source = "atrai_bumpy_roads_heilbronn"
    adapter = AtraiSegmentAdapter(source, "bumpy_roads_heilbronn", bbox=BBOX)

    def ingest(properties, watermark, **kwargs):
        payload = raw(source, properties, **kwargs)
        ref = repository.land_raw(payload)
        page = adapter.decode(payload, ref, watermark)
        repository.ingest_page(
            ref,
            layers=page.layers,
            receipts=page.receipts,
            watermark=page.next_watermark,
            manifest=page.manifest,
        )
        return page.next_watermark

    ingest({"id": 1}, Watermark(source_id=source))
    reader = SpatialRepository(repository)
    successful = reader.latest_capture("bumpy_roads_heilbronn")
    assert successful and successful.reported_total == 1
    assert successful.layers[0].built_at == NOW
    # New capture's provider repeats the same feature across two offsets. The
    # envelope reaches its reported total, but distinct identity accounting fails.
    first = ingest(
        {"id": 2}, Watermark(source_id=source), total=2, timestamp=NOW + timedelta(hours=1)
    )
    assert reader.latest_capture("bumpy_roads_heilbronn") == successful
    ingest({"id": 2}, first, offset=1, total=2, timestamp=NOW + timedelta(hours=1))
    assert reader.latest_capture("bumpy_roads_heilbronn") == successful
    # A later consistent capture supersedes the prior success, including an
    # explicitly filtered feature. Outside-city geometry never becomes a road.
    first = ingest(
        {"id": 3}, Watermark(source_id=source), total=2, timestamp=NOW + timedelta(hours=2)
    )
    ingest(
        {"id": 4},
        first,
        offset=1,
        total=2,
        timestamp=NOW + timedelta(hours=2),
        geometry={"type": "LineString", "coordinates": [[6, 48], [6.1, 48.1]]},
    )
    captured = reader.latest_capture("bumpy_roads_heilbronn")
    assert captured.reported_total == 2 and captured.filtered == 1
    assert len(captured.layers) == 1
    assert captured.captured_at == NOW + timedelta(hours=2)
    engine.dispose()
