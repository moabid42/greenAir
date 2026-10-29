"""Compose's real-data refresher; API startup remains independent and read-only."""

import argparse
import json
import signal
import threading
import time
from dataclasses import asdict
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import create_engine

from app.ingestion.http import LandingHTTPClient
from app.ingestion.registry import get_jobs, get_spatial_jobs
from app.ingestion.scheduler import Scheduler
from app.ingestion.settings import IngestionSettings
from app.processing import refresh as processing
from app.storage.repository import Repository


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=float, default=60)
    parser.add_argument("--max-cycles", type=int)
    args = parser.parse_args(argv)
    if not 1 <= args.interval <= 3600 or (args.max_cycles is not None and args.max_cycles < 1):
        parser.error("interval must be 1..3600 seconds; max-cycles must be positive")
    stop = threading.Event()
    previous = {}
    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.signal(signum, lambda *_: stop.set())
    settings = IngestionSettings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    repository = Repository(engine, bbox=settings.bbox)
    cycles = 0
    next_spatial = 0.0
    try:
        with httpx.Client() as client:
            http = LandingHTTPClient(
                client,
                repository,
                timeout=settings.request_timeout_seconds,
                max_attempts=settings.max_attempts,
                max_bytes=settings.max_response_bytes,
            )
            normal = Scheduler(
                repository,
                http,
                get_jobs(settings),
                campaign_start=settings.campaign_start,
                max_pages=4,
            )
            spatial = Scheduler(
                repository,
                http,
                get_spatial_jobs(settings),
                campaign_start=settings.campaign_start,
                max_pages=4,
            )
            while not stop.is_set():
                try:
                    for result in normal.run_once():
                        print(json.dumps(asdict(result)), flush=True)
                    processing.main([])
                    # Bounded city-only bootstrap, then weekly recapture. This is an
                    # application refresh policy, not a claim about survey cadence.
                    spatial_changed = False
                    for job in spatial.jobs:
                        if stop.is_set():
                            break
                        mark = repository.get_watermark(job.source_id)
                        control = mark.state.get("_scheduler", {})
                        last = mark.last_success_at
                        due = control.get("next_due_at")
                        if due and datetime.now(UTC) < datetime.fromisoformat(due):
                            continue
                        if control.get("in_progress"):
                            result = spatial.run_job(job)
                        elif last is None or datetime.now(UTC) - last >= timedelta(days=7):
                            result = spatial.run_job(job, backfill=True)
                        else:
                            continue
                        print(json.dumps(asdict(result)), flush=True)
                        spatial_changed |= any(result.counts.values())
                    # Full road artifacts are large. Rebuild at most hourly unless
                    # newly captured street pages change the spatial inputs.
                    if spatial_changed or time.monotonic() >= next_spatial:
                        processing.main(["--spatial", "--reference-days", "14"])
                        next_spatial = time.monotonic() + 3600
                except Exception as exc:
                    # Keep last-success snapshots; failures are visible in logs and
                    # source checkpoints. Never replace them with demo inputs.
                    print(json.dumps({"refresh_error": str(exc)}), flush=True)
                cycles += 1
                if args.max_cycles is not None and cycles >= args.max_cycles:
                    break
                stop.wait(args.interval)
    finally:
        engine.dispose()
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
