"""One explicit ingestion + processing pass, including partial upstream results."""

import argparse
from datetime import date

from app.ingestion import worker
from app.processing import refresh as processing


def main(argv=None):
    parser = argparse.ArgumentParser(description="Refresh stored inputs and result snapshots once")
    parser.add_argument("--date", type=date.fromisoformat)
    parser.add_argument("--source")
    parser.add_argument("--max-pages", type=int, default=4)
    args = parser.parse_args(argv)
    worker_args = ["--once", "--max-pages", str(args.max_pages)]
    if args.source:
        worker_args += ["--source", args.source]
    ingestion_status = worker.main(worker_args)
    processing_status = processing.main(["--date", args.date.isoformat()] if args.date else [])
    return max(ingestion_status, processing_status)


if __name__ == "__main__":
    raise SystemExit(main())
