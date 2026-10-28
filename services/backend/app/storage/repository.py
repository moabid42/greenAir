"""Raw-first persistence and atomic page checkpoints, with a durable outbox."""

import hashlib
import json
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime

from sqlalchemy import Engine, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.ingestion.contracts import (
    FeatureReceipt,
    LayerRecord,
    Manifest,
    RawPayload,
    SegmentRecord,
    Watermark,
)
from app.messaging.bus import Bus, Event
from app.schemas.observation import Geometry, Observation
from app.storage import models as db

APPROVED_BBOX = (9.05, 49.05, 9.35, 49.25)


def observation_id(item: Observation) -> str:
    """Stable identity including sensor/sample and model build, when available.

    Keep legacy stationary measurement hashes stable for existing stored data.
    Unknown model issue time uses the landed capture as an application build,
    never pretending retrieval is provider issuance.
    """
    key = [
        item.source,
        item.station_id,
        item.phenomenon,
        item.ts_utc.isoformat(),
        item.issued_at.isoformat() if item.issued_at else None,
    ]
    if item.provenance and (item.provenance.sensor_id or item.provenance.sample_id):
        key.extend([item.provenance.sensor_id, item.provenance.sample_id])
    if item.kind == "forecast" and item.issued_at is None:
        key.append(item.raw_ref)
    return hashlib.sha256(json.dumps(key, separators=(",", ":")).encode()).hexdigest()


