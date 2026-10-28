"""Synthetic contract/transaction tests; not proof of provider or extension behavior."""

import hashlib
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, delete, event, func, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app.ingestion.contracts import (
    FeatureReceipt,
    LayerRecord,
    Manifest,
    RawPayload,
    SegmentRecord,
    Watermark,
)
from app.messaging.bus import MemoryBus
from app.schemas.observation import Geometry, Observation, ProviderValue
from app.storage import models as db
from app.storage.repository import Repository, observation_id

NOW = datetime(2026, 10, 28, 12, tzinfo=UTC)
POINT = {"type": "Point", "coordinates": [9.2109, 49.1427]}
LINE = {"type": "LineString", "coordinates": [[9.21, 49.14], [9.22, 49.15]]}


@pytest.fixture
def repository():
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    db.metadata.create_all(engine)
    yield Repository(engine)
    engine.dispose()


def raw(**changes):
    data = dict(
        source_id="synthetic",
        url="https://example.test/samples",
        method="GET",
        request_params={"offset": 0},
        http_status=200,
        response_headers={"Content-Type": "application/json", "Last-Modified": "original"},
        retrieved_at_utc=NOW,
        body=b'{"ts":"2026-10-28T14:00:00+02:00"}',
    )
    return RawPayload(**(data | changes))


def observation(raw_ref=1, **changes):
    data = dict(
        source="synthetic",
        station_id="station-1",
        geom=POINT,
        phenomenon="temp",
        value=15.5,
        unit="°C",
        ts_utc=NOW,
        raw_ref=raw_ref,
    )
    return Observation(**(data | changes))


def count(repository, table):
    with repository.engine.connect() as conn:
        return conn.scalar(select(func.count()).select_from(table))


def test_raw_bytes_metadata_and_original_timestamp_replay_verbatim(repository):
    payload = raw()
    raw_ref = repository.land_raw(payload)
    assert repository.get_raw(raw_ref) == payload
    with repository.engine.connect() as conn:
        stored = conn.execute(select(db.raw_payload)).mappings().one()
    assert stored["body"] == payload.body
    assert stored["sha256"] == hashlib.sha256(payload.body).hexdigest()
    assert list(repository.replay_raw("synthetic", since=NOW, until=NOW + timedelta(days=1))) == [
        (raw_ref, payload)
    ]
    assert list(repository.replay_raw("synthetic", until=NOW)) == []


def test_parse_failure_keeps_independently_committed_raw(repository):
    raw_ref = repository.land_raw(raw(body=b"not valid JSON"))
    with pytest.raises(ValueError):
        import json

        json.loads(repository.get_raw(raw_ref).body)
    assert repository.get_raw(raw_ref).body == b"not valid JSON"
    assert count(repository, db.observations) == 0


def test_feature_receipts_count_provider_records_and_manifest_counts_insertions(repository):
    raw_ref = repository.land_raw(raw())
    items = [observation(raw_ref), observation(raw_ref, phenomenon="rh", value=65, unit="%")]
    receipts = [
        FeatureReceipt(
            source_id="synthetic",
            feature_id="record-1",
            raw_ref=raw_ref,
            outcome="INGESTED",
            canonical_count=2,
            observed_at=NOW,
        ),
        FeatureReceipt(
            source_id="synthetic",
            feature_id="record-2",
            raw_ref=raw_ref,
            outcome="FILTERED",
            reason="outside approved bbox",
        ),
    ]
    manifest = Manifest(
        source_id="synthetic",
        url=raw().url,
        retrieved_at_utc=NOW,
        rows_downloaded=2,
        rows_ingested=999,
        status="SUCCESS",
    )
    for expected in (2, 0):
        assert (
            repository.ingest_page(
                raw_ref,
                items,
                receipts=receipts,
                manifest=manifest,
                watermark=Watermark(source_id="synthetic", last_offset=2),
            )["observations"]
            == expected
        )
    assert count(repository, db.feature_receipt) == 2
    assert count(repository, db.observations) == 2
    with repository.engine.connect() as conn:
        stored = conn.execute(select(db.manifest).order_by(db.manifest.c.id)).mappings().all()
    assert [row["rows_ingested"] for row in stored] == [2, 0]


