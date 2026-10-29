# Durable development context

Keep this file short. Read relevant entries on task start and update them when
omitting a finding would cause repeated discovery or change a later decision.
Link detailed contracts, code, fixtures, and manifests rather than copying them.
Dates describe when evidence was obtained; recheck time-sensitive assumptions.

## Current foundation — 2026-10-28

- The repository contains research, agent tooling, and an initial FastAPI backend
  in `services/backend`. Python 3.12+, Pydantic 2, and uv are selected. The app
  exposes liveness and OpenAPI; data adapters, storage, scoring, and workers are
  reserved modules. No measurement archive has been downloaded.
- The canonical research files are the 2026-10-28 detailed reference and endpoint
  CSV linked in [AGENTS.md](../AGENTS.md). The initial catalog has 101 endpoints
  across 13 source cards, including 45 ATRAI collection URLs across all cities.
  These are snapshot counts; use `context.py overview` for the current files.
- [The workflow](WORKFLOW.md) uses offline focused lookup and dated live evidence.
  `context.py` reads the original files directly; no generated index needs
  refreshing. [sources.json](sources.json) owns source routing.
- No live Green City endpoint was checked while establishing this workflow.
  Availability, complete schemas, local coverage, and current counts remain
  subject to integration-specific probes. The original reference contains its
  own historical evidence; offline tool checks do not upgrade those claims.

## Active integrations and decisions

### Backend scaffold — 2026-10-28

- Decision: implement the target architecture initially as modules in one Python
  backend service. FastAPI is the user's explicit choice. Keep pollers/workers
  outside API startup; defer deployment splitting, bus choice, database drivers,
  and actual feature implementations.
- Task runner: use the root `justfile` for setup, development, tests, lint, and
  formatting, per the user's preference. Run `just` to list recipes.
- Structure and rationale: [architecture mapping](../docs/architecture.md),
  [service setup](../services/backend/README.md),
  [architecture proposal](../docs/research.md).
- Evidence: local research reconciliation only; no external data-source probe.
  UBA scope/stations, source-specific QC, and proposed polling rates still need
  integration checks. MobiData counter candidates already appear in reference §10.2.
- Local validation: `just lint` and `just test` passed on Python 3.13.5:
  four backend tests plus twelve existing agent-tool tests. Health/OpenAPI,
  settings precedence, and allowed/disallowed CORS origins were exercised.
- Next action: inspect one source, record its contract, and implement a thin
  ingestion-to-storage slice when requested.

### CI and commit convention — 2026-10-28

- The root [npm package](../package.json) contains Husky and commitlint tooling;
  it does not choose or scaffold a web framework. `just setup` activates hooks.
- Hooks: lint before commits, validate commit messages, and test before pushes.
  GitHub [CI](../.github/workflows/ci.yml) runs the same lint/tests plus commitlint
  over push/PR commit ranges selected by [ci-range.mjs](../scripts/ci-range.mjs).
  New branches exclude history shared with the default branch; initial/orphan
  branches include root commits. Manual runs check the latest commit. Missing
  previous tips fail explicitly, and deletion events are skipped.
- CI also [checks committed whitespace](../scripts/check-whitespace.mjs), using
  PR merge bases, push before/after trees, or the empty tree for initial history.
  Local lint keeps its staged and unstaged checks.
- `just setup` installs actionlint 1.7.12 under ignored `.tools/` with the
  version-tagged official downloader. `just lint`/`just lint-workflows` validate
  GitHub Actions locally and in CI without downloading during lint. Optional
  ShellCheck/Pyflakes integrations are disabled for consistent prerequisites.
- CI hardening validation: `just setup`, `just lint`, and all 48 tests passed
  locally (4 backend, 12 agent-tool, 32 commit/range/whitespace cases). Actionlint
  accepted the workflow and rejected an invalid-expression fixture; its
  versioned installer was checked on macOS arm64, including a repeat setup.
- User convention: `verb(scope): short message`, a single line of at most 72
  characters with a required lowercase scope. Lowercase verbs remain flexible.
  Details and examples: [CONTRIBUTING.md](../CONTRIBUTING.md).
- User-requested merge exception: standard generated Git/GitHub merge messages
  and their bodies (for example, `Merge pull request #1 ...` followed by `Dev`)
  are accepted by the shared commitlint config. Regular and squash commits stay
  strict; revert/fixup/release exemptions remain disabled. Range checks still
  validate every regular commit brought in by a merge.
- Local validation: Husky's actual pre-commit and pre-push wrappers passed lint
  and all 36 tests (4 backend, 12 agent-tool, 20 commit-rule cases). Its commit-msg
  wrapper accepted a valid message and rejected an invalid one. `core.hooksPath`
  is `.husky/_` in this clone; workflow YAML parsed locally.
- Remote CI has not been executed from this workspace; pushing the workflow
  enables it. Repository branch-protection settings are unchanged.
