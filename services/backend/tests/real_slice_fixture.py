"""Replay dated provider captures. Never treated as present-day observations."""

import hashlib
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from app.ingestion.adapters.osem import OsemAdapter
from app.ingestion.adapters.uba import UbaAdapter
from app.ingestion.adapters.weather import OpenMeteoAdapter
from app.ingestion.contracts import RawPayload
from app.processing.snapshots import process_day, process_sensors
from app.storage.repository import Repository
from app.storage.results import ResultRepository

ROOT = Path(__file__).parent / "fixtures" / "real-slice"
AS_OF = datetime(2026, 10, 28, 23, 1, tzinfo=UTC)
SELECTED = date(2026, 10, 29)


def replay(repository: Repository):
    manifest = json.loads((ROOT / "manifest.json").read_text())
    counts = {}
    for entry in manifest["entries"]:
        body = (ROOT / entry["filename"]).read_bytes()
        assert hashlib.sha256(body).hexdigest() == entry["fixture_sha256"]
        raw = RawPayload.model_validate(
            {
                key: entry[key]
                for key in [
                    "source_id",
                    "url",
                    "method",
                    "request_params",
                    "retrieved_at_utc",
                    "http_status",
                    "response_headers",
                ]
            }
            | {"body": body}
        )
        ref = repository.land_raw(raw)
        source = raw.source_id
        adapter = (
            OsemAdapter()
            if source == "osem"
            else (
                UbaAdapter("226", "5", bbox=repository.bbox, source_id=source)
                if source.startswith("uba")
                else OpenMeteoAdapter(source, bbox=repository.bbox)
            )
        )
        page = adapter.decode(repository.get_raw(ref), ref, repository.get_watermark(source))
        watermark = page.next_watermark.model_copy(update={"last_success_at": raw.retrieved_at_utc})
        counts[source] = repository.ingest_page(
            ref,
            page.observations,
            receipts=page.receipts,
            manifest=page.manifest,
            watermark=watermark,
        )
    results = ResultRepository(repository)
    day = process_day(results, SELECTED, now=AS_OF)
    process_day(results, SELECTED + timedelta(days=1), now=AS_OF)
    process_sensors(results, now=AS_OF)
    return results, day, counts
