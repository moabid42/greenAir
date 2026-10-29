# Real source validation checkpoint

The `feat/real-data-sources` branch depends on `feat/real-data-foundation`.
User merge order: foundation → dev, then sources → dev. No branch was pushed or
merged. Original temporary worktrees and existing evidence DB/Redis are preserved.

## Verified on 2026-10-28 UTC (2026-10-29 Berlin)

- Current provider documentation and bounded GET captures are recorded separately
  for [weather/modelled air](weather-sources.md),
  [stationary sensors](osem-source.md) and [official UBA measurements](uba-source.md).
- All nine captured source responses were landed into an isolated PostgreSQL 17
  container after applying production migrations, decoded, and persisted with
  manifests, receipts and checkpoints. [Replay evidence](source-postgres-replay.json)
  records image digest, extensions, capture hashes and counts. Stored PostGIS
  coordinates and row counts were checked. This was a fresh storage replay of
  dated captures, not another upstream fetch.
- Total: 1,125 canonical values; 689 channels supported by the existing processing
  contract projected with real provenance. Other channels remain stored, with no
  invented processing mapping. Second replay inserted zero rows for every source.
  Unknown model issue times remain null; measured/modelled values stay distinct.
- Root `just lint` and `just test` passed on Node 24/Python 3.12: 232 backend passed,
  one explicit PostgreSQL integration test skipped offline, 12 research-tool tests,
  and 45 commit-rule tests. PostgreSQL capture replay is separate evidence from
  those offline tests. No remote CI claim is made.
- The disposable replay container and its volume were removed. No API/frontend
  server was started. Only the pre-existing DB/Redis remain running.

## Still required

Adapters do not run themselves. Registry, bounded worker pass, refresh persistence,
processed snapshots, real ServingRepository, missing/provenance API/frontend changes,
browser end-to-end verification and spatial replacements remain unimplemented.
The app still serves mock data. Next branch: `feat/real-data-refresh` from sources.
The preserved scheduler/worker draft is the starting point; it still needs an actual
registry and adaptations to the ported source IDs/contracts. Keep workers outside
API startup and preserve last-success data when upstreams fail.
