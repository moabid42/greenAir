"""Explicit, restartable source polling; never imported by FastAPI startup."""

import hashlib
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any

from sqlalchemy import Engine, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.ingestion.contracts import Adapter, Manifest, RawPayload, Watermark
from app.ingestion.http import LandingHTTPClient
from app.schemas.observation import utc
from app.storage import models as db
from app.storage.repository import Repository


@dataclass(frozen=True)
class RequestSpec:
    url: str
    method: str = "GET"
    params: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes | None = None


@dataclass(frozen=True)
class Job:
    source_id: str
    cadence: timedelta | None
    adapter: Adapter
    request: Callable[[Watermark, datetime, datetime], RequestSpec]

    lookback: timedelta | None = None

    def __post_init__(self):
        if not self.source_id or self.adapter.source_id != self.source_id:
            raise ValueError("job and adapter source identities must match")
        if self.lookback is not None and self.lookback <= timedelta(0):
            raise ValueError("lookback must be positive")
        if self.cadence is not None and self.cadence <= timedelta(0):
            raise ValueError("cadence must be positive; None means manual only")


@dataclass
class RunResult:
    source_id: str
    status: str
    pages: int = 0
    counts: dict[str, int] = field(default_factory=dict)
    error: str | None = None


_test_locks: dict[tuple[str, str], threading.Lock] = {}
_test_locks_guard = threading.Lock()


@contextmanager
def source_lock(engine: Engine, source_id: str) -> Iterator[bool]:
    """Session lock spans fetch and every checkpoint, including manual runs.

    SQLite provides only a process-local test substitute. The worker requires
    PostgreSQL; PostgreSQL releases its advisory lock when a killed worker's
    connection closes. This uses a stable signed 64-bit key across processes.
    """
    if engine.dialect.name == "sqlite":
        with _test_locks_guard:
            lock = _test_locks.setdefault((str(engine.url), source_id), threading.Lock())
        acquired = lock.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()
        return
    key = int.from_bytes(hashlib.sha256(source_id.encode()).digest()[:8], "big", signed=True)
    with engine.connect() as conn:
        acquired = conn.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": key})
        conn.commit()
        try:
            yield bool(acquired)
        finally:
            if acquired:
                conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
                conn.commit()


