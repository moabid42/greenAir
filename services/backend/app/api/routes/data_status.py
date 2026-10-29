"""Public read-only pipeline status, without credentials, raw bodies or client data."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.serving.stored import StoredRepository
from app.storage import models as db

router = APIRouter(tags=["Data pipeline"])


class SourceStatus(BaseModel):
    source_id: str
    status: str
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    latest_observed_at: datetime | None
    rows_downloaded: int


class BuildStatus(BaseModel):
    resource: str
    build_id: str
    status: str
    built_at: datetime


class DataStatus(BaseModel):
    mode: str
    checked_at: datetime
    observations: int | None = None
    roads: int | None = None
    layers: int | None = None
    sources: list[SourceStatus] = []
    builds: list[BuildStatus] = []
    # There is no client upload or request analytics collection service.
    client_uploads: None = None
    total_requests: None = None


@router.get("/api/v1/data-status", response_model=DataStatus, operation_id="GetDataStatus")
def data_status(request: Request, response: Response):
    """Read stored provider counts, durable refresh checkpoints and latest build attempts.

    Client uploads/request totals are unavailable, not estimated. No upstream fetch is made.
    """
    response.headers["Cache-Control"] = "no-store"
    repository = request.app.state.serving_repository
    if not isinstance(repository, StoredRepository):
        return DataStatus(mode="mock", checked_at=datetime.now(UTC))
    try:
        with repository.results.engine.connect() as conn:
            counts = {
                key: conn.scalar(select(func.count()).select_from(table))
                for key, table in (
                    ("observations", db.observations),
                    ("roads", db.segment),
                    ("layers", db.segment_layer_value),
                )
            }
            sources = []
            for mark in conn.execute(select(db.watermark)).mappings():
                latest = (
                    conn.execute(
                        select(db.manifest)
                        .where(db.manifest.c.source_id == mark["source_id"])
                        .order_by(db.manifest.c.id.desc())
                        .limit(1)
                    )
                    .mappings()
                    .first()
                )
                control = mark["state"].get("_scheduler", {})
                sources.append(
                    SourceStatus(
                        source_id=mark["source_id"],
                        status=control.get("last_run_status", "PENDING"),
                        last_attempt_at=control.get("last_attempt_at"),
                        last_success_at=mark["last_success_at"],
                        latest_observed_at=mark["last_ts"],
                        rows_downloaded=latest["rows_downloaded"] if latest else 0,
                    )
                )
            # Latest build for each resource, including unavailable attempts.
            ranked = select(
                db.result_snapshot.c.resource_key,
                db.result_snapshot.c.build_id,
                db.result_snapshot.c.status,
                db.result_snapshot.c.built_at,
                func.row_number()
                .over(
                    partition_by=db.result_snapshot.c.resource_key,
                    order_by=(
                        db.result_snapshot.c.built_at.desc(),
                        db.result_snapshot.c.build_id.desc(),
                    ),
                )
                .label("rank"),
            ).subquery()
            builds = [
                BuildStatus(
                    resource=row.resource_key,
                    build_id=row.build_id,
                    status=row.status,
                    built_at=row.built_at,
                )
                for row in conn.execute(select(ranked).where(ranked.c.rank == 1))
            ]
        return DataStatus(
            mode="stored",
            checked_at=datetime.now(UTC),
            sources=sources,
            builds=builds,
            **counts,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Stored pipeline status is temporarily unavailable.") from exc
