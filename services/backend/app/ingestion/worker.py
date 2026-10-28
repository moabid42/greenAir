"""Separate ingestion CLI: python -m app.ingestion.worker --once."""

import argparse
import importlib
import json
import signal
import threading
from dataclasses import asdict

import httpx
from sqlalchemy import create_engine

from app.ingestion.http import LandingHTTPClient
from app.ingestion.scheduler import Job, Scheduler
from app.ingestion.settings import IngestionSettings
from app.messaging.bus import MemoryBus
from app.storage.repository import Repository


def load_jobs(spec: str, settings: IngestionSettings) -> list[Job]:
    module, separator, name = spec.partition(":")
    if not separator or not module or not name:
        raise ValueError("registry must be module:function")
    factory = getattr(importlib.import_module(module), name)
    jobs = list(factory(settings))
    if not all(isinstance(job, Job) for job in jobs):
        raise ValueError("registry must return Job instances")
    return jobs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run durable source ingestion independently of API"
    )
    parser.add_argument("--once", action="store_true", help="one bounded scheduling pass")
    parser.add_argument("--backfill", action="store_true", help="one bounded manual backfill pass")
    parser.add_argument("--source", help="run only this registered source")
    parser.add_argument("--registry", default="app.ingestion.registry:get_jobs")
    parser.add_argument("--max-pages", type=int, default=4)
    parser.add_argument("--poll-seconds", type=float, default=10)
    parser.add_argument("--max-cycles", type=int, help="optional bound on daemon passes")
    parser.add_argument(
        "--outbox-batches", type=int, default=100, help="at most 100 events per batch"
    )
    parser.add_argument("--bus", choices=("none", "memory"), default="none")
    args = parser.parse_args(argv)
    if (
        not 0 < args.poll_seconds <= 60
        or (args.max_cycles is not None and args.max_cycles < 1)
        or not 1 <= args.outbox_batches <= 1000
    ):
        parser.error(
            "poll-seconds must be in (0,60]; max-cycles positive; outbox-batches in [1,1000]"
        )
    settings = IngestionSettings()
    jobs = load_jobs(args.registry, settings)
    if args.source is not None and args.source not in {job.source_id for job in jobs}:
        parser.error(f"unknown source: {args.source}")
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    if engine.dialect.name != "postgresql":
        parser.error("the worker requires PostgreSQL for cross-process source locking")
    repository = Repository(engine, bbox=settings.bbox)
    bus = MemoryBus() if args.bus == "memory" else None
    stop = threading.Event()
    previous_handlers = {}
    for signum in (signal.SIGTERM, signal.SIGINT):
        previous_handlers[signum] = signal.signal(signum, lambda *_: stop.set())
    exit_code, cycles = 0, 0
    try:
        with httpx.Client() as client:
            http = LandingHTTPClient(
                client,
                repository,
                timeout=settings.request_timeout_seconds,
                max_attempts=settings.max_attempts,
                max_bytes=settings.max_response_bytes,
            )
            scheduler = Scheduler(
                repository,
                http,
                jobs,
                campaign_start=settings.campaign_start,
                max_pages=args.max_pages,
            )
            while not stop.is_set():
                results = scheduler.run_once(backfill=args.backfill, source=args.source)
                for result in results:
                    print(json.dumps(asdict(result), allow_nan=False), flush=True)
                    if result.status not in {"SUCCESS", "NOT_DUE", "LOCKED"}:
                        exit_code = 2
                try:
                    for _ in range(args.outbox_batches if bus is not None else 0):
                        if repository.flush_outbox(bus) < 100:
                            break
                except Exception as exc:
                    print(json.dumps({"outbox_error": str(exc)}), flush=True)
                    exit_code = 2
                cycles += 1
                if args.once or args.backfill or (args.max_cycles and cycles >= args.max_cycles):
                    break
                stop.wait(args.poll_seconds)
    finally:
        engine.dispose()
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
