# Initial implementation layout

[research.md](research.md) describes the target pipeline. This document records
how the repository accommodates it at the scaffold stage. FastAPI/Python is the
selected backend stack. The research remains a proposal for data access details
and unimplemented components.

## Starting boundary

Use one backend service in `services/backend`, with modules matching the diagram's
responsibilities. Only the HTTP shell is runnable today. Worker entrypoints can
share these modules later without introducing a separate deployment for every
box in the diagram. Keep polling and heavy jobs outside API startup/reload.

| Architecture component | Repository location | Current state |
|---|---|---|
| REST API, future SSE | `services/backend/app/api/` | Health route and OpenAPI available; feature endpoints/SSE reserved |
| Application configuration | `services/backend/app/core/` | Environment-backed settings |
| Canonical observation/event contracts | `services/backend/app/schemas/` | Health response only; source contracts pending inspection |
| Scheduler, adapters, raw landing | `services/backend/app/ingestion/` | Reserved module and adapters package |
| Normalizer/QC, spatial and temporal builders | `services/backend/app/processing/` | Reserved module |
| Forecaster | `services/backend/app/forecasting/` | Reserved module |
| Sport/segment/hour scoring | `services/backend/app/scoring/` | Reserved module |
| PostgreSQL + PostGIS + TimescaleDB | `services/backend/app/storage/`, `services/backend/migrations/` | Planned; no driver, schema, extensions, or server provisioned |
| Event bus and cache | `services/backend/app/messaging/`, `infrastructure/` | Transport/cache choice deferred; no broker provisioned |
| Vector tiles | `infrastructure/` | Martin/pg_tileserv choice deferred |
| MapLibre web client | `apps/web/` | Reserved directory; frontend framework undecided |

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