- CI action resolution: `astral-sh/setup-uv@v9` returned 404 when checked on
  2026-10-28; use the published [v9.0.0 release](https://github.com/astral-sh/setup-uv/releases/tag/v9.0.0).
  Its action metadata supports the existing inputs; the separate uv tool pin
  remains 0.13.6. The other three workflow action references were verified.

### Team handoff configuration — 2026-10-28

- Development pins: Node.js 24 in `.nvmrc`, Python 3.12 in the backend's
  `.python-version`; uv/just versions are documented in
  [development guidance](../docs/development.md). CI reads the Node.js pin.
- User review preference: no CODEOWNERS file; request reviews from `moabid42`.

### Sport scoring formulas — 2026-10-28

Decision and reason: implement the team scoring draft v0.1 as pure functions
first, so that data adapters can plug in later without changing the formulas.
Contract / implementation: [scoring draft](../docs/scoring.md),
`services/backend/app/scoring/`.
Evidence: offline only; 29 scoring tests, including the §8 worked example
(score 64, confidence 0.67). No data source involved.
Still uncertain: all constants are untuned defaults. Open points (wrong §3.1
example value, PM10 without weight) are listed at the end of the draft.
Next action: build the city level `L(t)` from live station data (§4.1).

### Processing box — 2026-10-28

Decision and reason: the team splits the architecture; Mouad owns ingestion,
this work owns processing (normalizer/QC, temporal and spatial builders,
forecaster, scoring engine). Processing is pure Python without database or
broker, so each stage has an in-process e2e test from fixture files.
Contract / implementation: [processing](../docs/processing.md),
`RawObservation` -> `Observation` in `services/backend/app/schemas/observations.py`,
JSON Schema in `docs/contracts/`.
Pipeline: `python -m app.processing.pipeline INPUT.json` (in `services/backend`)
runs normalizer -> temporal -> forecaster -> spatial -> scoring engine and writes
`PipelineResult` (`docs/contracts/pipeline-result.schema.json`).
Evidence: offline e2e tests per stage; the full run goes through the CLI as a
subprocess. Captured ATRAI fixture is historical (2026-07-08); other e2e data is
labelled synthetic. Open-Meteo and Bright Sky keys/units probed
2026-10-28T18:38:58Z (see processing doc). Stuck/humid checks apply only to
measurements, not model output (found by the forecaster e2e test).
Still uncertain: contract agreement with ingestion; real segment layers (ATRAI),
a reference station for calibration (UBA/LUBW), and tuned constants.
Next action: agree the contract with ingestion, then run the pipeline on real
adapter output.

### Green City station status (openSenseMap) — 2026-10-28

Decision and reason: live box status comes from openSenseMap
`/boxes?grouptag=GreenCityHN&full=true` (14 stationary boxes). The catalog tag
`heilbronn` returns mobile bike boxes. The ATRAI home mirror is a 2026-09-30
sync with unstable offset order; use it for history only.
Contract / implementation: [integration note](../docs/integrations/opensensemap-stations.md),
`GET /stations/status`.
Evidence: 2026-10-28T17:08:18Z HTTP 200 JSON, 14 boxes; 17:10:09Z via the route:
6 online, 7 stale (30 min), 1 no data. 10 offline tests pass.
Still uncertain: license, stuck sensors, sun exposure of outdoor boxes.
Next action: scoring functions from the team scoring draft (separate branch).

Use this format for additional short entries:

```text
### <source/feature> — <YYYY-MM-DD>
Decision and reason: <one or two sentences>
Contract / implementation: <relative links>
Evidence: <UTC check time; method/URL or manifest link; result; local tests>
Still uncertain: <coverage/schema/access/freshness questions, or none>
Next action: <concrete next step, or complete>
```

Keep reported research claims distinct from new observations. If a probe fails,
record the environment and response/error; do not conclude the entire source is
offline. Record a later successful check alongside the earlier failure.

### Mock serving API — 2026-10-28

- Integrated the CI isolation, processing pipeline (including its stacked dependencies),
  and station-status PR branches into local `dev`. No ingestion branches were merged.
- `app/serving/repository.py` defines the replaceable query boundary. The demo provider
  supplies synthetic day/grid/sensors and invented segment lines; street scores use the
  existing sport engine with zero confidence. It performs no upstream requests.
- Core contracts follow the frontend types on `origin/web/ecomab-frontend` and endpoint
  guidance in `origin/main:apps/web/README.md`: 24 Berlin wall-clock slots, factor-only
  scores, stable grid IDs, gzip, and explicit mock provenance. Pipeline integration,
  vector tiles, SSE, and persistent storage remain deferred.
- Station status defaults to mock; `GREENAIR_STATION_DATA_MODE=live` opts into the
  existing adapter. Recorded historical probes above are not fresh verification.
- Evidence: offline HTTP tests cover the frontend contracts, DST, coverage, pagination,
  errors, and provider replacement. No live source checks were needed for dummy data.

### Dynamic API documentation — 2026-10-28

- Swagger, ReDoc, and OpenAPI are generated from live routes and validated models.
  Versioned resources and Google-style errors follow selected Google AIP guidance;
  compatibility exceptions and dummy provenance are explicit in
  [the API contract](../docs/backend-api.md). `just openapi` exports JSON on stdout.
- Standalone openapi-spec-validator accepted the generated OpenAPI 3.1 document;
  route/error/example tests keep the schema synchronized with runtime behavior.

### Containerized demo backend — 2026-10-28

- `compose.yaml` runs a separate `greenair-demo` backend on localhost:8000. The
  production image installs locked dependencies, runs as UID 10001, excludes `.env`
  and tests, and supports a read-only filesystem. No database or broker is required.
- Tasks: `just backend-up`, `backend-smoke`, `backend-logs`, `backend-down`.
  [Service instructions](../services/backend/README.md) cover ports and CORS.
- Evidence: local Docker image built and reported healthy; the HTTP smoke script
  exercised all 20 documented GET routes, Swagger/ReDoc/OpenAPI, mock provenance,
  gzip, CORS, and 400/404 errors. UID 10001 and absence of `.env`/tests were checked
  inside the running container. `just lint` and `just test` passed (144 backend,
  12 research tooling, 32 commit tooling tests). Standalone OpenAPI validation passed.
- CI now builds the container and runs the same HTTP smoke script. Remote CI results
  remain separate from local validation. Real pipeline integration, SSE, and tiles
  are future work; no live environmental observations were claimed in this task.

- Browser verification: Chrome rendered all 20 Swagger operations and executed
  GetDay through Try it out, returning HTTP 200 with 24 mock hourly slots.

### Actual frontend compatibility — 2026-10-28

- Fetched and tested frontend `17fd270` in a detached temporary worktree against
  containerized dev `9dd12b4`. [Review](../docs/integrations/frontend-compatibility.md).
  Production build passed; browser flows covered Today/week/history/Explore/place/
  Analytics/Coach, with 21 successful backend responses and no runtime exceptions.
- Actual frontend scoring/ranking code accepted core responses across all sports
  and DST dates. Optional street JSON validates, but its overlay still needs vector
  tiles and mock-aware provenance. Small frontend copy changes are needed for the
  deliberate dummy mode. No application code was changed or pushed in this review.
- The published dev tree/history contains no `playground/`. Preserve the user's
  existing local `.gitignore` exclusions; do not stage or push personal playground data.

### Frontend integration prepared for user merge — 2026-10-28

- Branch `feat/frontend-backend-integration` contains the frontend/admin merge,
  preserved playground/runtime exclusions, explicit mock labels, frontend CI jobs,
  root just recipes and admin CORS on localhost:3200. User will merge it into dev;
  remote dev remains at the previously pushed backend integration `9dd12b4`.
- Local checks: root lint/test (144 backend, 12 research, 45 commit tests), both
  Node 24 production builds/lints and 11 admin unit tests passed. Container smoke
  passed all 20 routes. Browser checks covered mock onboarding/sensor/Coach labels,
  core mobile flows (21 successful backend responses) and all four admin pages with
  a successful cross-origin health fetch from port 3200.
- User chose local checks only because GitHub CLI is not authenticated for private
  Actions logs. Remote CI success has not been asserted. No ingestion branches or
  personal playground content are included. Optional tiles/SSE remain deferred.

### Real-data integration gap audit — 2026-10-28

- Dev has processing and serving contracts but still constructs DemoRepository.
  Mock-only response literals and mandatory numeric day fields need real provenance
  and explicit missing/stale handling before switching serving to real inputs.
- Unmerged local ingestion foundation/ATRAI commits exist. Weather/UBA, openSenseMap
  and scheduler/worker/Redis drafts also remain uncommitted in their existing
  `/private/tmp/greenair-*` worktrees; preserve them before cleanup. Their historical
  contract notes describe bounded probes/replays, not continuous current coverage.
- Contracts differ: ingestion `observation.py` uses pm25/temp/ts_utc, forecast kind
  and km/h; processing `observations.py` uses pm2_5/temperature/observed_at, model kind
  and canonical m/s. Reconcile explicitly, preserving provenance and raw values.
- Next slice: preserve/review drafts, adapt contracts, register bounded source jobs,
  persist real inputs and results, and implement a real ServingRepository projection
  into day/grid/sensor contracts. Source-specific validation and real forecast issue
  policy remain required. SSE/tiles are not prerequisites. No services were started
  and no live source recheck was performed for this audit.

### Session handoff — 2026-10-28

- [NEXT.md](../NEXT.md) records the merged demo, branch/PR history, protected local
  ingestion drafts, contract conflicts and the ordered atomic commit plan for real
  data. Read it before updating stale local dev or touching temporary worktrees.
- Latest verified remote dev is `056a0c7`; the user merged the frontend integration.
  Previous entries describing it as awaiting merge are historical. The user now
  wants tested feature branches and merge instructions, rather than automatic merges.
- Preview/API processes were stopped. Existing DB/Redis were left intact. No new
  runtime was started to write this handoff; remote CI remains unverified by choice.

### Real-data foundation prepared — 2026-10-28

- Current feature branch: `feat/real-data-foundation`, based on fetched origin/dev
  `056a0c7`. Reviewed/ported explicit files; no old ingestion ancestry merged.
  [Recovery inventory](../docs/integrations/recovered-drafts.md) records all draft
  locations and dependencies. All originals remain unchanged; 21 modified/untracked
  files also have local hash-inventoried recovery archives under ignored
  `data/runtime/recovery-20261028/`. Never stage those archives.
- [Storage](../docs/integrations/raw-storage.md), [contract boundary](../docs/integrations/ingestion-processing-boundary.md)
  and [HTTP landing](../docs/integrations/raw-http.md) now exist. Recovered migrations
  plus revision 0003 retain per-value originals, explicit nulls, sensor/sample IDs,
  raw linkage and separate model issue/retrieval times. Unknown issuance stays null;
  captured builds use raw refs for identity. Wind conversion occurs once.
- Local evidence: root lint and tests passed (192 backend passed, one PostgreSQL
  test skipped offline; 12 research tests; 45 commit tests) on Node 24/Python 3.12.
  `just test-storage` passed all 25 current storage tests twice across an isolated
  PostgreSQL 17/PostGIS/TimescaleDB downgrade/upgrade cycle. Container build/health
  and all 20 HTTP routes/Swagger/OpenAPI smoke passed. No remote CI claim.
- All containers started for this work were removed. Original DB and Redis remain
  untouched/running. No providers contacted yet. Frontend/API still use mock data.
- Next: create `feat/real-data-sources` from this branch; recover weather/air,
  stationary openSenseMap and UBA adapters with fresh docs/probes and ProviderValue
  metadata. Old source job IDs differ from canonical namespaces: reconcile with
  repository source guard explicitly. Then implement registry/refresh/snapshots,
  real repository/API/frontend and verified spatial stages from NEXT.md.
- User merge order starts `feat/real-data-foundation` → `dev`, then dependent source,
  refresh, serving and spatial branches in order once prepared/tested. No branches
  pushed or merged by this work. NEXT.md and earlier handoff edits stay local.

### Real source adapters prepared — 2026-10-28 UTC / 2026-10-29 Berlin

- Branch `feat/real-data-sources` at the source validation checkpoint depends on
  `feat/real-data-foundation`. Three atomic source commits recover weather/air,
  stationary openSenseMap and official UBA adapters with ProviderValue originals.
  [Validation and next steps](../docs/integrations/real-source-validation.md).
- Fresh bounded GET checks at 22:56–22:58 UTC returned weather/air 48-slot grids,
  openSenseMap 81 boxes (30 checked stationary) and five 24-hour UBA station/channel
  samples. Exact URLs/parameters, hashes, schemas/units and UTCs are in linked notes.
  Do not reuse historical draft counts as fresh observations.
- Isolated production PostgreSQL/PostGIS/TimescaleDB replay persisted 1,125 actual
  captured values and projected 689 supported channels. Second replay added zero
  for every source. All temporary verification containers/volumes removed; original
  evidence DB/Redis untouched. Captures live only under ignored
  `data/runtime/source-check-20261028/`; never stage that directory.
- Root lint/test passed: 232 backend tests, one offline PostgreSQL skip, 12 research
  and 45 commit tests. Source sample replay is separate from offline tests/remote CI.
- Source job IDs also identify canonical rows (e.g. uba_226_1). Raw source guard,
  receipts and watermarks thus share a namespace. Provider sensor/station IDs are
  preserved independently. Model issue time stays null when unknown; decoded nulls
  remain gaps. Community indoor/outdoor exposure and sensor IDs are retained.
- Next: `feat/real-data-refresh` from sources; recover scheduler/worker, implement
  actual registry, bounded once pass, restart/locks/partial handling and persistent
  processed snapshots. Serving/frontend and all spatial work remain pending.
- User merge order: foundation → dev, sources → dev, then later refresh/serving/
  spatial branches once tested. No pushes or merges. Original handoff notes remain
  uncommitted; no original draft worktree files were changed.

### Registered refresh and persisted snapshots — 2026-10-29 Berlin

- Branch `feat/real-data-refresh` depends on sources. Registry/worker recovered in
  `29a367f`; versioned processing snapshots follow in the next commit. See
  [worker](../docs/integrations/refresh-worker.md) and
  [snapshots](../docs/integrations/processed-snapshots.md) for commands and contracts.
- `just ingest-once`, `process-results` and `refresh-once` require an explicit
  database URL. Default refresh uses recent bounded windows, PostgreSQL locks and
  durable checkpoints/outbox; no Redis or API startup polling. Partial upstreams
  still permit stored-input processing. Retry-After survives process restart.
- Canonical QC is source-specific; indoor/future measurements are excluded from
  outdoor levels. Latest model builds stay distinct from measurements and provider
  issuance remains separate from retrieval/build times. UTC day axes have 23/25
  actual DST hours; public 24-slot projection remains pending.
- Live isolated worker ran all nine jobs; second worker returned all NOT_DUE.
  Three result snapshots persisted (today complete required model coverage,
  tomorrow partial, sensors partial); second processing CLI retained identical
  IDs/build times. Portable export/reprocess matched the day build ID.
- Root checks: 252 backend passed/3 PostgreSQL skips offline; 12 research and 45
  commit tests passed. Disposable production migration cycle ran 47 tests twice,
  including real worker kill/restart and snapshot geometry/JSONB persistence.
  Container smoke passed all 20 routes. All started containers removed.
- Verification data only under ignored `data/runtime/refresh-check-20261029/`:
  14 raw captures, 1,115 canonical values and 3 snapshots in captures.sqlite, plus
  run manifests and optional Timescale dump. Never stage these files. Existing
  evidence DB/Redis remain untouched/running; original draft worktrees unchanged.
- Next branch: `feat/real-data-serving` from refresh. Generalize API/frontend
  missing/provenance contracts, implement real repository/provider selection,
  verify actual browser with captured inputs/stale/unavailable/restart. Then do
  NEXT.md spatial stages 13–15. Demo mode still serves synthetic data.
- User merge order: foundation → dev, sources → dev, refresh → dev; serving and
  spatial later when prepared. No pushes or merges. Handoff/state edits stay local.

### Stored serving and first real-data slice — 2026-10-29

- Branch `feat/real-data-serving` depends on refresh. Contract commit `29c0460`,
  provider `558a454`, UI provenance `4047ee7`; captured replay/browser verification
  follows. [Evidence and reproduction](../docs/integrations/real-serving-validation.md).
- Explicit GREENAIR_SERVING_DATA_MODE=stored plus DATABASE_URL serves immutable
  model day/sensor snapshots. Startup does not connect/poll; missing dates are 404,
  storage outages typed 503, old results retain source/retrieval/build times/stale
  labels. Default mock mode remains runnable with no infrastructure.
- Day fields/factors accept null, client sport weights remain client-side, and
  missing core channels cannot produce recommendations. Modelled air, measured
  stations and derived daylight stay separate. DST folds average only actual
  instants; spring gaps stay null. Traffic/safety stay missing. Stored grids/street
  scores are explicitly unavailable until verified spatial integration.
- UI shows per-layer source/freshness, attribution, sensor exposure/unit/channel
  times and gaps. It disables direct unverified cycling overlays in stored mode.
  Berlin dates/reminders work even in a UTC browser. Partial/no-coverage dates
  recover via date selection; stale scores are labelled stored, not Go now.
- Root lint/tests passed: 259 backend +4 PostgreSQL skips offline, 12 research,
  45 commit-tool tests. Disposable production migration cycle passed 49 tests twice,
  including captured inputs through PostgreSQL/processing/HTTP and restart/failure.
  Web lint/four unit checks/type-check/build passed on Node 24. Mock container smoke
  passed all 20 routes. Stored container preserved identical day JSON after restart.
- Production Chrome smoke passed Today/markers/all sports/Explore/Analytics/Coach,
  partial date and no-data recovery, no JS exceptions/direct source API requests.
  Replay fixtures/captures are explicitly historical (2026-10-28), visibly stale by
  actual server time; they are not current observations. Small source fixtures have
  original/selected hashes; full runtime captures remain ignored/outside Git.
- Verification artifacts: data/runtime/serving-check-20261029/final-production/;
  isolated fixture.sqlite is reproducible via just replay-real-slice. All preview/API
  containers/processes started here were stopped. Original DB/Redis remain running,
  original drafts unchanged. Handoff/state edits remain uncommitted.
- Next: feat/real-spatial-data from serving, NEXT.md steps 13–15. Recover ATRAI
  segment adapter, recheck bounded local geometry/IDs/joins/units/completeness;
  connect verified observations to grids/street scores with explicit gaps and
  confidence. Do not turn the disabled grid into city-model pollution variations.
- User merge order: foundation → dev, sources → dev, refresh → dev, serving → dev;
  spatial later once verified. Nothing pushed or merged; full goal remains active.

### Verified spatial captures — 2026-10-29

- Active branch feat/real-spatial-data from serving. Stage 13 ports the reviewed
  ATRAI adapter with bounded manual city jobs and full-capture accounting.
  [Contract/evidence](../docs/integrations/atrai-spatial.md). Live capture 07:56 UTC:
  34,241 local roads, 9,600 roughness, 1,389 overtaking, 7,154 flow; all local
  layer geometries uniquely join exact directed road coordinates plus osmid.
  Three outside-bbox records excluded. Raw bodies remain ignored.
- Primary provider code resolves roughness scale to percentage0–100 (divide100),
  contradicting guide0–1; research snapshot preserved. Histogram sums match all
  1,389 point counts. Build/observation time and cadence unknown. Offset captures
  are count-consistent, never claimed atomic provider snapshots.
- Root lint and tests: 265 backend passed/4 PostgreSQL skipped, research12,
  commit45. Processing/projection stages14–15 still pending. No API/frontend
  spatial product is enabled by merely importing these inputs.

### Spatial delivery complete — 2026-10-29

- feat/real-spatial-data: import3b6f12d, processinga7c229c, coordinated API/grid/UI
  projection and final validation complete. [Scope audit and exact merge order](../docs/integrations/real-data-delivery.md),
  [spatial contract](../docs/integrations/atrai-spatial.md), [validation evidence](../docs/integrations/atrai-spatial-validation-20261029.json).
- Full live-captured static set produces34,241 real roads and1,562 grid cells;
  roughness9,600, overtaking1,389, flow7,154. Exact directed joins only; missing
  fields remain null. Provider roughness0–100 divides100 based on checked source
  code. Unknown survey/build age and offset-snapshot limitation remain explicit.
- Stored mode reads spatial-v1 immutable results; no upstream/startup work. Capture
  reads respect processing cutoff; incomplete/future captures cannot publish.
  Segment cursors bind build/bbox. Grid polygons remain inside ingestion bounds,
  each road belongs to one cell by center, counts/IDs/methods retain aggregation.
- No qualified real spatial PM calibration in this run. Canonical mobile matching
  is tested using synthetic observations; real mobile-derived static data and
  stationary temporal-level processing are connected. City air remains a model,
  confidence0/PM-source-none are explicit, best-time/place rankings stay withheld.
  Area-level confidence is not validated. No guessed global bike timestamps/filter.
- Frontend stored surface/close-pass/flow layers use backend captures, unknown-age
  labels and blank missing values; no direct ATRAI stats/overlays. Cell inspection
  exposes missing greenery and zero confidence. Home/Coach hour recommendations
  fall back to city conditions when a cell is not recommendable. Without a spatial
  artifact, original unavailable-grid behavior still passes browser regression.
- Final checks: root lint,277 backend passed/5 PG skips offline, research12 and
  commit45; isolated production DB migrations/66 tests/downgrade/upgrade/66 tests;
  web lint/5 unit tests/type-check/build. Mock image20 GET routes passed; stored
  full-set HTTP validated all three sports, real IDs, model-air consistency and
  zero confidence.16 response fingerprints identical after restart. Production
  Chrome passed both with/without spatial inputs, no JS errors/provider requests.
- Live static capture + historical selected weather/station replay is explicitly
  labelled in evidence; old fixture values do not become current observations.
  Raw/large captures remain ignored in data/runtime/spatial-check-20261029/.
- All verification servers/containers stopped. Original DB/Redis remain untouched;
  all21 original draft hashes rechecked unchanged. No branches deleted/pushed/merged.
  STATE/NEXT handoff edits stay local. Merge into dev in order: foundation, sources,
  refresh, serving, spatial (full branch names in linked delivery note).
- NEXT.md scoped stages0–15 fulfilled with explicit data gaps, not a validated
  street-pollution product. Deferred: raw global mobile ingestion with verified
  time/city joins, survey age/cadence/license resolution, calibrated confidence,
  vector tiles/SSE/large backfills and real admin telemetry.
- Final spatial branch tip: e44ce57. Only inherited STATE.md/NEXT.md handoff edits
  remain outside commits. Ports3017/8017/8018 are closed; only original containers
  remain running. Ready for the user's ordered local merges into dev.

### Full-system e2e and local integration — 2026-10-29

- User explicitly authorized adding end-to-end coverage then merging prepared work
  locally into dev, with no push. New branch test/full-system-e2e from e44ce57.
- `just test-e2e` owns a disposable PostgreSQL17/PostGIS/Timescale database,
  private Docker network/API image, free loopback ports and production web/admin
  previews. It never reads inherited DB URLs or touches original DB/Redis.
- Dated source captures are replayed over loopback HTTP through real registry
  adapters/worker CLI, PostgreSQL, processing CLI and HTTP serving. Bright Sky is
  explicitly synthetic; selected ATRAI envelope totals model a tiny capture.
  Page-budget resume runs in a new process; upstream503/API restart/DB503/recovery
  retain committed snapshots. Browser map background is an empty test style;
  terrain requests are blocked, environmental APIs are never called.
- Production browsers cover all6 web screens, both spatial modes, device sample
  playback, saved places/preferences/reload, all4 admin screens, real CORS probes,
  endpoint add/edit/search/error recovery, configuration import/export, labelled
  CSV and mobile layout. See docs/testing.md for exact coverage and limitations.
- Original draft hashes (21 files) remain unchanged. No Git fetch/push/remote
  operation is needed for this task; remote-tracking fingerprints saved locally.
  STATE/NEXT handoff notes remain deliberately uncommitted.
- Final full `just test-e2e` passed: data/runtime/e2e-8ac1c9fd06e4/results.json.
  277 backend passed/5 offline PG skips, research12, commit45, migration66 twice,
  web5/admin11 unit checks and both builds, all system/browser/recovery checks.
  Docker Hub DNS timeout on a prior run was transient; retry passed unchanged.
- Test commit9ea8e9d merged with the five prepared branches into LOCAL dev.
  Final dev06c358f, tracked tree identical to tested test/full-system-e2e.
  Merge commits: foundation91fdd70, sourcesf78b00b, refreshbcc9783,
  serving6357d57, spatial0be74bf, tests06c358f. Main/remote refs unchanged;
  no fetch/push. Post-merge lint and all24 new commit messages passed.
- Only STATE.md/NEXT.md remain uncommitted; stash was restored and removed.
  All test-owned containers/network/image/frontend processes cleaned up.
  Existing greenair-demo-backend-1, greenair-db-1 and greenair-redis-1 left running
  untouched; no branches/worktrees deleted. User's local merge request complete.

### Frontend containers and application lifecycle — 2026-10-29

- Added apps/web and apps/admin multistage Node24 Dockerfiles, allowlisted build
  contexts, Next standalone output and app-local tracing roots. Runtime uses
  nonroot node, read-only filesystem and temporary cache for image optimization.
- Root Compose now includes backend/web/admin; frontend startup waits for API
  health. `just up` builds and waits for all3 services; `just down` tears down the
  application project without volumes. `backend-down` now stops only backend.
- Default URLs: localhost3000 web,3200 admin,8000 API. Public API URL is embedded
  at build via GREENAIR_PUBLIC_API_URL (default http://localhost:8000); custom
  frontend ports update default CORS. Default mock mode needs no DB/Redis; stored
  mode still requires explicit migrated DB/snapshots. No worker/migration startup.
- Verified final images via isolated Compose project greenair-frontend-check on
  ports3027/3227/8027: all health checks,12 HTTP/static/image checks, nonroot UID,
  CORS and real Chrome API calls across web/admin navigation, no JS errors.
  Frontend lint/unit/build passed (web5/admin11), root lint/config validation passed.
  Evidence stays ignored at data/runtime/frontend-docker-check/.
- Ran just down on the isolated project; all test containers/network removed.
  Original demo backend/PostgreSQL/Redis IDs unchanged. PostgreSQL/Redis remain
  running; original demo backend is currently stopped (not stopped by these test commands).
  No pushes or commits for this change; inherited STATE/NEXT notes preserved.

### Real data enabled in the application runtime — 2026-10-29

- Default app settings, Compose and host dev now use stored serving/live stations;
  web defaults to localhost:8000 and never silently selects synthetic data. Offline
  mock providers remain explicit tests/demos. Existing CI route smoke explicitly
  selects mock modes and skips dependencies; normal application data stays real.
- `just up` owns a dedicated persistent PostgreSQL 17/PostGIS/TimescaleDB volume,
  migrations and separate refresher alongside API/web/admin. Source cadences and
  retry/checkpoints are retained; city-only static jobs bootstrap four bounded
  pages/pass, resume offsets and recapture weekly. Spatial artifacts build hourly
  or on new street pages. `just down` preserves all stored inputs/results.
- [Runtime contract/evidence](../docs/integrations/real-data-runtime.md). Fresh
  live GETs began 09:42Z; 72 actual responses had metadata exported to ignored
  data/runtime/real-runtime-20261029/live-captures.json. Bodies/manifests remain in
  the new application DB. Original greenair-db/Redis remain untouched/running.
- Full capture yields 34,241 roads and 1,562 cells; 9,600 surface, 1,389 close-pass,
  7,154 flow records. Current sensors 22; live network status 14 boxes (6 online,
  7 stale, 1 without data) at this check, not a standing availability guarantee.
  Weather/modelled air succeeded; community/Bright Sky/UBA retain actual gaps.
- Important fresh-input finding: enough shared stationary hours now produce
  station-IDW PM estimates on 4,449 roads. These are derived estimates, not street
  measurements; API/UI wording distinguishes them and calls confidence an
  unvalidated heuristic. Grid confidence remains 0 and area recommendations false.
- Admin Overview/Source data/CSV use real stored counts, refresh status and builds
  via `/api/v1/data-status`. Missing client uploads/request analytics remain null,
  not generated. Production wearable sessions are hidden; real Bluetooth waits
  for hardware readings. No native watch/cloud upload service is invented.
- Final lint/test passed: 281 backend/5 explicit offline PG skips, research 12,
  commit 45; frontend lint/unit/build (web 5/admin 11). Full e2e passed at
  data/runtime/e2e-1d8a69f0ca34/ (includes migration 66 twice); final production
  browser/recovery repeat e2e-483f91547654 also passed. Both cleaned owned resources.
- Default-stack live Chrome checks passed all 6 web/all 4 admin screens, actual
  API/CORS/provenance, no sample devices, source CSV, persistence and mobile; no
  JS errors in final builds. One earlier image had a nonreproduced hydration
  warning; final rebuilt images and repeated browser runs were clean.
- Actual `just down` → `just up` preserved every prior build ID/raw count and all
  roads; final HTTP checked forecast day, measured sensors, mixed static grid and
  live station status. Evidence: ignored real-runtime-20261029/persistence-results.json.
  Application stack intentionally left running at 3000/3200/8000, DB 55433; only
  debugging/test services stopped. Changes remain uncommitted; nothing pushed.


### Endpoint health verification and provider independence — 2026-10-29

- User broke the admin's backend URL and saw third-party rows stay healthy. This
  is expected: weather/air call Open-Meteo, cycling calls ATRAI, search Photon,
  map OpenFreeMap directly. They do not route through the configured greenAir URL.
  None of those rows is a synthetic service; health does not prove ingestion or
  fresh measurements. Models/static captures retain their existing labels.
- Fixed a real false-positive path: no-cors opaque responses previously recorded
  ok=true and could appear Healthy even for hidden HTTP404/500. New Unverified
  status (also for old stored opaque results) excludes them from healthy totals
  and uptime. Actual verified HTTP errors remain Offline. Rows display source and
  resolved host; list text explains independent provider vs backend checks.
- Backend URL changes clear affected old probe history, preserve external history,
  and discard delayed old-URL/out-of-order results. Browser regression held a real
  HTTP200 response while replacing the backend URL, observed new404 and confirmed
  the delayed old success could not overwrite it. A separate actual HTTP404 server
  without CORS produced Unverified while a readable provider200 stayed Healthy.
- Live provider/body audit: backend day forecast source=forecast, sensors measured,
  stored status real; weather/air/ATRAI/Photon JSON200. Fresh production Chrome
  checked all five configured external providers HTTP200, including OpenFreeMap
  (command-line probe got403: client/environment differs). One full-grid browser
  probe hit the configured8s timeout; it correctly stayed failed, not synthetic
  success. Full grid inputs/results are still persisted real captures.
- Evidence remains ignored at data/runtime/real-runtime-20261029/endpoint-audit.json
  and health-check/ (actual provider results, controlled HTTP regression, screenshot).
  Admin13 unit tests, lint/typecheck and production Docker build passed; targeted
  actual Chrome regression passed without JS errors. No remote changes or commits.

### Atomic publication authorized — 2026-10-29

- User subsequently requested atomic commits, merge into dev and push. This
  explicitly supersedes the earlier local-only/no-push preference for this work.
- Implementation is organized on feat/real-data-runtime: API status, persistent
  real runtime, explicit web demo opt-in, spatial estimate wording, endpoint
  health verification, actual admin pipeline monitoring, then documentation.
- Latest admin verification passed lint,13 unit tests, typecheck and production
  build; root hooks remain active. Prior full source/storage/browser e2e and the
  actual broken-backend/CORS/race browser checks are linked in the entries above.
- Local runtime captures, credentials and playground are excluded. Only dev is
  selected for publication; feature branches/worktrees are retained.

### Admin environmental conditions — 2026-10-29

- The dedicated `/environment` sidebar tab shows measured NO2/PM2.5/PM10/O3, forecast weather,
  hourly model charts, station filters and tagged network counts, using existing
  serving routes. [Contract and dated evidence](../docs/integrations/admin-environment.md).
- Per-channel observation age governs stale labels; zero/missing/QC semantics,
  indoor/outdoor exposure, provider identity and model/measurement distinctions
  remain explicit. Stored inventory and GreenCityHN network are different populations.
- No new data adapter or measurement-history API. O3/PM10 forecasts remain absent
  from the day serving contract. Actual city-only station coverage remains limited;
  surrounding locations are labelled. Browser artifacts remain ignored.
- Validation: `just check-admin` passed lint,17 unit tests and production build;
  root `just lint` passed. Rebuilt local admin container is healthy on port3200.
  Production Chrome passed real data/official+indoor filters/forecast values,
  mobile overflow and independent503 station/404 forecast failure states; no JS
  errors. No new upstream availability or historical measurement coverage claim.

- User layout correction: environmental content lives only in its own sidebar tab;
  Overview keeps its compact endpoint workspace and Source data keeps pipeline
  monitoring. Mobile navigation includes the new tab as Environment.