def test_bad_receipt_rolls_back_canonical_rows_and_checkpoint(repository):
    raw_ref = repository.land_raw(raw())
    wrong_source = FeatureReceipt(
        source_id="wrong", feature_id="record-1", raw_ref=raw_ref, outcome="INGESTED"
    )
    with pytest.raises(ValueError, match="receipt source"):
        repository.ingest_page(
            raw_ref,
            [observation(raw_ref)],
            receipts=[wrong_source],
            watermark=Watermark(source_id="synthetic", last_offset=1),
        )
    for table in (db.observations, db.outbox, db.watermark, db.feature_receipt):
        assert count(repository, table) == 0
    assert repository.get_raw(raw_ref).body == raw().body


def test_raw_replay_can_resolve_a_previously_unknown_contract(repository):
    raw_ref = repository.land_raw(raw())
    unresolved = FeatureReceipt(
        source_id="synthetic",
        feature_id="record-1",
        raw_ref=raw_ref,
        outcome="UNRESOLVED",
        reason="unit contract not yet verified",
    )
    repository.ingest_page(raw_ref, receipts=[unresolved])
    resolved = unresolved.model_copy(
        update={"outcome": "INGESTED", "reason": None, "canonical_count": 1}
    )
    repository.ingest_page(raw_ref, [observation(raw_ref)], receipts=[resolved])
    repository.ingest_page(raw_ref, receipts=[unresolved])
    with repository.engine.connect() as conn:
        row = conn.execute(select(db.feature_receipt)).mappings().one()
    assert row["outcome"] == "INGESTED"
    assert row["canonical_count"] == 1
    assert row["reason"] is None


def test_raw_must_exist_before_canonical_or_checkpoint(repository):
    with pytest.raises(ValueError, match="landed"):
        repository.ingest_page(1, [observation()], watermark=Watermark(source_id="synthetic"))
    assert count(repository, db.observations) == 0
    assert count(repository, db.watermark) == 0


def test_repoll_null_issue_time_has_zero_new_rows_and_events(repository):
    raw_ref = repository.land_raw(raw())
    item = observation(raw_ref)
    assert repository.ingest_page(raw_ref, [item])["observations"] == 1
    assert repository.ingest_page(raw_ref, [item])["observations"] == 0
    # Corrections share the task's upsert identity and do not silently replace history.
    assert repository.ingest_page(raw_ref, [observation(raw_ref, value=22)])["observations"] == 0
    assert count(repository, db.observations) == count(repository, db.outbox) == 1
    bus = MemoryBus()
    assert repository.flush_outbox(bus) == 1
    assert repository.flush_outbox(bus) == 0
    assert list(bus.events) == [observation_id(item)]
    assert next(iter(bus.events.values())).topic == "observations.raw"


def test_forecast_versions_and_observed_value_remain_distinguishable(repository):
    raw_ref = repository.land_raw(raw())
    items = [
        observation(raw_ref),
        observation(raw_ref, kind="forecast", issued_at=NOW - timedelta(hours=1)),
        observation(raw_ref, kind="forecast", issued_at=NOW - timedelta(hours=2)),
    ]
    assert repository.ingest_page(raw_ref, items)["observations"] == 3
    assert repository.ingest_page(raw_ref, items)["observations"] == 0
    assert count(repository, db.outbox) == 3


@pytest.mark.parametrize("filler_count", [0, 99])
def test_duplicate_key_candidates_publish_the_first_persisted_value(repository, filler_count):
    raw_ref = repository.land_raw(raw())
    first = observation(raw_ref, value=15.5)
    fillers = [observation(raw_ref, station_id=f"filler-{i}") for i in range(filler_count)]
    items = [first, *fillers, observation(raw_ref, value=22.0)]
    assert repository.ingest_page(raw_ref, items)["observations"] == filler_count + 1
    assert repository.ingest_page(raw_ref, items)["observations"] == 0
    with repository.engine.connect() as conn:
        persisted = conn.scalar(
            select(db.observations.c.value).where(db.observations.c.id == observation_id(first))
        )
    bus = MemoryBus()
    assert repository.flush_outbox(bus) == filler_count + 1
    assert len(bus.events) == filler_count + 1
    assert bus.events[observation_id(first)].payload["value"] == persisted == first.value


