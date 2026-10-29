# Implementation layout

[research.md](research.md) describes the target pipeline. This document records
how the repository maps it to a Python/FastAPI backend. The serving API currently
uses explicitly synthetic data; real pipeline integration remains deferred. See
[the API contract](backend-api.md) for implemented endpoints and limitations.

## Starting boundary

Use one backend service in `services/backend`, with modules matching the diagram's
responsibilities. The offline demo API and the processing CLI are runnable today. Worker entrypoints can
share these modules later without introducing a separate deployment for every
box in the diagram. Keep polling and heavy jobs outside API startup/reload.

| Architecture component | Repository location | Current state |
|---|---|---|
| REST API, future SSE | `services/backend/app/api/` | Health, mock serving APIs, dynamic OpenAPI/Swagger; SSE deferred |
| Application configuration | `services/backend/app/core/` | Environment-backed settings |
| Canonical observation/event contracts | `services/backend/app/schemas/` | Raw/normalized observations, processing results, serving responses |
| Scheduler, adapters, raw landing | `services/backend/app/ingestion/` | Optional live openSenseMap station adapter; station status adapter plus raw-storage contracts; source polling deferred |
| Normalizer/QC, spatial and temporal builders | `services/backend/app/processing/` | Implemented; input supplied by caller |
| Forecaster | `services/backend/app/processing/forecaster.py` | Bias correction and climatology fallback; provider fetching deferred |
| Sport/segment/hour scoring | `services/backend/app/scoring/` | Formulas, engine, best-time queries; API runs on dummy inputs |
| PostgreSQL + PostGIS + TimescaleDB | `services/backend/app/storage/`, `services/backend/migrations/` | Explicit migrations and raw-first repository; isolated extension tests; API remains independent |
| Event bus and cache | `services/backend/app/messaging/`, `infrastructure/` | Transport/cache choice deferred; no broker provisioned |
| Vector tiles | `infrastructure/` | Martin/pg_tileserv choice deferred |
| MapLibre web client | `apps/web/` | Next.js mobile app integrated with mock backend core routes |
| Admin frontend | `apps/admin/` | Separate Next.js app; real endpoint probes, simulated traffic data |

## Serving and containers — 2026-10-28

`app/serving/repository.py` separates API queries from the eventual pipeline/storage
provider. Its demo implementation generates synthetic day/grid/sensor resources and
invented street geometry. All serving data is labelled mock, with zero street-score
confidence. No processing worker or network fetch starts with the API.

`services/backend/Dockerfile` and root `compose.yaml` run the backend independently
with locked production dependencies and a process health check. `just backend-up`
starts it; `just backend-smoke` checks the documented routes through HTTP.

Existing frontend core aliases coexist with versioned resource routes. SSE, vector
tiles, persistence and refresh workers remain future additions. The collected
research snapshots are unchanged and do not establish current source availability.

## Decisions for the next data slice

- Preserve raw responses and provenance before normalizing. Start by inspecting
  one Heilbronn source and writing its integration note, then introduce the
  canonical observation contract and storage together. Validate units, geometry,
  timestamps, and source identity rather than inferring a complete schema from
  the research's example `Observation`.
- The proposed upsert key must include source identity (or a proven globally
  unique station identity). Inspect mobile observation identity as well; station,
  phenomenon, and time alone may not distinguish multiple moving samples.
- Keep `observations.raw`, `observations.clean`, and `scores.updated` as intended
  event boundaries. Choose NATS JetStream, Redis Streams, or an initial in-process
  mechanism when the first working data path establishes replay/durability needs.
- Choose the database image and extension versions together before adding local
  infrastructure. A PostgreSQL image alone does not establish that both PostGIS
  and TimescaleDB are available. Raw storage can begin in PostgreSQL if suitable;
  MinIO/S3 remains a later option.

## Research details to verify before implementation

- Polling intervals in `research.md` are proposed application settings, not
  provider sampling guarantees. The collected reference §16 explains freshness.
- The 20 m street matching describes ATRAI-derived layers. Raw global bike
  observations and rides still require explicit Heilbronn filtering (§3).
- The >75% humidity exclusion belongs to a documented ATRAI derived PM-risk
  calculation (§3.3). Define source-specific QC flags before applying it more
  broadly; retain raw readings and avoid silently discarding all humid samples.
- UBA/LUBW station identities, component/scope parameters, and current access
  are new integration candidates from `research.md`; they are not verified by
  the original endpoint catalog. Establish current documentation and a bounded
  probe before depending on them. The openSenseMap lifecycle/fallback claim also
  needs current confirmation.
- The reference §10.2 already identifies a reported MobiData Eco-Counter hourly
  resource. Check actual Heilbronn coverage and schema before concluding bicycle
  counters are unavailable or substituting ATRAI's flow proxy.

These points are recorded from local research reconciliation. No live source
probe was performed for the scaffold. Use the [agent workflow](../agents/WORKFLOW.md)
when the first integration starts.

The HTTP shell follows the official FastAPI guidance for
[router modules](https://fastapi.tiangolo.com/tutorial/bigger-applications/),
[settings](https://fastapi.tiangolo.com/advanced/settings/), and
[in-process HTTP tests](https://fastapi.tiangolo.com/tutorial/testing/). Test
dependencies use `httpx2` as specified by the current
[Starlette test client](https://starlette.dev/testclient/).
