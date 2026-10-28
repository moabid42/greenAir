# Recovered ingestion drafts — 2026-10-28

Inspected all eight pre-existing worktrees before changing branches. Remote dev
was fetched at `056a0c7`. New work starts from that commit on
`feat/real-data-foundation`; no ingestion ancestry or playground commits are merged.

| Original worktree suffix (`/private/tmp/greenair-`) | Base | Recovered draft |
| --- | --- | --- |
| weather-adapters | 6410850 | Weather/UBA adapters, two tests, two contract notes, observation vocabulary diff |
| osem | 6410850 | Stationary adapter, tests, two contract notes |
| scheduler | 6410850 | Scheduler, worker, Redis bus, tests and worker fixture |
| probes | 842912b | Probe CLI, source config and two evidence manifests |
| atrai-raw | 6410850 | Clean committed ATRAI/foundation code |
| static | 6410850 | Clean; no static adapter draft |
| frontend-review-r24kxpx1 | 17fd270 | Untracked frontend review script |

Original worktrees and branches remain unchanged. Hash-inventoried recovery
archives of all 21 modified/untracked files are stored locally under ignored
`data/runtime/recovery-20261028/`, outside `/tmp`. These archives are recovery
copies, not reviewed implementation commits; never stage them. The pre-existing
DB and Redis are still running; no services were started for this inventory.

## Review and port boundaries

Foundation `842912b` and receipt fix `642ad44` contain reusable storage, contracts,
migrations and tests. Port explicit files rather than their unrelated ancestry,
old Docker/Compose files or personal documentation. Keep the current nonroot demo
API independent of database/Redis. Storage imports neither workers nor adapters.

Weather/UBA and openSenseMap drafts depend on the singular ingestion observation
schema, receipt accounting, landed-response wrapper and source watermarks. Weather
adds `european_aqi` (`EAQI`). Model issue time requires a caller-supplied resolver;
no production issue policy exists. Provider originals currently live in raw bytes,
while processing expects per-value identity and provenance. Reconcile this boundary
before porting adapters; the existing natural key does not distinguish moving
samples at the same station/time. Null channels require explicit accounting.

Scheduler uses these same storage contracts and PostgreSQL advisory locks. Its
worker references a registry that does not exist. Redis delivery is optional;
none of these drafts establishes a configured running pipeline. Probe manifests
refer to historical raw DB IDs; preserve that database. Draft tests and historical
probe claims have not been rerun by this inventory and are not live verification.

Next: port and test foundation on a disposable database, reconcile observations,
then recover adapters in separate behavior commits after fresh bounded probes.
