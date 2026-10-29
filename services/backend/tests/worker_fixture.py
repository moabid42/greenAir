"""Explicitly synthetic paginated source for worker process recovery tests."""

import json
import os
from datetime import UTC, datetime, timedelta

from app.ingestion.contracts import Manifest, PageResult, Watermark
from app.ingestion.scheduler import Job, RequestSpec
from app.schemas.observation import Observation

START = datetime(2026, 10, 20, tzinfo=UTC)


class SyntheticAdapter:
    def __init__(self, source_id="scheduler_synthetic"):
        self.source_id = source_id

    def decode(self, raw, raw_ref, watermark):
        payload = json.loads(raw.body)
        index, total = payload["index"], payload.get("total", 3)
        observed = START + timedelta(minutes=index)
        return PageResult(
            observations=[
                Observation(
                    source=self.source_id,
                    station_id="synthetic-station",
                    geom={"type": "Point", "coordinates": [9.2109, 49.1427]},
                    phenomenon="temp",
                    value=float(index),
                    unit="°C",
                    ts_utc=observed,
                    raw_ref=raw_ref,
                )
            ],
            next_watermark=Watermark(
                source_id=self.source_id,
                last_offset=index + 1,
                last_ts=observed,
                state=watermark.state | {"more": index + 1 < total},
            ),
            manifest=Manifest(
                source_id=self.source_id,
                url=raw.url,
                retrieved_at_utc=raw.retrieved_at_utc,
                http_status=raw.http_status,
                content_type="application/json",
                number_matched_reported=total,
                rows_downloaded=1,
                earliest_observed_at=observed,
                latest_observed_at=observed,
                status="SUCCESS",
                details={"synthetic": True},
            ),
        )


def get_jobs(settings):
    source = os.environ["GREENAIR_FIXTURE_SOURCE"]
    url = os.environ["GREENAIR_FIXTURE_URL"]

    def request(watermark, start, end):
        return RequestSpec(
            url=url,
            params={
                "offset": watermark.last_offset,
                "window_start": start.isoformat(),
                "window_end": end.isoformat(),
            },
        )

    return [Job(source, timedelta(minutes=5), SyntheticAdapter(source), request)]
