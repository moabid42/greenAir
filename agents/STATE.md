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
