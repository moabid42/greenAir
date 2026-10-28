"""Bounded stored-input processing CLI; no upstream or API process is started."""

import argparse
import json
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import create_engine

from app.ingestion.settings import IngestionSettings
from app.processing.snapshots import BERLIN, process_day, process_sensors
from app.storage.repository import Repository
from app.storage.results import ResultRepository


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build versioned results from stored observations")
    parser.add_argument(
        "--date", type=date.fromisoformat, help="one Berlin date; defaults today/tomorrow"
    )
    args = parser.parse_args(argv)
    settings = IngestionSettings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        repository = ResultRepository(Repository(engine, bbox=settings.bbox))
        now = datetime.now(UTC)
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