def test_page_rollback_leaves_no_rows_events_or_advanced_watermark(repository):
    raw_ref = repository.land_raw(raw())
    # Invalid final record must roll back the already-inserted first batch.
    items = [observation(raw_ref, station_id=f"station-{i}") for i in range(100)]
    items.append(observation(raw_ref, geom={"type": "Point", "coordinates": [49.14, 9.21]}))
    with pytest.raises(ValueError, match="outside"):
        repository.ingest_page(
            raw_ref,
            items,
            watermark=Watermark(source_id="synthetic", last_offset=101, last_success_at=NOW),
        )
    assert count(repository, db.raw_payload) == 1
    for table in (db.observations, db.outbox, db.watermark):
        assert count(repository, table) == 0
    valid = items[:-1]
    repository.ingest_page(
        raw_ref,
        valid,
        watermark=Watermark(
            source_id="synthetic", last_offset=100, last_ts=NOW, last_success_at=NOW
        ),
    )
    assert repository.get_watermark("synthetic").last_offset == 100
    assert repository.get_watermark("synthetic").last_ts == NOW


def test_stable_segment_identity_and_exact_layer_history(repository):
    raw_ref = repository.land_raw(raw())
    road = SegmentRecord(
        collection="synthetic_roads", feature_id="abc", osmid="123", geom=LINE, raw_ref=raw_ref
    )
    props = {
        "Normalized Roughness": 0.2,
        "Number of Boxes": 3,
        "avg_speed[km/h]": 12.5,
        "points_in_segment": 8,
    }
    layer = LayerRecord(
        collection="synthetic_roughness",
        feature_id="abc",
        built_at=NOW,
        geom=LINE,
        properties=props,
        raw_ref=raw_ref,
        number_of_boxes=3,
        points_in_segment=8,
    )
    assert repository.ingest_page(raw_ref, segments=[road])["segments"] == 1
    with repository.engine.connect() as conn:
        segment_id = conn.scalar(select(db.segment.c.id))
    layer = layer.model_copy(update={"segment_id": segment_id})
    assert repository.ingest_page(raw_ref, layers=[layer])["layers"] == 1
    assert repository.ingest_page(raw_ref, segments=[road], layers=[layer]) == {
        "observations": 0,
        "layers": 0,
        "segments": 0,
    }
    tomorrow = layer.model_copy(update={"built_at": NOW + timedelta(days=1)})
    assert repository.ingest_page(raw_ref, layers=[tomorrow])["layers"] == 1
    with repository.engine.connect() as conn:
        rows = conn.execute(select(db.segment_layer_value)).mappings().all()
        assert conn.scalar(select(db.segment.c.id)) == segment_id
    assert len(rows) == 2
    assert all(row["properties"] == props and row["number_of_boxes"] == 3 for row in rows)
    changed_geometry = Geometry(type="LineString", coordinates=[[9.21, 49.14], [9.23, 49.15]])
    repository.ingest_page(raw_ref, segments=[road.model_copy(update={"geom": changed_geometry})])
    with repository.engine.connect() as conn:
        current = conn.execute(select(db.segment)).mappings().one()
    assert current["id"] == segment_id
    assert current["geom"] == changed_geometry.model_dump()
    assert rows[0]["geom"] == LINE
    assert count(repository, db.observations) == 0


def test_outbox_publish_failure_retries_same_event_id(repository):
    raw_ref = repository.land_raw(raw())
    repository.ingest_page(raw_ref, [observation(raw_ref)])

    class FailAfterDelivery(MemoryBus):
        fail = True

        def publish(self, item):
            super().publish(item)
            if self.fail:
                raise RuntimeError("synthetic acknowledgement failure")

    bus = FailAfterDelivery()
    with pytest.raises(RuntimeError):
        repository.flush_outbox(bus)
    bus.fail = False
    assert repository.flush_outbox(bus) == 1
    assert len(bus.events) == 1


def test_http_failure_raw_and_manifest_preserve_evidence(repository):
    payload = raw(
        http_status=403, body=b"restricted", response_headers={"Content-Type": "text/plain"}
    )
    raw_ref = repository.land_raw(payload)
    repository.record_manifest(
        raw_ref,
        Manifest(
            source_id="synthetic",
            url=payload.url,
            retrieved_at_utc=NOW,
            http_status=403,
            content_type="text/plain",
            status="RESTRICTED",
        ),
    )
    with repository.engine.connect() as conn:
        row = conn.execute(select(db.manifest)).mappings().one()
    assert row["sha256"] == hashlib.sha256(b"restricted").hexdigest()
    assert row["status"] == "RESTRICTED"


