"""Bounded canonical reads and idempotent immutable result persistence."""

import json
from datetime import datetime
from typing import Literal

from sqlalchemy import func, select

from app.schemas.observation import Observation, utc
from app.schemas.snapshots import VERSION, ResultSnapshot
from app.storage import models as db
from app.storage.repository import Repository


class ResultRepository:
    def __init__(self, repository: Repository):
        self.repository = repository
        self.engine = repository.engine

    def observations(
        self,
        *,
        until: datetime,
        retrieved_before: datetime,
        since: datetime | None = None,
        measurements_only: bool = False,
        kind: Literal["observation"] | None = None,
        max_rows: int = 50_000,
    ) -> list[tuple[Observation, datetime]]:
        if not 1 <= max_rows <= 100_000:
            raise ValueError("max_rows must be between 1 and 100000")
        columns = [c for c in db.observations.c if c.name != "geom"]
        geometry = (
            func.ST_AsGeoJSON(db.observations.c.geom)
            if self.engine.dialect.name == "postgresql"
            else db.observations.c.geom
        ).label("geom")
        query = (
            select(*columns, geometry, db.raw_payload.c.retrieved_at_utc)
            .join(db.raw_payload, db.raw_payload.c.id == db.observations.c.raw_ref)
            .where(
                db.observations.c.ts_utc < utc(until),
                db.raw_payload.c.retrieved_at_utc <= utc(retrieved_before),
            )
        )
        if since is not None:
            query = query.where(db.observations.c.ts_utc >= utc(since))
        if kind is not None:
            query = query.where(db.observations.c.kind == kind)
        if measurements_only:
            query = query.where(db.observations.c.kind == "observation")
            # Latest per sensor/phenomenon, not an unbounded history transfer.
            ranked = query.add_columns(
                func.row_number()
                .over(
                    partition_by=[
                        db.observations.c.source,
                        db.observations.c.station_id,
                        db.observations.c.phenomenon,
                        db.observations.c.provenance["sensor_id"].as_string(),
                    ],
                    order_by=[
                        db.observations.c.ts_utc.desc(),
                        db.raw_payload.c.retrieved_at_utc.desc(),
                    ],
                )
                .label("rank")
            ).subquery()
            query = select(ranked).where(ranked.c.rank == 1)
        query = query.limit(max_rows + 1)
        with self.engine.connect() as conn:
            rows = conn.execute(query).mappings().all()
        if len(rows) > max_rows:
            raise ValueError("observation read budget exceeded; narrow the time window")
        results = []
        for row in rows:
            data = {key: row[key] for key in Observation.model_fields}
            if isinstance(data["geom"], str):
                data["geom"] = json.loads(data["geom"])
            results.append((Observation.model_validate(data), row["retrieved_at_utc"]))
        return results

    def save(self, snapshot: ResultSnapshot) -> ResultSnapshot:
        with self.engine.begin() as conn:
            conn.execute(
                self.repository._insert(db.result_snapshot)
                .values(**snapshot.model_dump())
                .on_conflict_do_nothing()
            )
            row = (
                conn.execute(
                    select(db.result_snapshot).where(
                        db.result_snapshot.c.build_id == snapshot.build_id
                    )
                )
                .mappings()
                .one()
            )
        return ResultSnapshot.model_validate(dict(row))

    def latest(
        self, resource_key: str, *, include_unavailable: bool = False, version: str = VERSION
    ) -> ResultSnapshot | None:
        query = select(db.result_snapshot).where(
            db.result_snapshot.c.resource_key == resource_key,
            db.result_snapshot.c.schema_version == version,
        )
        if not include_unavailable:
            query = query.where(db.result_snapshot.c.status != "UNAVAILABLE")
        with self.engine.connect() as conn:
            row = (
                conn.execute(
                    query.order_by(
                        db.result_snapshot.c.built_at.desc(), db.result_snapshot.c.build_id.desc()
                    ).limit(1)
                )
                .mappings()
                .one_or_none()
            )
        return ResultSnapshot.model_validate(dict(row)) if row else None
