# Raw-first storage foundation

Ported explicit storage files from `842912b` plus receipt accounting `642ad44`;
no old branch ancestry, provider adapter, Compose or Dockerfile was imported.
This foundation makes no live availability or geographic coverage claim.

`Repository.land_raw` commits exact response bytes, request method/parameters/body,
response headers/status, retrieval UTC, error and SHA-256 before parsing.
`ingest_page` atomically commits canonical records, feature receipts, outbox entries,
manifest and checkpoint. Parse failures retain raw evidence. Duplicate canonical
identities keep the first value and emit no extra event. Unresolved feature receipts
can be resolved by replay; terminal receipts remain stable. Outbox delivery is
at least once with stable event IDs; no broker runs or is required here.

PostgreSQL migrations install PostGIS and TimescaleDB and create the observation
hypertable plus segment/layer history. SQLite is used only for transaction tests;
it does not verify extension behavior. The initial observation vocabulary and
natural key are the recovered ingestion contract, pending the explicit processing
boundary commit. In particular, do not ingest mobile samples through the initial
station/time identity. Originals remain available in raw bytes; per-value provider
identity and model issue-time semantics still need reconciliation before adapters.

## Commands and validation

Use `GREENAIR_DATABASE_URL=... just migrate` only after explicitly selecting a
database. There is no implicit migration URL and API startup never migrates or
connects. Existing demo Compose and nonroot container runtime are unchanged.
The ingestion database is operated separately from the demo API.

`just test-storage` creates a unique disposable container from a pinned
PostgreSQL 17 / TimescaleDB / PostGIS image, publishes a random loopback port,
upgrades from empty, exercises raw replay/idempotency/geometry/history/recovery,
downgrades to base, verifies table removal, upgrades and repeats the tests.
It removes only its own container and disposable volumes, including on failure.
Docker is required; this check is separate from portable `just test`.

Validation on 2026-10-28: `just test-storage` passed all 26 foundation tests
both before and after the downgrade/upgrade cycle, including actual extension/
hypertable, WGS84 coordinates and a cross-source rejection regression. The latter
rejects checkpoint advancement while retaining raw bytes. Root lint passed; root
backend tests passed 169 with the explicit PostgreSQL test skipped offline.
No data provider was contacted; these checks do not verify any source contract.
