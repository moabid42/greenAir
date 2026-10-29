# Next session: move greenAir from mock data to real inputs

Handoff written on 2026-10-28. Recheck Git, worktrees and running processes before
acting; the hashes, paths and check results below describe this session's state.

## Objective and user preferences

The working mock demo is complete. The next implementation objective is a verified
path from real source responses through storage/processing into the existing API
and frontend. Reuse the code already written; do not rebuild the application or
implement the entire architecture before delivering the first real-data slice.

User requirements and preferences:

- Python/FastAPI backend, containerized, with relevant endpoints in Swagger UI.
- Dynamic OpenAPI from routes/models, using the documented Google API design
  conventions and explicit compatibility exceptions.
- Keep the current frontend contracts stable where possible. Coordinate any
  necessary missing-data/provenance changes with the frontend.
- Use small, atomic commits with the convention below. Keep unrelated work out.
- **Never stage, commit or push `playground/` or `data/runtime/`.** Preserve local
  experiments, raw captures, credentials and database volumes. Both paths are
  excluded in `.gitignore` and the local Git exclude file.
- Latest merge preference: prepare tested feature branches and give the user the
  exact source → target merge order. The user will merge. Do not assume the earlier
  instruction to merge automatically still applies.
- Do not delete more branches without a new request. Preserve unmerged ingestion
  work and worktrees, especially their uncommitted files.
- Stop processes you start when done. Do not leave background servers running or
  stop unrelated user services. Do not start services merely to read this handoff.
- GitHub CLI is installed but was not authenticated. The user chose **local checks
  only**. Do not claim remote CI is green or repeatedly request authentication.

## Start here

