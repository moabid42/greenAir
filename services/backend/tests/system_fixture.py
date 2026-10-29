"""Local HTTP replay for the system e2e runner; never a live-provider check.

Real bodies retain their fixture hashes and observation times. Landing times refer
only to this test replay. Static envelopes contain selected real features, with
rewritten totals explicitly modelling a tiny complete test collection. Bright Sky
is a synthetic station record. No fixture values represent current observations.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
from dataclasses import replace
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import create_engine, func, select

from app.ingestion.registry import get_jobs as production_jobs
from app.ingestion.registry import get_spatial_jobs as production_spatial_jobs
from app.ingestion.scheduler import RequestSpec
from app.ingestion.settings import IngestionSettings
from app.storage import models as db
from app.storage.repository import Repository
from app.storage.results import ResultRepository

ROOT = Path(__file__).parent
SOURCES = {"openmeteo_fcst", "openmeteo_aq", "osem", "uba_226_5", "brightsky"}
SELECTED = "2026-10-29"


def get_jobs(settings):
    base = os.environ["GREENAIR_E2E_FIXTURE_URL"]
    jobs = [j for j in production_jobs(settings) if j.source_id in SOURCES]
    for job in jobs + production_spatial_jobs(settings):

        def request(watermark, start, end, *, job=job):
            spec = job.request(watermark, start, end)
            return RequestSpec(f"{base}/{job.source_id}", params=spec.params)

        yield replace(job, request=request)


def get_spatial_jobs(settings):
    return [j for j in get_jobs(settings) if j.source_id.startswith("atrai_")]


def payloads():
    manifest = json.loads((ROOT / "fixtures/real-slice/manifest.json").read_text())
    bodies = {}
    for entry in manifest["entries"]:
        body = (ROOT / "fixtures/real-slice" / entry["filename"]).read_bytes()
        assert hashlib.sha256(body).hexdigest() == entry["fixture_sha256"]
        bodies[entry["source_id"]] = body
    bodies["brightsky"] = json.dumps(
        {
            "sources": [
                {
                    "id": 1,
                    "dwd_station_id": "15547",
                    "observation_type": "current",
                    "lon": 9.1428,
                    "lat": 49.1259,
                }
            ],
            "weather": [
                {
                    "source_id": 1,
                    "timestamp": "2026-10-28T23:00:00+00:00",
                    "temperature": 15,
                    "relative_humidity": 60,
                    "wind_speed_60": 3.6,
                }
            ],
        }
    ).encode()
    layers = json.loads((ROOT / "fixtures/atrai-selected.json").read_text())["captures"]
    return bodies, layers


def seed(phase):
    settings = IngestionSettings()
    engine = create_engine(settings.database_url)
    repository = Repository(engine)
    results = ResultRepository(repository)
    bodies, layers = payloads()
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlsplit(self.path)
            source, params = parsed.path.lstrip("/"), parse_qs(parsed.query)
            requests.append({"source": source, "params": params})
            if phase == "failure":
                status, body = 503, b'{"error":"explicit fixture upstream failure"}'
            elif source in bodies:
                status, body = 200, bodies[source]
            elif source.removeprefix("atrai_") in layers:
                selected = layers[source.removeprefix("atrai_")]
                offset, limit = int(params["offset"][0]), int(params["limit"][0])
                features = [x["feature"] for x in selected[offset : offset + limit]]
                status, body = (
                    200,
                    json.dumps(
                        {
                            "type": "FeatureCollection",
                            "features": features,
                            "offset": offset,
                            "limit": limit,
                            "numberMatched": len(selected),
                            "numberReturned": len(features),
                        }
                    ).encode(),
                )
            else:
                status, body = 404, b"{}"
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = os.environ | {
        "GREENAIR_E2E_FIXTURE_URL": f"http://127.0.0.1:{server.server_port}",
        "GREENAIR_PAGE_SIZE": "1",
        "GREENAIR_MAX_ATTEMPTS": "1",
        "GREENAIR_REQUEST_TIMEOUT_SECONDS": "3",
        "PYTHONPATH": os.pathsep.join([str(ROOT.parent), str(ROOT)]),
    }

    def worker(*args, expected=(0,), registry="get_jobs"):
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "app.ingestion.worker",
                "--once",
                "--registry",
                f"system_fixture:{registry}",
                *args,
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
        )
        assert completed.returncode in expected, completed.stdout + completed.stderr
        rows = [json.loads(line) for line in completed.stdout.splitlines()]
        assert rows and all("source_id" in row for row in rows), completed.stdout
        return rows

    def process(*args):
        subprocess.run(
            [sys.executable, "-m", "app.processing.refresh", *args],
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )

    def count(table):
        with engine.connect() as conn:
            return conn.scalar(select(func.count()).select_from(table))

    try:
        if phase == "conditions":
            assert count(db.raw_payload) == count(db.result_snapshot) == 0, (
                "requires an empty e2e DB"
            )
            runs = worker(expected=(0, 2))
            active = [r for r in runs if r["status"] != "NOT_DUE"]
            assert {r["source_id"] for r in active} == SOURCES
            assert all(r["status"] in {"SUCCESS", "PARTIAL"} for r in active)
            assert all(r["counts"]["observations"] > 0 for r in active), active
            before = count(db.raw_payload)
            assert all(r["status"] == "NOT_DUE" for r in worker())
            assert count(db.raw_payload) == before
            process("--date", SELECTED)
            process("--date", "2026-10-30")
            assert results.latest(f"days/{SELECTED}") and results.latest("sensors")
        elif phase == "spatial":
            source = "atrai_road_network_heilbronn"
            first = worker("--source", source, "--backfill", "--max-pages", "1", expected=(2,))
            assert first[0]["status"] == "PARTIAL"
            checkpoint = repository.get_watermark(source)
            assert checkpoint.last_offset == 1 and checkpoint.state["more"]
            assert results.latest("spatial", version="spatial-v1") is None
            runs = worker("--backfill", registry="get_spatial_jobs")
            assert all(r["status"] == "SUCCESS" for r in runs)
            assert (
                repository.get_watermark(source).state["capture_at"]
                == checkpoint.state["capture_at"]
            )
            assert [r["params"]["offset"] for r in requests if r["source"] == source] == [
                ["0"],
                ["1"],
            ]
            before = count(db.raw_payload)
            assert all(r["status"] == "NOT_DUE" for r in worker())
            assert count(db.raw_payload) == before
            process("--spatial")
            spatial = results.latest("spatial", version="spatial-v1")
            assert spatial and len(spatial.payload["streets"]) == 2
            assert spatial.payload["pm_coverage"] == {"none": 2}
        else:
            source = "openmeteo_fcst"
            checkpoint = repository.get_watermark(source)
            snapshot = results.latest(f"days/{SELECTED}")
            runs = worker("--source", source, "--backfill", expected=(2,))
            assert runs[0]["status"] == "UNREACHABLE"
            after = repository.get_watermark(source)
            assert after.last_ts == checkpoint.last_ts
            assert after.last_success_at == checkpoint.last_success_at
            assert after.last_offset == checkpoint.last_offset
            process("--date", SELECTED)
            assert results.latest(f"days/{SELECTED}") == snapshot
        summary = {
            "phase": phase,
            "scope": __doc__,
            "requests": requests,
            "raw_pages": count(db.raw_payload),
            "observations": count(db.observations),
            "layers": count(db.segment_layer_value),
            "snapshots": count(db.result_snapshot),
            "checked_at_utc": datetime.now(UTC).isoformat(),
        }
        print(json.dumps(summary), flush=True)
        return summary
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("conditions", "spatial", "failure"))
    seed(parser.parse_args().phase)
