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
