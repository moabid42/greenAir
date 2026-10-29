"""Selected real ATRAI features. Counts rewritten ONLY for this tiny replay fixture."""

import json
from datetime import UTC, datetime
from pathlib import Path

from app.ingestion.adapters.atrai_segments import AtraiSegmentAdapter
from app.ingestion.contracts import RawPayload, Watermark

AS_OF = datetime(2026, 10, 29, 8, tzinfo=UTC)


def replay_layers(repository, *, at=AS_OF):
    fixture = json.loads((Path(__file__).parent / "fixtures/atrai-selected.json").read_text())
    counts = {}
    for collection, selected in fixture["captures"].items():
        source = f"atrai_{collection}"
        payload = {
            "type": "FeatureCollection",
            "offset": 0,
            "limit": 1000,
            "numberMatched": len(selected),
            "numberReturned": len(selected),
            "features": [item["feature"] for item in selected],
        }
        raw = RawPayload(
            source_id=source,
            url=selected[0]["url"],
            request_params={"offset": 0, "limit": 1000},
            retrieved_at_utc=at,
            http_status=200,
            response_headers={"content-type": "application/json"},
            body=json.dumps(payload, ensure_ascii=False).encode(),
        )
        ref = repository.land_raw(raw)
        page = AtraiSegmentAdapter(source, collection, bbox=repository.bbox).decode(
            raw,
            ref,
            Watermark(source_id=source),
        )
        counts[collection] = repository.ingest_page(
            ref,
            layers=page.layers,
            segments=page.segments,
            receipts=page.receipts,
            manifest=page.manifest,
            watermark=page.next_watermark,
        )
    return counts