@pytest.mark.parametrize(
    "changes",
    [
        {"ts_utc": datetime(2026, 10, 28)},
        {"value": float("nan")},
        {"value": float("inf")},
        {"phenomenon": "invented_channel"},
        {"unit": "K"},
        {"geom": {"type": "Point", "coordinates": [9, 200]}},
    ],
)
def test_invalid_canonical_values_are_rejected(changes):
    with pytest.raises(ValidationError):
        observation(**changes)


def test_utc_conversion_and_bbox_order_are_explicit():
    item = observation(ts_utc="2026-10-28T14:00:00+02:00")
    assert item.ts_utc == NOW
    assert Geometry(**POINT).inside_bbox((9.05, 49.05, 9.35, 49.25))
    assert not Geometry(type="Point", coordinates=[49.1427, 9.2109]).inside_bbox(
        (9.05, 49.05, 9.35, 49.25)
    )


def test_ingest_rejects_downstream_qc_flags(repository):
    raw_ref = repository.land_raw(raw())
    with pytest.raises(ValueError, match="qc_flags"):
        repository.ingest_page(raw_ref, [observation(raw_ref, qc_flags=["synthetic"])])


def test_postgresql_schema_declares_postgis_and_time_partition_identity():
    # DDL compilation is a contract check, not a server/extension integration test.
    ddl = str(CreateTable(db.observations).compile(dialect=postgresql.dialect()))
    assert "geometry(Geometry,4326)" in ddl
    assert "PRIMARY KEY (id, ts_utc)" in ddl
    assert "provenance JSONB" in ddl
    assert "TIMESTAMP WITH TIME ZONE" in ddl
    road_ddl = str(CreateTable(db.segment).compile(dialect=postgresql.dialect()))
    assert "geometry(LineString,4326)" in road_ddl


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("GREENAIR_TEST_DATABASE_URL"),
    reason="requires explicitly configured migrated PostgreSQL/TimescaleDB/PostGIS",
)
def test_real_postgresql_extensions_raw_idempotency_history_and_recovery():
    """Touches only uniquely named synthetic records; leaves provider rows alone."""
    engine = create_engine(os.environ["GREENAIR_TEST_DATABASE_URL"])
    repository = Repository(engine)
    source = "foundation_test_" + uuid4().hex
    raw_ref = repository.land_raw(raw(source_id=source))
    item = observation(raw_ref, source=source)
    forecasts = [
        observation(raw_ref, source=source, kind="forecast", issued_at=NOW),
        observation(raw_ref, source=source, kind="forecast", issued_at=NOW - timedelta(hours=1)),
    ]
    keys = [observation_id(value) for value in [item, *forecasts]]
    try:
        with engine.connect() as conn:
            extensions = set(conn.execute(text("SELECT extname FROM pg_extension")).scalars())
            assert {"postgis", "timescaledb"} <= extensions
            assert (
                conn.scalar(
                    text("""SELECT count(*) FROM timescaledb_information.hypertables
                WHERE hypertable_name='observations'""")
                )
                == 1
            )
        assert (
            repository.ingest_page(
                raw_ref,
                [item, item.model_copy(update={"value": 99}), *forecasts],
                receipts=[
                    FeatureReceipt(
                        source_id=source,
                        feature_id="record-1",
                        raw_ref=raw_ref,
                        outcome="INGESTED",
                        canonical_count=3,
                        observed_at=NOW,
                    )
                ],
            )["observations"]
            == 3
        )
        assert repository.ingest_page(raw_ref, [item, *forecasts])["observations"] == 0
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    select(func.count())
                    .select_from(db.feature_receipt)
                    .where(db.feature_receipt.c.source_id == source)
                )
                == 1
            )
            stored_value = conn.scalar(
                select(db.observations.c.value).where(db.observations.c.id == keys[0])
            )
            event_payload = conn.scalar(
                select(db.outbox.c.payload).where(db.outbox.c.event_id == keys[0])
            )
            assert event_payload["value"] == stored_value == item.value
            point = conn.execute(
                select(func.ST_X(db.observations.c.geom), func.ST_Y(db.observations.c.geom)).where(
                    db.observations.c.id == keys[0]
                )
            ).one()
            assert tuple(point) == tuple(POINT["coordinates"])
        # A bad later geometry fails the transaction; recreating the Repository
        # models worker restart, and resumes only from the last committed page.
        repository.ingest_page(raw_ref, watermark=Watermark(source_id=source, last_offset=3))
        bad = observation(
            raw_ref, source=source, station_id="bad", geom={"type": "Point", "coordinates": [1, 1]}
        )
        with pytest.raises(ValueError):
            repository.ingest_page(
                raw_ref, [bad], watermark=Watermark(source_id=source, last_offset=4)
            )
        assert Repository(engine).get_watermark(source).last_offset == 3
        assert repository.get_raw(raw_ref).body == raw().body
        road = SegmentRecord(
            collection=source, feature_id="road", osmid="test-1", geom=LINE, raw_ref=raw_ref
        )
        repository.ingest_page(raw_ref, segments=[road])
        with engine.connect() as conn:
            segment_id = conn.scalar(
                select(db.segment.c.id).where(db.segment.c.collection == source)
            )
        layer = LayerRecord(
            collection=source,
            feature_id="road",
            built_at=NOW,
            geom=LINE,
            properties={"Number of Boxes": 2, "Normalized Roughness": 0.4},
            raw_ref=raw_ref,
            segment_id=segment_id,
            number_of_boxes=2,
        )
        assert repository.ingest_page(raw_ref, layers=[layer])["layers"] == 1
        assert repository.ingest_page(raw_ref, layers=[layer])["layers"] == 0
        assert (
            repository.ingest_page(
                raw_ref, layers=[layer.model_copy(update={"built_at": NOW + timedelta(days=1)})]
            )["layers"]
            == 1
        )
        with engine.connect() as conn:
            history = (
                conn.execute(
                    select(db.segment_layer_value.c.properties).where(
                        db.segment_layer_value.c.collection == source
                    )
                )
                .scalars()
                .all()
            )
        assert len(history) == 2 and all(row == layer.properties for row in history)
        # Exercise the new identity and nullable contract on the actual hypertable.
        mobile = [
            observation(
                raw_ref,
                source=source,
                provenance=ProviderValue(
                    platform="mobile",
                    sample_id=sample,
                    sensor_id="sensor",
                    raw_key="Temperatur",
                    raw_value="15.5",
                    raw_unit="°C",
                ),
            )
            for sample in ("sample-a", "sample-b")
        ]
        unknown_issue = observation(raw_ref, source=source, kind="forecast", value=None)
        extended = [*mobile, unknown_issue]
        keys.extend(observation_id(value) for value in extended)
        assert repository.ingest_page(raw_ref, extended)["observations"] == 3
        assert repository.ingest_page(raw_ref, extended)["observations"] == 0
        with engine.connect() as conn:
            stored = (
                conn.execute(
                    select(db.observations).where(db.observations.c.id == observation_id(mobile[0]))
                )
                .mappings()
                .one()
            )
            assert stored["provenance"] == mobile[0].provenance.model_dump()
            missing = (
                conn.execute(
                    select(db.observations).where(
                        db.observations.c.id == observation_id(unknown_issue)
                    )
                )
                .mappings()
                .one()
            )
            assert missing["value"] is None and missing["issued_at"] is None

    finally:
        with engine.begin() as conn:
            conn.execute(delete(db.feature_receipt).where(db.feature_receipt.c.source_id == source))
            conn.execute(delete(db.outbox).where(db.outbox.c.event_id.in_(keys)))
            conn.execute(delete(db.observations).where(db.observations.c.source == source))
            conn.execute(
                delete(db.segment_layer_value).where(db.segment_layer_value.c.collection == source)
            )
            conn.execute(delete(db.segment).where(db.segment.c.collection == source))
            conn.execute(delete(db.watermark).where(db.watermark.c.source_id == source))
            conn.execute(delete(db.manifest).where(db.manifest.c.source_id == source))
            conn.execute(delete(db.raw_payload).where(db.raw_payload.c.source_id == source))
        engine.dispose()


def test_wrong_source_cannot_advance_checkpoint(repository):
    raw_ref = repository.land_raw(raw())
    with pytest.raises(ValueError, match="observation source"):
        repository.ingest_page(
            raw_ref,
            [observation(raw_ref, source="another_provider")],
            watermark=Watermark(source_id="synthetic", last_offset=1),
        )
    assert count(repository, db.observations) == 0
    assert count(repository, db.outbox) == 0
    assert repository.get_watermark("synthetic").last_offset == 0
    assert repository.get_raw(raw_ref).body == raw().body
