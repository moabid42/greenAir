# Real-data delivery and merge order — 2026-10-29

The scoped roadmap now has a verified source → raw storage → canonical records →
versioned processing → API → frontend path, including partial real spatial results.
Default mock mode remains runnable independently. Real mode is explicit and workers
remain separate. The user merges these prepared local branches into `dev`, in order:

1. `feat/real-data-foundation` (tip `2a738a0`)
2. `feat/real-data-sources` (tip `1aa04a8`)
3. `feat/real-data-refresh` (tip `deda7fc`)
4. `feat/real-data-serving` (tip `277c0a0`)
5. `feat/real-spatial-data` (the spatial import/processing/serving commits)

Each later branch includes its predecessors. Nothing was pushed or merged; no
branches/worktrees were deleted. Handoff/STATE notes stay uncommitted. Runtime
captures, experiments, original database/Redis and original draft files are preserved.
Twenty-one original draft hashes were rechecked unchanged at completion.

## Scope audit

| Roadmap stage | Delivered evidence |
| --- | --- |
| 0 preservation | `ea323d1`; [draft inventory and boundaries](recovered-drafts.md) |
| 1 storage | `cccf2a6`; [raw storage/migrations](raw-storage.md), disposable production DB cycle |
| 2 reconciliation | `0516085`; [explicit ingestion/processing boundary](ingestion-processing-boundary.md) |
| 3 bounded landing | `2a738a0`; [HTTP contract](raw-http.md), retries/limits/raw-first tests |
| 4 weather/modelled air | `c0d9d7b`; [weather contract and live evidence](weather-sources.md) |
| 5 stationary sensors | `d9f47e2`; [openSenseMap contract](osem-source.md) |
| 6 official reference | `4148fea`; [UBA contract](uba-source.md) |
| 7 repeatable refresh | `29a367f`; [registry, checkpoints, locks and restart](refresh-worker.md) |
| 8 stored processing | `deda7fc`; [versioned day/sensor artifacts](processed-snapshots.md) |
| 9 API missing/provenance | `29c0460`; [nullable contract](real-serving-contract.md) |
| 10 real repository | `558a454`; explicit stored provider, no startup fetch/query, 404/503/stale behavior |
| 11 honest frontend | `4047ee7`; city models, measured station channels and missing data distinguished |
| 12 source-to-browser | `277c0a0`; [captured replay and browser evidence](real-serving-validation.md) |
| 13 verified spatial import | `3b6f12d`; [full city capture and exact directed joins](atrai-spatial.md) |
| 14 spatial processing | `a7c229c`; real mobile-derived static inputs, stationary UTC levels and explicit absent PM evidence |
| 15 spatial serving | coordinated API/grid/frontend projection; [full-set HTTP/browser/restart evidence](atrai-spatial-validation-20261029.json) |

## Limits retained in the delivered product

This is not a validated street pollution survey. Raw global ATRAI mobile event
timezones/city joins are unresolved, so no million-row export or guessed mobile
pollutant calibration is enabled. Real mobile-derived static layers are connected;
canonical mobile matching is tested separately with explicitly synthetic values.
The checked live static capture has no qualifying spatial PM measurements or station
ratio history. All street PM confidence is zero and place rankings are withheld.
City air remains a model, official/community station values remain measurements.

Provider survey/build time, rebuild cadence and dataset redistribution license
remain unknown. Offset capture accounting cannot prove an atomic upstream snapshot.
Raw hashes, original units/properties, capture time range and exact join decisions
retain those uncertainties. Roughness0–100 is justified by the checked provider
implementation, not a guessed scale or a rewritten research snapshot.

Production verification combines live-captured static layers with explicitly dated
first-slice weather/station replay, visibly stale by the actual server clock. It
does not relabel old fixtures as current observations. Local checks passed; remote
CI was not used. Large backfills, calibrated recommendations, vector tiles, SSE and
real admin telemetry remain outside this roadmap's requested delivery.
