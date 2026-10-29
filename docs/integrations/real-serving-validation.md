# First real-data slice verification — 2026-10-29

`feat/real-data-serving` contains the nullable/provenance contract, stored repository,
frontend labels and captured-response integration checks. It depends on refresh,
sources and foundation. User merge order, each into `dev`:

1. `feat/real-data-foundation` → `dev`
2. `feat/real-data-sources` → `dev`
3. `feat/real-data-refresh` → `dev`
4. `feat/real-data-serving` → `dev`

Nothing was pushed or merged. Original draft worktrees and handoff edits remain
preserved. This slice serves real captured/modelled weather and air plus stationary
measurements; verified spatial grids/street scores are still pending NEXT.md 13–15.

## Evidence and limits

- Source discovery, current-provider documentation and bounded live ingestion are
  recorded in the [source checkpoint](real-source-validation.md) and
  [worker note](refresh-worker.md). This verification replays those **dated real
  responses**, not new current observations. Fixtures never gain a new retrieval
  timestamp. Modelled air remains distinct from official and community measurements.
- The small committed fixture under `services/backend/tests/fixtures/real-slice/`
  includes exact weather/air/UBA captures and one explicitly selected unmodified
  outdoor box from a captured bbox response. Its manifest records original request
  parameters/retrieval times and both full-response and fixture hashes. Raw runtime
  captures and database volumes remain outside Git.
- `test_real_slice_replay.py` exercises raw landing → adapters → canonical storage →
  processing/QC → immutable snapshots → actual HTTP. It makes the upstream fail,
  checks unchanged observation/last-success progress, then recreates the repository
  and API and verifies stale last-success data and explicit no-coverage errors.
- The same captured path runs against disposable PostgreSQL/PostGIS/TimescaleDB,
  not only SQLite. `just test-storage` passed **49 tests twice** across the full
  downgrade/upgrade cycle, including source locking, killed-worker recovery,
  captured replay and persisted snapshot/API reads.
- Root lint/test passed: 259 backend tests and four explicit PostgreSQL skips
  offline, 12 research checks and 45 commit-tool tests. `just check-web` passed
  lint, four missing-data/timezone tests, type checking and production build on
  Node 24. No remote CI result is asserted.
- Container mock smoke passed all 20 documented GET routes, Swagger/ReDoc/OpenAPI,
  compression/CORS/errors. The hardened nonroot stored-mode image was then run with
  a read-only replay store. Its day body/build/time were identical after a real
  container restart; its grid stayed explicitly unavailable and sensors measured.
- Chrome production-browser checks passed Today, actual station marker details,
  all three sports, disabled unconnected cycling layers, Explore playback, Analytics
  with missing dates, Coach declining street/park ranking, partial tomorrow and
  an out-of-horizon date with date-picker recovery. The browser timezone was UTC
  and its fixed instant crossed Berlin midnight, proving explicit Berlin selection.
  No page exceptions or direct Open-Meteo/ATRAI requests occurred. Expected 404s for
  uncovered dates were handled. Unknown traffic and missing values were visible;
  no dummy fallback, NaN or Infinity was rendered.
- Screenshot/report artifacts remain under ignored
  `data/runtime/serving-check-20261029/final-production/`. The retained data were
  stale by the real server clock during this check and visibly labelled as such.
  [Machine-readable summary](real-serving-evidence.json) separates capture scope,
  browser checks and container restart evidence.

## Reproduce the bounded replay

This uses historical fixtures and creates a NEW local file; it is not live refresh.

```sh
just replay-real-slice                 # refuses to overwrite an existing file
just backend-build
# Run the built image with a read-only mount of the absolute replay file:
docker run --detach --name greenair-replay --publish 127.0.0.1:8010:8000 \
  --mount type=bind,source="$PWD/data/runtime/real-slice.sqlite",target=/data/replay.sqlite,readonly \
  --env GREENAIR_SERVING_DATA_MODE=stored \
  --env GREENAIR_DATABASE_URL=sqlite:////data/replay.sqlite \
  --env 'GREENAIR_CORS_ORIGINS=["http://localhost:3010"]' \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  greenair-backend:demo
NEXT_PUBLIC_API_URL=http://localhost:8010 NEXT_PUBLIC_ECOMAB_API_BASE_URL= just check-web
PORT=3010 just preview-web             # separate terminal; stop before rebuilding
just smoke-real-browser               # needs installed Chrome or Playwright Chromium
# Stop only the preview you started, then:
docker rm --force greenair-replay
```

The optional browser task uses pinned Playwright 1.61.0 outside application runtime
dependencies. It uses installed Chrome on macOS, otherwise an installed Playwright
Chromium. It writes only local reports/screenshots. It does not contact source APIs
or prove their current availability. For real refresh, select an explicitly migrated
PostgreSQL database and use `just refresh-once`; see the worker/snapshot notes.

API/frontend contracts and staleness/DST policies are documented in
[the serving contract](real-serving-contract.md). Spatial coverage, confidence,
verified joins and non-synthetic street scores remain required work.
