# greenAir backend

FastAPI backend with a complete offline demo API and the merged processing/scoring
modules. Serving data is synthetic (`source: mock`), including sensor identities and
street geometry; no real pipeline, database, broker, or upstream service is needed.

## Start with Docker

From the repository root, with Docker Engine and Compose running:

```sh
just backend-up
just backend-smoke
```

Open [Swagger UI](http://localhost:8000/docs), choose an endpoint and **Try it out**.
The [OpenAPI document](http://localhost:8000/openapi.json) is generated dynamically
from registered routes and Pydantic models. [ReDoc](http://localhost:8000/redoc) is
also available. The container health check uses `/health`.

Use date `2026-10-29`, sensor `mock-1`, segment `1`, profile `running`, UTC hour
`2026-10-29T12:00:00Z`, and lookup point lat `49.1425`, lon `9.2115`.
Core frontend routes are `/api/v1/day?date=`, `/api/v1/grid?date=`, and
`/api/v1/sensors`. Versioned resource routes and street-score routes are also
exposed in Swagger. See [the API contract](../../docs/backend-api.md) for all paths,
Google API design conventions, compatibility exceptions, examples, and data limitations.

```sh
just backend-logs
just backend-down
```

The image uses locked production dependencies, runs as UID/GID 10001, and excludes
local `.env`, tests, caches, downloads, and credentials. Compose runs it with a
read-only root filesystem, temporary `/tmp`, no Linux capabilities, and no database.
It uses a separate `greenair-demo` project so existing ingestion experiments are
unaffected. Do not use `--reload` in the container.

Compose binds to `127.0.0.1:8000` by default. Set `GREENAIR_PORT=8001` to change the
host port or `GREENAIR_BIND_HOST=0.0.0.0` to expose it beyond localhost. For a custom
port, run the smoke check with `GREENAIR_SMOKE_URL=http://127.0.0.1:8001`.
The API's `/` OpenAPI server URL follows the current origin.

## Local Python development

Use the repository's pinned tooling: Python 3.12+, uv, just, and Node.js 24/npm.

```sh
just setup
just dev
just lint
just test
just openapi
```

`just openapi` prints JSON on stdout. No generated specification needs committing.
To customize local settings, copy `.env.example` to `.env` here. Environment
variables take precedence. `GREENAIR_CORS_ORIGINS` is a JSON array, for example
`["http://localhost:3000"]`. Local Python defaults to no cross-origin permissions;
Compose defaults to localhost:3000, :3200 and :5173. Configure the frontend with
`NEXT_PUBLIC_API_URL=http://localhost:8000` before starting/building it.

`GREENAIR_STATION_DATA_MODE=mock` is the default. Explicit `live` mode enables only
`/stations/status`'s existing openSenseMap adapter; all other serving APIs remain
mock. No fresh provider verification was performed for this demo implementation.

## Ownership and future integration

| Path | Responsibility |
|---|---|
| `app/main.py` | Application factory and ASGI entrypoint; no polling on startup |
| `app/api/` | HTTP routes, Google-style errors, dynamic OpenAPI |
| `app/schemas/` | Validated observations, processing results, public response contracts |
| `app/serving/` | Replaceable query interface and synthetic demo implementation |
| `app/processing/` | Normalizer/QC, temporal and spatial builders, forecasting, pipeline CLI |
| `app/scoring/` | Sport formulas, segment/hour engine and recommended hours |
| `app/ingestion/adapters/` | Existing optional openSenseMap adapter |
| `app/storage/`, `migrations/` | Reserved persistent storage integration |
| `app/messaging/` | Reserved event transport; SSE and broker integration deferred |

Replace `ServingRepository` through `create_app(repository=...)` or the
`get_repository` dependency when real pipeline snapshots are ready. Keep refresh
workers separate from the API. The same image can later run a worker command.
Core factor scores and backend sport scores are separate contracts; do not silently
apply backend sport weights to the frontend's factor-only day/grid responses.

Processing can already run independently on a supplied JSON bundle:

```sh
uv run --locked --directory services/backend python -m app.processing.pipeline INPUT.json --output RESULT.json
```

See [processing](../../docs/processing.md), [scoring](../../docs/scoring.md), and
[contribution checks](../../CONTRIBUTING.md). Tests are offline; the additional
`just backend-smoke` exercises every documented route over real container HTTP.

## Optional ingestion storage

The API starts without a database and continues to use the demo serving provider.
Raw-first storage is available independently; see
[storage contract and validation](../../docs/integrations/raw-storage.md).
Run `GREENAIR_DATABASE_URL=... just migrate` from the repository root to migrate
an explicitly selected PostgreSQL/PostGIS/TimescaleDB database. `just test-storage`
checks migrations and persistence in a disposable container and removes it afterward.
No worker, upstream fetch or migration starts as part of API startup.

## Explicit refresh and processing

After selecting `GREENAIR_DATABASE_URL` and running `just migrate`, use
`just ingest-once` for one bounded registered-source pass or `just process-results`
for stored-input day/sensor snapshots. `just refresh-once` performs both steps and
still processes available inputs when some upstream jobs are partial. Optional
`--source ID`, `--max-pages N` and processing `--date YYYY-MM-DD` flags are documented
in [worker behavior](../../docs/integrations/refresh-worker.md) and
[snapshot semantics](../../docs/integrations/processed-snapshots.md).
No Redis service is required. The API still defaults to its demo provider until
stored serving is explicitly selected below.

## Serving stored results

Set `GREENAIR_SERVING_DATA_MODE=stored` and `GREENAIR_DATABASE_URL` to the explicitly
selected, migrated results database. `just dev` or `just backend-up` then reads day
and sensor snapshots; no fetch or worker starts with the API. Default mode stays
`mock`. Run the separate refresh command to obtain inputs/results first. Missing
coverage is 404, storage outages are 503, and stale last-success results keep their
original dates and labels. Without a spatial snapshot, grid/street layers remain
unavailable. Import verified city layers with `just ingest-spatial --max-pages 4`
(repeat to resume), then `just process-results --spatial --reference-days 7`.
This enables historical road attributes and partial spatial projections with explicit
missing PM confidence, without inventing street pollution patterns. See the
[spatial contract/evidence](../../docs/integrations/atrai-spatial.md).
See [the real serving contract](../../docs/integrations/real-serving-contract.md).
