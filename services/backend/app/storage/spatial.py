"""Read count-consistent ATRAI captures, never a partly downloaded new build.

The provider offers no atomic snapshot/cursor or ordering. Consecutive offsets,
unchanged totals and distinct feature receipts establish capture accounting only;
they cannot establish that the upstream table was immutable during retrieval.
"""

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select

from app.ingestion.contracts import LayerRecord
from app.storage import models as db
from app.storage.repository import Repository


@dataclass(frozen=True)
class Capture:
    collection: str
    captured_at: datetime
    retrieved_at: datetime
    reported_total: int
    filtered: int
    layers: list[LayerRecord]
    raw_refs: list[int]


class SpatialRepository:
    def __init__(self, repository: Repository):
        self.repository, self.engine = repository, repository.engine

    def latest_capture(
        self, collection: str, *, max_rows=60_000, retrieved_before: datetime | None = None
    ) -> Capture | None:
        source = f"atrai_{collection}"
        with self.engine.connect() as conn:
            # Bounded candidate history. Skip interrupted/inconsistent captures;
            # retain last success rather than combining two upstream builds.
            terminal = (
                conn.execute(
                    select(db.manifest.c.details)
                    .where(
                        db.manifest.c.source_id == source,
                        db.manifest.c.retrieved_at_utc <= retrieved_before
                        if retrieved_before is not None
                        else True,
                    )
                    .order_by(db.manifest.c.id.desc())
                    .limit(2000)
                )
                .scalars()
                .all()
            )
            keys = list(
                dict.fromkeys(
                    d["build_key"] for d in terminal if d.get("terminal") and d.get("build_key")
                )
            )[:20]
            for key in keys:
                manifests = (
                    conn.execute(
                        select(db.manifest)
                        .where(
                            db.manifest.c.source_id == source,
                            db.manifest.c.details["build_key"].as_string() == key,
                        )
                        .order_by(db.manifest.c.id)
                        .limit(1001)
                    )
                    .mappings()
                    .all()
                )
                # A committed page may be replayed after a crash. Its offset,
                # raw bytes and outcomes must be identical to count it once.
                by_offset = {}
                invalid = len(manifests) > 1000 or (
                    retrieved_before is not None
                    and any(r["retrieved_at_utc"] > retrieved_before for r in manifests)
                )
                for row in manifests:
                    offset = row["details"].get("offset")
                    if offset in by_offset and row["sha256"] != by_offset[offset]["sha256"]:
                        invalid = True
                    by_offset[offset] = row
                pages = sorted(by_offset.values(), key=lambda r: r["details"].get("offset", -1))
                offset, total = 0, None
                for row in pages:
                    if row["status"] != "SUCCESS" or row["details"].get("offset") != offset:
                        invalid = True
                    if total is not None and total != row["number_matched_reported"]:
                        invalid = True
                    total = row["number_matched_reported"]
                    offset += row["rows_downloaded"]
                if invalid or total is None or total > max_rows or offset != total:
                    continue
                receipts = conn.execute(
                    select(db.feature_receipt.c.outcome, func.count())
                    .where(
                        db.feature_receipt.c.source_id == source,
                        db.feature_receipt.c.build_key == key,
                    )
                    .group_by(db.feature_receipt.c.outcome)
                ).all()
                counts = dict(receipts)
                if sum(counts.values()) != total or counts.get("UNRESOLVED", 0):
                    continue
                geometry = (
                    func.ST_AsGeoJSON(db.segment_layer_value.c.geom)
                    if self.engine.dialect.name == "postgresql"
                    else db.segment_layer_value.c.geom
                ).label("geom")
                columns = [c for c in db.segment_layer_value.c if c.name not in {"geom", "id"}]
                rows = (
                    conn.execute(
                        select(*columns, geometry)
                        .where(
                            db.segment_layer_value.c.collection == collection,
                            db.segment_layer_value.c.built_at == datetime.fromisoformat(key),
                        )
                        .order_by(db.segment_layer_value.c.feature_id)
                        .limit(max_rows + 1)
                    )
                    .mappings()
                    .all()
                )
                if len(rows) != counts.get("INGESTED", 0):
                    continue
                layers = []
                for row in rows:
                    data = dict(row)
                    if isinstance(data["geom"], str):
                        data["geom"] = json.loads(data["geom"])
                    layers.append(LayerRecord.model_validate(data))
                return Capture(
                    collection,
                    datetime.fromisoformat(key),
                    max(r["retrieved_at_utc"] for r in pages),
                    total,
                    counts.get("FILTERED", 0),
                    layers,
                    sorted({r["raw_ref"] for r in pages}),
                )
        return None
