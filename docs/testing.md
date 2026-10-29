# Local end-to-end verification

Use Node 24 (`.nvmrc`), Python 3.12+, uv/just from the development pins, Docker,
and the locked root/web/admin dependencies (`just setup`, `just setup-web`,
`just setup-admin`). Then run from the repository root:

```sh
just test-e2e
```

The runner executes lint and existing unit/processing e2e tests, the disposable
PostgreSQL 17/PostGIS/Timescale migration cycle, both frontend lint/test/production
builds, the containerized mock/stored APIs, and production browser tests. It uses
Google Chrome when installed on macOS, otherwise Playwright's Chromium. Install
that browser if needed:

```sh
uv run --no-project --with playwright==1.61.0 python -m playwright install chromium
```

No remote Git operation, real environmental request, real Bluetooth connection,
notification permission, model download or deployment is part of this command.
Package/image/font dependencies may need network access during setup/build. Runtime
browser map services use an explicitly empty test style; the application, API,
worker, PostgreSQL and MapLibre overlays are real processes.

## Coverage

| Boundary | End-to-end assertions |
| --- | --- |
| Source → HTTP landing → worker → PostgreSQL | Captured Open-Meteo weather/air, openSenseMap and UBA responses; explicitly synthetic Bright Sky; source-specific records, hash-checked inputs and real CLI jobs |
| Pagination and restart | Selected ATRAI road/static captures; a one-page worker exits partial, a separate worker resumes the frozen capture at offset 1; completed polling adds no raw pages |
| Stored processing | Separate CLI builds day/sensor/spatial snapshots from those persisted records, retaining explicit missing PM coverage |
| Mock API | Hardened production image, all 20 documented GET routes, Swagger/ReDoc/OpenAPI, gzip, CORS, errors and synthetic labels |
| Stored API | Actual HTTP responses from PostgreSQL, nullable values, measured markers, matching road IDs, all three sports, city-model consistency, zero spatial confidence and withheld best times |
| Web without spatial results | Onboarding, Berlin date in a UTC browser, provenance, sensor inspection, sports, disabled street layers, Explore playback, Analytics, Coach, partial/missing dates and recovery |
| Web with spatial results | Historical layers, a selected road-cell inspection, missing greenery/zero confidence, saved-place controls and withheld rankings |
| Devices and Me | Explicit sample-device playback, browser-only preferences and saved-place persistence/removal; no hardware permission requested |
| Admin | All four pages, actual cross-origin backend probes, add/edit/search endpoint, HTTP 404 → HTTP 200 recovery, reload persistence, stored source-status CSV and unavailable client analytics, settings/configuration import/export and invalid JSON, mobile navigation/layout |
| Upstream failure | A fixture HTTP 503 leaves the last committed checkpoint/snapshot intact; API restart returns identical day/grid/sensor content |
| Database outage | Only the disposable DB is stopped: process health stays 200, day returns typed 503, DB restart reconnects and preserves results |

The existing focused tests also cover UTC/DST gaps/folds, QC/nulls, normalization,
scoring formulas, geometry/joins, bounded retries/bytes, locks, outbox and worker
kill/restart. This is coverage of implemented features and important failure paths,
not a claim of exhaustive branch coverage or external-provider availability.
Unimplemented tiles/SSE/admin ingestion and real device/service integrations are
outside the suite.

## Isolation and artifacts

Each run creates unique Docker resource names, a private network and an empty
production database. It never uses `GREENAIR_DATABASE_URL` or
`GREENAIR_TEST_DATABASE_URL` inherited from the caller. API mode, database URLs and
frontend addresses are selected explicitly. Existing DB/Redis, worktrees, captured
archives and browser profiles remain untouched. Services bind free loopback ports.
The runner removes its containers/anonymous DB volume/network/image and stops its
own frontend process groups on success or failure; logs/screenshots remain in a
new ignored `data/runtime/e2e-<id>/` directory. `results.json` records checks,
fixture requests/counts and cleanup status. `--output NEW_DIRECTORY` selects another
artifact directory. `--skip-checks` is for debugging after checks have already run;
it still builds both production frontends and runs the system scenarios.

Fixtures are dated test inputs, not new observations. ATRAI envelopes intentionally
rewrite counts around selected real features; they cannot establish complete live
coverage. See [the source replay notes](integrations/real-serving-validation.md)
and [spatial evidence](integrations/atrai-spatial.md). The fixture HTTP landing time
records the test replay only; original observation times and captured-file hashes
are retained. Test freshness does not establish current source freshness.

## Verified local run — 2026-10-29

`just test-e2e` passed in full. Root checks: 277 backend tests passed, five
PostgreSQL-only checks skipped in the offline run, 12 research-tool tests and
45 commit-tool tests. The disposable migration cycle passed 66 tests twice.
Web passed five unit tests and admin passed 11; both lint/type-check/build steps
passed. Container/API/source/processing/browser/failure/recovery scenarios all
passed, with no browser JavaScript errors. The runner confirmed cleanup of its
owned resources. Artifacts remain ignored at
`data/runtime/e2e-8ac1c9fd06e4/`; `results.json` and browser reports record the exact
scenarios. A preceding attempt encountered a Docker Hub DNS timeout and cleaned
up correctly; the successful retry required no application change.