class Scheduler:
    def __init__(
        self,
        repository: Repository,
        http: LandingHTTPClient,
        jobs: list[Job],
        *,
        campaign_start: datetime,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        max_pages: int = 100,
    ):
        if not 1 <= max_pages <= 100_000:
            raise ValueError("max_pages must be between 1 and 100000")
        if len({job.source_id for job in jobs}) != len(jobs):
            raise ValueError("job source identities must be unique")
        self.repository, self.http, self.jobs = repository, http, jobs
        self.campaign_start, self.clock = utc(campaign_start), clock
        self.max_pages = max_pages

    def _save_control_state(self, watermark: Watermark) -> None:
        """Persist windows/retry times without moving any data checkpoint."""
        values = watermark.model_dump()
        insert = pg_insert if self.repository.engine.dialect.name == "postgresql" else sqlite_insert
        statement = insert(db.watermark).values(**values)
        with self.repository.engine.begin() as conn:
            conn.execute(statement.on_conflict_do_update(index_elements=["source_id"], set_=values))

    def _prepare(self, job: Job, current: Watermark, now: datetime, backfill: bool):
        control = dict(current.state.get("_scheduler", {}))
        retry_after = control.get("retry_after_at")
        if retry_after and now < utc(datetime.fromisoformat(retry_after)):
            return None
        next_due = control.get("next_due_at")
        if next_due is None and current.last_success_at is not None and job.cadence is not None:
            next_due = (current.last_success_at + job.cadence).isoformat()
        if not backfill and (
            (job.cadence is None and not control.get("in_progress"))
            or (next_due is not None and now < utc(datetime.fromisoformat(next_due)))
        ):
            return None
        if control.get("in_progress"):
            return current
        gap = current.last_success_at is None or (
            job.cadence is not None and now - current.last_success_at > 2 * job.cadence
        )
        mode = "backfill" if backfill or gap else "incremental"
        start = (
            self.campaign_start
            if backfill
            else (now - job.lookback if job.lookback else current.last_ts or self.campaign_start)
        )
        control = {
            "window_start": start.isoformat(),
            "window_end": now.isoformat(),
            "mode": mode,
            "in_progress": True,
            "partial": False,
            "next_due_at": now.isoformat(),
        }
        # Adapters clear their exhausted cursors when more=False. Explicit full
        # backfill clears adapter state and conditional-fetch metadata as well.
        state = {} if backfill else dict(current.state)
        state.update(more=False, _scheduler=control)
        prepared = current.model_copy(
            update={
                "last_offset": 0,
                "last_modified": None if backfill else current.last_modified,
                "state": state,
            }
        )
        self._save_control_state(prepared)
        return prepared

    @staticmethod
    def _manifest(raw: RawPayload, **changes) -> Manifest:
        return Manifest(
            source_id=raw.source_id,
            url=raw.url,
            retrieved_at_utc=raw.retrieved_at_utc,
            http_status=raw.http_status,
            content_type=raw.response_headers.get("content-type"),
            **changes,
        )

    def _failed(self, job, current, raw_ref, raw, error, pages, counts, status=None):
        status = status or (
            "RESTRICTED"
            if raw.http_status in {401, 403}
            else "UNREACHABLE"
            if raw.error or raw.http_status is None or raw.http_status >= 400
            else "PARTIAL"
        )
        self.repository.record_manifest(
            raw_ref, self._manifest(raw, status=status, details={"error": str(error)})
        )
        control = dict(current.state["_scheduler"])
        control.update(last_run_status=status, last_attempt_at=utc(self.clock()).isoformat())
        control["next_due_at"] = (
            utc(self.clock()) + (job.cadence or timedelta(minutes=5))
        ).isoformat()
        retry_after = raw.response_headers.get("retry-after")
        if retry_after:
            try:
                try:
                    advertised = utc(self.clock()) + timedelta(seconds=float(retry_after))
                except ValueError:
                    advertised = utc(parsedate_to_datetime(retry_after))
                due = datetime.fromisoformat(control["next_due_at"])
                control["retry_after_at"] = max(due, advertised).isoformat()
                control["next_due_at"] = control["retry_after_at"]
            except (TypeError, ValueError, OverflowError):
                pass
        # Keep exactly the last committed offset, timestamp and adapter state.
        self._save_control_state(
            current.model_copy(update={"state": current.state | {"_scheduler": control}})
        )
        return RunResult(job.source_id, status, pages, counts, str(error))

    def run_job(self, job: Job, *, backfill: bool = False) -> RunResult:
        with source_lock(self.repository.engine, job.source_id) as acquired:
            if not acquired:
                return RunResult(job.source_id, "LOCKED")
            current = self._prepare(
                job, self.repository.get_watermark(job.source_id), utc(self.clock()), backfill
            )
            if current is None:
                return RunResult(job.source_id, "NOT_DUE")
            counts = {"observations": 0, "layers": 0, "segments": 0}
            partial = bool(current.state["_scheduler"].get("partial", False))
            for index in range(self.max_pages):
                control = dict(current.state["_scheduler"])
                request = job.request(
                    current,
                    datetime.fromisoformat(control["window_start"]),
                    datetime.fromisoformat(control["window_end"]),
                )
                response = self.http.fetch(
                    job.source_id,
                    request.url,
                    method=request.method,
                    params=request.params,
                    headers=request.headers,
                    body=request.body,
                )
                raw_ref = response.raw_ref
                # Decode the committed copy, ensuring a replay takes the same path.
                raw = self.repository.get_raw(raw_ref)
                try:
                    if (
                        raw.error
                        or raw.http_status is None
                        or not (200 <= raw.http_status < 300 or raw.http_status == 304)
                    ):
                        raise ValueError(raw.error or f"HTTP {raw.http_status}")
                    page = job.adapter.decode(raw, raw_ref, current)
                    if page.manifest is None:
                        raise ValueError(
                            "adapter must supply a manifest with downloaded-row counts"
                        )
                    if page.manifest.source_id != job.source_id:
                        raise ValueError("manifest and job source identities must match")
                    if page.manifest.status in {"UNREACHABLE", "RESTRICTED"}:
                        return self._failed(
                            job,
                            current,
                            raw_ref,
                            raw,
                            "adapter reported unavailable data",
                            index,
                            counts,
                            status=page.manifest.status,
                        )
                    if any(item.source != job.source_id for item in page.observations):
                        raise ValueError("observation and job source identities must match")
                    if page.next_watermark is None:
                        raise ValueError(
                            "adapter must supply a checkpoint after successful decoding"
                        )
                    next_watermark = page.next_watermark
                    if next_watermark.source_id != job.source_id:
                        raise ValueError("watermark and job source identities must match")
                    more = next_watermark.state.get("more", False)
                    if not isinstance(more, bool):
                        raise ValueError("watermark state.more must be a boolean")
                    if more and (
                        next_watermark.last_offset == current.last_offset
                        and next_watermark.state == current.state
                    ):
                        raise ValueError("pagination must advance its offset or adapter cursor")
                    now = utc(self.clock())
                    control.update(
                        last_run_status="PARTIAL"
                        if partial or page.manifest.status != "SUCCESS"
                        else "SUCCESS",
                        last_attempt_at=now.isoformat(),
                        in_progress=more,
                        partial=partial or page.manifest.status != "SUCCESS",
                        next_due_at=(
                            now + (job.cadence or timedelta(0)) if not more else now
                        ).isoformat(),
                    )
                    last_ts = max(
                        (ts for ts in (current.last_ts, next_watermark.last_ts) if ts is not None),
                        default=None,
                    )
                    checkpoint = next_watermark.model_copy(
                        update={
                            "last_ts": last_ts,
                            "last_success_at": now,
                            "last_modified": raw.response_headers.get(
                                "last-modified", next_watermark.last_modified
                            ),
                            "state": next_watermark.state | {"more": more, "_scheduler": control},
                        }
                    )
                    manifest = self._manifest(
                        raw,
                        **page.manifest.model_dump(
                            exclude={
                                "source_id",
                                "url",
                                "retrieved_at_utc",
                                "http_status",
                                "content_type",
                            }
                        ),
                    )
                    kwargs = {"receipts": page.receipts} if hasattr(page, "receipts") else {}
                    inserted = self.repository.ingest_page(
                        raw_ref,
                        page.observations,
                        layers=page.layers,
                        segments=page.segments,
                        watermark=checkpoint,
                        manifest=manifest,
                        **kwargs,
                    )
                except Exception as exc:
                    return self._failed(job, current, raw_ref, raw, exc, index, counts)
                for key in counts:
                    counts[key] += inserted[key]
                partial = partial or manifest.status != "SUCCESS"
                current = checkpoint
                if not more:
                    return RunResult(
                        job.source_id, "PARTIAL" if partial else "SUCCESS", index + 1, counts
                    )
            self.repository.record_manifest(
                raw_ref,
                self._manifest(
                    raw,
                    status="PARTIAL",
                    details={"reason": "page budget reached; persisted window will resume"},
                ),
            )
            return RunResult(
                job.source_id, "PARTIAL", self.max_pages, counts, "page budget reached"
            )

    def run_once(self, *, backfill: bool = False, source: str | None = None) -> list[RunResult]:
        jobs = [job for job in self.jobs if source is None or job.source_id == source]
        if source is not None and not jobs:
            raise ValueError(f"unknown source: {source}")
        results = []
        for job in jobs:
            try:
                results.append(self.run_job(job, backfill=backfill))
            except Exception as exc:
                # A request builder/configuration failure has no raw response to
                # manifest. Report it explicitly and continue independent jobs.
                results.append(RunResult(job.source_id, "PARTIAL", error=str(exc)))
        return results
