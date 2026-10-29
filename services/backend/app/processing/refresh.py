"""Bounded stored-input processing CLI; no upstream or API process is started."""

import argparse
import json
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import create_engine

from app.ingestion.settings import IngestionSettings
from app.processing.snapshots import BERLIN, process_day, process_sensors
from app.processing.stored_spatial import process_spatial
from app.storage.repository import Repository
from app.storage.results import ResultRepository


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build versioned results from stored observations")
    parser.add_argument(
        "--date", type=date.fromisoformat, help="one Berlin date; defaults today/tomorrow"
    )
    parser.add_argument(
        "--spatial", action="store_true", help="build spatial results instead of days"
    )
    parser.add_argument("--reference-days", type=int, default=7)
    parser.add_argument("--as-of", type=datetime.fromisoformat, help="explicit aware UTC cutoff")
    args = parser.parse_args(argv)
    if not 1 <= args.reference_days <= 31:
        parser.error("reference-days must be between 1 and 31")
    if args.as_of is not None and args.as_of.tzinfo is None:
        parser.error("as-of requires an explicit timezone")
    settings = IngestionSettings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        repository = ResultRepository(Repository(engine, bbox=settings.bbox))
        now = args.as_of.astimezone(UTC) if args.as_of else datetime.now(UTC)
        if args.spatial:
            snapshot = process_spatial(
                repository, since=now - timedelta(days=args.reference_days), now=now
            )
            print(json.dumps(snapshot.model_dump(mode="json", exclude={"payload"})))
            return 2 if snapshot.status == "UNAVAILABLE" else 0
        today = now.astimezone(BERLIN).date()
        dates = [args.date] if args.date else [today, today + timedelta(days=1)]
        snapshots = [process_day(repository, day, now=now) for day in dates]
        snapshots.append(process_sensors(repository, now=now))
        for snapshot in snapshots:
            print(json.dumps(snapshot.model_dump(mode="json", exclude={"payload"})))
        return 2 if any(s.status == "UNAVAILABLE" for s in snapshots) else 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
