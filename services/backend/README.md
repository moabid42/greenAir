# greenAir backend

Initial FastAPI service for [the project architecture](../../docs/architecture.md).
It starts independently of databases, brokers, and external sensor services.

## Local development

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/getting-started/installation/),
and `just` for the root development recipes.
From the repository root:

```sh
just setup
just dev
```

Or from `services/backend`:

```sh
uv sync --locked
uv run --locked uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The service exposes `GET /health`, Swagger UI at `http://127.0.0.1:8000/docs`, and
OpenAPI JSON at `/openapi.json`. Health reports process liveness only.

Settings work with defaults. To customize them, copy `.env.example` to `.env` in
this directory. `GREENAIR_APP_NAME` sets the application title;
`GREENAIR_CORS_ORIGINS` accepts a JSON array such as `["http://localhost:5173"]`.
The default empty array adds no cross-origin browser permissions. Environment
variables take precedence over the service's `.env` file. No connection strings
or credentials are required for this scaffold.

## Module ownership

| Path | Responsibility |
|---|---|
| `app/main.py` | Application factory and ASGI entrypoint |
| `app/api/` | REST routes; future SSE delivery |
| `app/core/` | Settings and runtime configuration |
| `app/schemas/` | Validated request/response and future observation/event contracts |
| `app/ingestion/adapters/` | Future provider-specific pull adapters |
| `app/ingestion/` | Future scheduling, watermarks, backfill, raw landing orchestration |
| `app/processing/` | Future normalization/QC and spatial/temporal layer builders |
| `app/forecasting/` | Future next-24-hour layer forecasts |
| `app/scoring/` | Future sport/segment/hour scoring |
| `app/storage/` | Future database repositories and connections |
| `app/messaging/` | Future event transport and publication |
| `migrations/` | Future extension/schema migrations |
| `tests/` | HTTP startup, configuration, and integration checks |

Only app startup, configuration, CORS, and the health route are implemented.
Reserved modules contain docstrings; no data collection, processing, forecasts,
scores, SSE, database driver, or broker client is wired up.

## Checks

From this directory:

```sh
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
```

The lockfile is tracked. After deliberately changing dependencies, run `uv lock`
and `uv sync`, then the checks. Tests use the application factory and no external
services. The root `just test` also runs the existing agent-tool tests.