Read [AGENTS.md](AGENTS.md), [backend instructions](services/backend/AGENTS.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [STATE](agents/STATE.md),
[architecture](docs/architecture.md), and [the data workflow](agents/WORKFLOW.md).
Then inspect, without discarding changes:

```sh
git status --short
git worktree list
git branch -avv
git fetch --prune origin
python3 agents/context.py overview
```

Inspect all temporary worktrees listed below before cleanup, rebasing or merging.
Do not blindly pull into an old local branch or use reset/clean to make it match
remote. Preserve the uncommitted handoff notes as well. Create new feature work
from the latest `origin/dev` after accounting for local changes.

At handoff:

- Remote `dev`: `056a0c7`, the user's merge of PR #11 containing the integrated
  frontend/backend work.
- Current local checkout: `feat/frontend-backend-integration` at `68a19a5`.
  Its former remote branch was deleted after merging; its code is in remote dev.
- Local `dev` is still at `9dd12b4`, behind remote dev. Do not use it as a fresh base
  without updating it safely.
- `agents/STATE.md` has an uncommitted real-data gap audit. This handoff is also
  uncommitted unless a later session explicitly commits it.
- Last verified remote branches: `dev`, `main`, and unmerged `ecomab-app`.
- The mobile/admin preview servers and demo API container were stopped on request.
  Pre-existing `greenair-db-1` (localhost:55432) and `greenair-redis-1`
  (localhost:56379) remained running. Verify this rather than assuming it persists.
  Their data may contain the raw evidence referenced by ingestion notes.

## What is implemented and merged

| Area | Location | State |
|---|---|---|
| API and configuration | `services/backend/app/main.py`, `app/api/`, `app/core/` | FastAPI, CORS, gzip, health and typed errors |
| Documentation | `app/api/documentation.py` | Generated OpenAPI 3.1, Swagger `/docs`, ReDoc `/redoc`, operation IDs/examples/errors |
| Processing contracts | `app/schemas/observations.py` | Raw and normalized observations, provenance, QC flags |
| Processing | `app/processing/` | Normalization/QC, temporal profiles, spatial matching/layers, forecasts, JSON pipeline CLI |
| Scoring | `app/scoring/` | Sport formulas, segment/hour engine, daylight, gates, confidence, best times |
| Serving interface | `app/serving/repository.py` | Replaceable `ServingRepository` protocol, injectable through `create_app` |
| Serving implementation | `app/serving/demo.py` | Deterministic synthetic day/grid/sensors and invented street geometry |
| Station status | `app/api/routes/stations.py` | Mock by default; existing openSenseMap adapter can be explicitly enabled |
| Container | `services/backend/Dockerfile`, root `compose.yaml` | Locked production dependencies, nonroot user, read-only runtime and health check |
| Mobile client | `apps/web/` | Next.js/MapLibre, tested against mock backend; mock-aware labels |
| Admin client | `apps/admin/` | Next.js; real endpoint probes, explicitly simulated traffic/client-data charts, browser-local configuration |
| CI | `.github/workflows/ci.yml` | Root checks, backend container smoke, mobile/admin lint/build jobs and admin tests |

Core frontend endpoints are `/api/v1/day?date=`, `/api/v1/grid?date=` and
`/api/v1/sensors`. The API also exposes versioned resource routes and compatible
street score/detail/best-time/status routes. All 20 documented GET routes passed
container HTTP checks. See [the API contract](docs/backend-api.md) and
[frontend compatibility evidence](docs/integrations/frontend-compatibility.md).

Important distinctions:

- `create_app` still chooses `DemoRepository` by default. Processing existing as
  Python functions does not mean a live source is feeding the frontend.
- `GREENAIR_STATION_DATA_MODE=live` affects only `/stations/status`. It does not
  make `/api/v1/sensors`, `/day`, `/grid` or street scores real.
- The JSON processing CLI accepts supplied inputs. It does not fetch sources,
  persist results or operate a real event bus.
- Day/grid provide factor scores; the frontend applies sport weights. Optional
  street scores use a separate backend sport-scoring contract. Do not silently
  replace the core factor contract with `PipelineResult` or backend final scores.
- SSE and vector tiles are **not implemented**. They were deferred, not deleted.
  Keep `NEXT_PUBLIC_ECOMAB_API_BASE_URL` empty until the optional street overlay
  has its required tiles or is deliberately adapted to GeoJSON.

### Why the old PR branches disappeared

Only PRs #2, #8 and #9 were directly merged by the agent. PR #8 contained this
stack of earlier work: `#3 → #4 → #5 → #6 → #10 → #7 → #8`. Thus all nine PRs'
committed code was included in dev, even though that is different from individually
merging each PR in GitHub. At the user's request, redundant remote branches were
deleted only after verifying their tips were ancestors of remote dev. No SSE
implementation branch was among them. Do not infer PR status from this statement;
private GitHub API status was not available.

## Existing real-data work: preserve before implementing

These **local** branches were not merged into dev and were not deleted:

- `feat/ingestion-foundation` at `842912b`: raw-first storage, database models and
  migrations, ingestion contracts, bounded HTTP landing and tests.
- `feat/ingestion-atrai-raw` at `6410850`: also includes receipt accounting and
  ATRAI segment snapshots. Relevant intervening commit: `642ad44`.
- `feat/ingestion` at `dad3454`: adds home ingestion/export/validation and other
  draft work. Its ancestry includes `be/data` / `41a0502` (personal playground
  work). **Do not wholesale merge this ancestry into dev.** Review and port only
  the required service code, contracts, tests and documentation.
- Local weather, openSenseMap, scheduler, probes and static branches/worktrees
  remain available. A branch name does not prove that its draft files are committed.

Last inspected worktrees:

| Worktree | Work that must be preserved |
|---|---|
| `/private/tmp/greenair-weather-adapters` | Uncommitted weather/UBA adapters and tests, contract notes/JSON, modified ingestion observation schema |
| `/private/tmp/greenair-osem` | Uncommitted openSenseMap adapter, tests, contract notes/JSON |
| `/private/tmp/greenair-scheduler` | Uncommitted scheduler, worker, Redis bus, tests and worker fixture |
| `/private/tmp/greenair-probes` | Uncommitted probe CLI, source configuration and evidence manifests |
| `/private/tmp/greenair-atrai-raw` | Committed foundation/ATRAI work; clean when inspected |
| `/private/tmp/greenair-static` | Clean at the ATRAI base when inspected; do not assume a static adapter was implemented |

Do not remove these directories, force-switch their branches or delete their
untracked files. Temporary paths are recovery locations, not a durable storage
strategy. Inspect their diffs and preserve reviewed draft code on normal feature
branches before any cleanup. Do not dump all temporary files into one WIP commit.
Historical probe manifests reference raw database records; do not erase that DB.

## Critical compatibility gaps

The independent ingestion and processing implementations currently disagree:

| Meaning | Unmerged ingestion | Merged processing |
|---|---|---|
| Model value kind | `forecast` | `model` |
| PM2.5 phenomenon | `pm25` | `pm2_5` |
| Temperature phenomenon | `temp` | `temperature` |
| Event time | `ts_utc` | `observed_at` |
| Geometry | `geom` object | longitude / latitude fields |
| Canonical wind unit | km/h | m/s |
| Traceability | `raw_ref`, issue time | raw key/value/unit, platform, sample ID, retrieval time |

Choose one explicit boundary or mapping. Preserve both provider originals and
semantic distinctions; do not drop platform/sample identity or double-convert
units. Ingestion is stricter about unknown timezones; do not silently replace
unresolved timestamps with the normalizer's assumed-UTC behavior.

Other gaps:

- The default serving schemas currently constrain many `source` fields to `mock`.
  Day raw values and factor arrays require numbers. Real missing inputs need a
  deliberate contract and frontend handling, or an explicit unavailable response.
  Do not insert zero, invented safety/traffic values or silent dummy fallbacks.
- The scheduler draft's default registry is `app.ingestion.registry:get_jobs`;
  verify and implement actual source registration before claiming it runs.
- Open-Meteo issue timestamps are unresolved in the weather draft. Payload
  `generationtime_ms` is a duration, not issuance. Define an explicit policy
  distinguishing provider issue time, retrieval time and application build time.
- Existing observations, forecasts, derived scores and interpolated spatial values
  need distinct provenance. Modelled air quality is not a station measurement.
- Mock dates currently span 2020–2100. That is not real history or a real forecast
  horizon. Discover actual coverage and return explicit no-data outside it.
- The frontend currently needs 24 Berlin wall-clock day/grid slots. Handle DST
  explicitly without fabricating observation times or duplicating source records.
- Do not mark a whole day/grid measured when only one channel is measured. When a
  real day is shown with a still-synthetic grid, expose that distinction in the UI.

## Implementation order and atomic commits

Suggested branches and commit subjects follow. They are a plan, not claims that
these changes exist. Implement/test one coherent change per commit; include its
necessary regression tests and integration-note updates in that same commit.
Do not combine all stages into a single PR or blindly cherry-pick the old branch.

### 0. Preserve and inspect the drafts

First inventory the worktrees and save reviewed work safely. Identify dependencies
on old schema/storage code and personal commits. Record what is recoverable and
what has actually been tested. Keep live captures and secrets outside Git.

A documentation-only preservation checkpoint can use:
`docs(ingestion): record recovered drafts and integration boundaries`

### 1. Port the foundation and reconcile contracts

Suggested branch: `feat/real-data-foundation`.

1. `feat(storage): add raw landing and ingestion migrations`
   Port the required models/migrations/repository from the existing foundation.
   Keep raw bytes and HTTP provenance, stable IDs, checkpoints and idempotency.
   Validate PostgreSQL/PostGIS/TimescaleDB behavior against a disposable test DB;
   having containers running is not proof that migrations and extensions work.
2. `refactor(backend): reconcile ingestion and processing contracts`
   Implement explicit field/kind/unit mapping and raw traceability. Test actual
   adapter-shaped values, nulls, moving sample identity, units and UTC/DST.
3. `feat(ingestion): persist bounded source responses before parsing`
   Port the landing client/retry logic and receipts. Test retry limits, rate limits,
   payload type, byte limits, parse failures and checkpoint behavior.

Dependencies: source adapters need this boundary and landing/storage support.
Resolve Compose/Dockerfile/dependency conflicts deliberately: preserve the current
standalone demo API, its nonroot runtime, and API startup without infrastructure.
Do not replace the new Compose file wholesale with the older ingestion version.

### 2. Connect the first real sources

Suggested branch: `feat/real-data-sources`, based on the reviewed foundation.

4. `feat(ingestion): ingest weather and air quality forecasts`
   Recover the weather adapter and tests. Recheck provider docs and bounded live
   samples, settle issue-time policy, keep model provenance and actual grid points.
5. `feat(ingestion): ingest stationary sensor observations`
   Recover the openSenseMap adapter/tests. Check geography, stationary/outdoor
   interpretation, device/sensor IDs, units, nulls and latest observation time.
6. `feat(ingestion): ingest official station air measurements`
   Recover UBA adapter/tests and recheck station/component/scope contracts. This
   adds measured reference data; it is not required to pretend modelled NO2 is measured.

Provider notes in the draft worktrees contain useful bounded probe/replay evidence.
Revalidate it; do not treat old counts, successful fixture tests or raw IDs as live
availability. Use the catalog to locate sources and reference sections to interpret
them. Preserve original research snapshots and evidence labels.

### 3. Make ingestion and processing repeatable

Suggested branch: `feat/real-data-refresh`.

7. `feat(ingestion): register source jobs and persist polling progress`
   Recover the scheduler/worker draft and add a real registry. A bounded `--once`
   pass must work before continuous polling. Test restart, deduplication, source
   locks, bounded retries and partial runs. Keep workers outside API startup.
8. `feat(processing): process stored observations into result snapshots`
   Read the agreed records, run existing QC/temporal/forecast/scoring code as
   appropriate, and persist versioned outputs. Preserve observation/retrieval/
   forecast/build times separately. Mark insufficient data rather than inventing it.

Use the existing outbox/Redis work only where needed. A full event-bus deployment
is not a prerequisite for the first real day/sensor API. Do not implement SSE now
just because the diagram contains it. Document the chosen refresh mechanism.

### 4. Serve real results through the existing API

Suggested branch: `feat/real-data-serving`.

9. `feat(api): support real provenance and missing data states`
   Generalize mock-only response constraints, source metadata, coverage/freshness
   and actual date horizons. Choose nullable/unavailable semantics explicitly;
   update affected frontend types/formatters and generated OpenAPI together.
10. `feat(backend): serve real conditions through the repository interface`
    Implement a real `ServingRepository` and an explicit provider selection.
    Preserve mock mode for offline development. Initially replace day/sensors;
    do not switch modes while leaving unnoticed dummy values in those responses.
11. `fix(web): distinguish measured modelled and synthetic layers`
    Where needed, show real source/freshness/missingness and mixed layer provenance.
    Keep sport weighting in the core client and synthetic map layers clearly labelled.
12. `test(backend): verify the real source to frontend data path`
    Add a meaningful bounded integration/smoke test, not implementation-mirroring
    tests. Check real capture replay through storage/processing/API and the browser,
    including unavailable upstreams, stale last-success snapshots and restart behavior.

**First deliverable:** real weather/modelled-air day conditions and real stationary
sensor markers, with honest provenance and explicit gaps. A still-mock spatial grid
must be labelled separately or disabled. This is not yet a verified street-level
pollution product. Keep model values distinguishable from station observations.

### 5. Replace spatial placeholders after the first deliverable

Suggested branch: `feat/real-spatial-data`.

13. `feat(ingestion): load verified Heilbronn segment layers`
    Reuse ATRAI snapshot work. Inspect geometry, stable join keys, units, local
    filtering, pagination and completeness before joining roughness/overtaking/flow.
14. `feat(processing): build spatial layers from verified observations`
    Connect real mobile/static inputs and stationary temporal levels. Keep missing
    coverage, interpolation and confidence explicit; do not invent fine spatial
    pollution differences from a city-wide forecast alone.
15. `feat(backend): serve verified spatial grids and street scores`
    Project real layers into the frontend grid/segment contracts and test joins,
    geographic coverage, confidence and consistency with the day response.

Vector tiles, SSE, large historical backfills, calibration/tuning and real admin
telemetry can follow as separate features. The current admin's simulated charts
must stay labelled until actual telemetry is implemented. None is required to
start serving real day conditions and sensor markers.

## Commit and merge discipline

Use `verb(scope): short message`: one nonempty line, at most **72 characters**,
lowercase verb and required lowercase scope, no body/footer. Prefer the same
format for authored merge/squash messages. Current tooling also accepts standard
generated Git/GitHub merge messages; this is not permission to use free-form
regular commits or relax the user's convention. Do not rewrite team history.

For each atomic commit:

1. Review `git diff` and stage explicit files; never blanket-stage personal data.
2. Include only one independently understandable behavior or integration boundary,
   its meaningful tests and necessary evidence/docs. Keep the branch runnable.
3. Run the relevant checks; use deliberate `just format` for formatting changes.
   Do not bypass Husky or reduce checks just to get a commit/push through.
4. Record bounded live validation separately from offline fixtures and local tests.
5. Give the user a concrete branch → dev merge order and any dependencies.
   Do not delete draft branches or assume PR status from commit ancestry.

The suggested commit subjects above are examples within the 72-character limit.
Do not commit this whole roadmap as implementation, or claim a stage is complete
merely because a schema, fixture or draft file exists.

## Verification and runtime commands

Use Node.js 24 from `.nvmrc` and the Python/uv/just pins in the development docs.
The shell previously defaulted to Node 23; do not mistake that for the project pin.
Use the root justfile; add recipes there for new worker/migration tasks.

```sh
just lint
just test
just check-web       # when frontend code/contracts change
just check-admin     # when admin code/contracts change
```

Last local evidence: 144 backend tests, 12 research-tool tests, 45 commit-tool
tests and 11 admin tests passed; both Node 24 frontend production builds/lints
passed. Backend container smoke exercised all 20 documented routes. Browser checks
covered Today, week/history, Explore, place details, Analytics, Coach, mock labels,
and all four admin pages with CORS from port 3200. These are historical local
results, not proof of current provider availability or remote CI success.

Only start services when required for implementation/verification:

```sh
just backend-up
just backend-smoke
# Swagger: http://localhost:8000/docs
# Dynamic schema: http://localhost:8000/openapi.json
just openapi

# Separate terminals, if needed:
NEXT_PUBLIC_API_URL=http://localhost:8000 just dev-web
NEXT_PUBLIC_API_URL=http://localhost:8000 just dev-admin
```

Compose currently allows localhost:3000, :3200 and :5173. The backend uses a
separate `greenair-demo` Compose project. Inspect existing DB/Redis infrastructure
before adding worker/database services. Never run `down -v` against evidence data.
When finished, stop your own frontend/admin processes and use `just backend-down`
for the demo backend. Report any services intentionally left running.

After changing the research workflow or source routing, also run the checks
required by AGENTS.md. Keep downloads and large responses outside this file and
agent instructions. For the next session's first action, preserve the draft
worktrees and reconcile the contracts before attempting a wholesale ingestion merge.