class Repository:
    def __init__(self, engine: Engine, *, bbox=APPROVED_BBOX):
        if engine.dialect.name not in {"postgresql", "sqlite"}:
            raise ValueError("PostgreSQL is required (SQLite is for portable tests only)")
        self.engine = engine
        self.bbox = tuple(bbox)
        self._insert = pg_insert if engine.dialect.name == "postgresql" else sqlite_insert

    def land_raw(self, raw: RawPayload) -> int:
        """Commit bytes before any decoder runs, including failed HTTP responses."""
        values = raw.model_dump()
        values["sha256"] = hashlib.sha256(raw.body).hexdigest()
        with self.engine.begin() as conn:
            return conn.execute(
                db.raw_payload.insert().values(**values).returning(db.raw_payload.c.id)
            ).scalar_one()

    def get_raw(self, raw_ref: int) -> RawPayload:
        with self.engine.connect() as conn:
            row = (
                conn.execute(select(db.raw_payload).where(db.raw_payload.c.id == raw_ref))
                .mappings()
                .one()
            )
        return RawPayload.model_validate({k: row[k] for k in RawPayload.model_fields})

    def replay_raw(
        self, source_id: str, *, since: datetime | None = None, until: datetime | None = None
    ) -> Iterator[tuple[int, RawPayload]]:
        """Bounded streaming replay by retrieval time; never re-fetches a provider."""
        query = select(db.raw_payload).where(db.raw_payload.c.source_id == source_id)
        if since is not None:
            query = query.where(db.raw_payload.c.retrieved_at_utc >= since)
        if until is not None:
            query = query.where(db.raw_payload.c.retrieved_at_utc < until)
        query = query.order_by(db.raw_payload.c.retrieved_at_utc, db.raw_payload.c.id)
        with self.engine.connect().execution_options(stream_results=True) as conn:
            for row in conn.execute(query).mappings():
                yield (
                    row["id"],
                    RawPayload.model_validate({k: row[k] for k in RawPayload.model_fields}),
                )

    def get_watermark(self, source_id: str) -> Watermark:
        with self.engine.connect() as conn:
            row = (
                conn.execute(select(db.watermark).where(db.watermark.c.source_id == source_id))
                .mappings()
                .one_or_none()
            )
        return Watermark.model_validate(dict(row)) if row else Watermark(source_id=source_id)

    def _geom(self, geom: Geometry):
        if not geom.inside_bbox(self.bbox):
            raise ValueError("geometry outside configured Heilbronn bbox")
        if self.engine.dialect.name == "postgresql":
            return func.ST_SetSRID(func.ST_GeomFromGeoJSON(geom.model_dump_json()), 4326)
        return geom.model_dump()

    def ingest_page(
        self,
        raw_ref: int,
        observations: Iterable[Observation] = (),
        *,
        watermark: Watermark | None = None,
        layers: Iterable[LayerRecord] = (),
        segments: Iterable[SegmentRecord] = (),
        receipts: Iterable[FeatureReceipt] = (),
        manifest: Manifest | None = None,
    ) -> dict[str, int]:
        """All canonical rows, outbox events and checkpoint commit together.

        Raw has already committed independently. On any failure, no checkpoint
        advances and retry/replay uses those original bytes. Duplicate natural
        keys do not overwrite first-ingested values or emit another event.
        """
        items = list(observations)
        layer_items, segment_items = list(layers), list(segments)
        receipt_items = list(receipts)
        counts = {"observations": 0, "layers": 0, "segments": 0}
        with self.engine.begin() as conn:
            raw = (
                conn.execute(select(db.raw_payload).where(db.raw_payload.c.id == raw_ref))
                .mappings()
                .one_or_none()
            )
            if raw is None:
                raise ValueError("raw payload must be landed before canonical ingest")
            for item in [*items, *layer_items, *segment_items, *receipt_items]:
                if item.raw_ref != raw_ref:
                    raise ValueError("record raw_ref must match the landed page")
            for item in items:
                if item.source != raw["source_id"]:
                    raise ValueError("observation source must match the raw page")
            for start in range(0, len(items), 100):
                batch = items[start : start + 100]
                values = []
                by_id = {}
                for item in batch:
                    if item.qc_flags:
                        raise ValueError("ingestion must leave qc_flags empty")
                    data = item.model_dump()
                    data.update(id=observation_id(item), geom=self._geom(item.geom))
                    # ON CONFLICT keeps the first candidate. Retain the same
                    # candidate for its event when a provider repeats an ID
                    # with a different value inside one downloaded page.
                    if data["id"] not in by_id:
                        values.append(data)
                        by_id[data["id"]] = item
                inserted = (
                    conn.execute(
                        self._insert(db.observations)
                        .values(values)
                        .on_conflict_do_nothing()
                        .returning(db.observations.c.id)
                    )
                    .scalars()
                    .all()
                )
                counts["observations"] += len(inserted)
                if inserted:
                    conn.execute(
                        self._insert(db.outbox)
                        .values(
                            [
                                {
                                    "event_id": key,
                                    "topic": "observations.raw",
                                    "payload": by_id[key].model_dump(mode="json"),
                                    "created_at": datetime.now(UTC),
                                }
                                for key in inserted
                            ]
                        )
                        .on_conflict_do_nothing()
                    )
            for item in segment_items:
                if item.geom.type != "LineString":
                    raise ValueError("road segments require LineString geometry")
                values = item.model_dump()
                values["geom"] = self._geom(item.geom)
                # Stable integer identity; daily history lives in layer rows.
                statement = (
                    self._insert(db.segment)
                    .values(**values)
                    .on_conflict_do_nothing(index_elements=["collection", "feature_id"])
                    .returning(db.segment.c.id)
                )
                inserted_segments = len(conn.execute(statement).all())
                counts["segments"] += inserted_segments
                if not inserted_segments:
                    # Preserve the integer ID while reflecting a changed OSM
                    # build. The adapter also records each full build in layer
                    # history, so this current geometry never erases evidence.
                    conn.execute(
                        update(db.segment)
                        .where(
                            db.segment.c.collection == item.collection,
                            db.segment.c.feature_id == item.feature_id,
                            db.segment.c.geom.is_distinct_from(values["geom"]),
                        )
                        .values(geom=values["geom"], osmid=item.osmid, raw_ref=raw_ref)
                    )
            for item in layer_items:
                values = item.model_dump()
                values["geom"] = self._geom(item.geom)
                statement = self._insert(db.segment_layer_value).values(**values)
                counts["layers"] += len(
                    conn.execute(
                        statement.on_conflict_do_nothing(
                            index_elements=["collection", "feature_id", "built_at"]
                        ).returning(db.segment_layer_value.c.id)
                    ).all()
                )
            for item in receipt_items:
                if item.source_id != raw["source_id"]:
                    raise ValueError("feature receipt source must match the raw page")
            for start in range(0, len(receipt_items), 100):
                receipt_values = {}
                for item in receipt_items[start : start + 100]:
                    receipt_values.setdefault(
                        (item.source_id, item.feature_id, item.build_key), item.model_dump()
                    )
                statement = self._insert(db.feature_receipt).values(list(receipt_values.values()))
                conn.execute(
                    statement.on_conflict_do_update(
                        index_elements=["source_id", "feature_id", "build_key"],
                        set_={
                            key: getattr(statement.excluded, key)
                            for key in (
                                "raw_ref",
                                "outcome",
                                "reason",
                                "observed_at",
                                "canonical_count",
                            )
                        },
                        where=(db.feature_receipt.c.outcome == "UNRESOLVED")
                        & (statement.excluded.outcome != "UNRESOLVED"),
                    )
                )
            if watermark:
                if watermark.source_id != raw["source_id"]:
                    raise ValueError("watermark source must match the raw page")
                values = watermark.model_dump()
                statement = self._insert(db.watermark).values(**values)
                conn.execute(
                    statement.on_conflict_do_update(index_elements=["source_id"], set_=values)
                )
            if manifest is not None:
                self._write_manifest(
                    conn, raw, manifest.model_copy(update={"rows_ingested": sum(counts.values())})
                )
        return counts

    def _write_manifest(self, conn, raw, manifest: Manifest):
        if manifest.source_id != raw["source_id"]:
            raise ValueError("manifest source must match raw page")
        values = manifest.model_dump()
        values["sha256"] = raw["sha256"]
        values["raw_ref"] = raw["id"]
        conn.execute(db.manifest.insert().values(**values))

    def record_manifest(self, raw_ref: int, manifest: Manifest) -> None:
        """Failure/metadata-only runs also retain a manifest and their raw bytes."""
        with self.engine.begin() as conn:
            raw = (
                conn.execute(select(db.raw_payload).where(db.raw_payload.c.id == raw_ref))
                .mappings()
                .one()
            )
            self._write_manifest(conn, raw, manifest)

    def flush_outbox(self, bus: Bus, *, limit: int = 100) -> int:
        """Mark delivered after acknowledgement; crashes may redeliver stable IDs."""
        if not 1 <= limit <= 5000:
            raise ValueError("outbox batch limit must be between 1 and 5000")
        delivered = 0
        with self.engine.begin() as conn:
            query = (
                select(db.outbox)
                .where(db.outbox.c.delivered_at.is_(None))
                .order_by(db.outbox.c.created_at, db.outbox.c.event_id)
                .limit(limit)
            )
            if self.engine.dialect.name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            for row in conn.execute(query).mappings():
                bus.publish(Event(row["event_id"], row["topic"], row["payload"]))
                conn.execute(
                    update(db.outbox)
                    .where(db.outbox.c.event_id == row["event_id"])
                    .values(delivered_at=datetime.now(UTC))
                )
                delivered += 1
        return delivered
