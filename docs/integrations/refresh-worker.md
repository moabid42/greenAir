# Bounded registered source worker

`python -m app.ingestion.worker` runs independently from FastAPI. The default
registry now contains weather, modelled air, openSenseMap, Bright Sky and the five
checked UBA station/channel jobs. Contracts and provider evidence are linked in
[the source checkpoint](real-source-validation.md); no new provider contract is
inferred by scheduling. Cadences are application choices: weather/UBA hourly,
modelled air every three hours, openSenseMap five minutes, Bright Sky 30 minutes.

Set GREENAIR_DATABASE_URL explicitly, run `just migrate`, then `just ingest-once`.
Use `--source ID` to limit a pass. Normal windows look back one day to collect
late arrivals, rather than starting a campaign backfill. Explicit `--backfill`
uses GREENAIR_CAMPAIGN_START; the command still stops at the page budget (four per
source by default) and resumes its persisted window next time. Latest-only feeds
do not claim historical backfills. No source is registered or polled by API startup.

Source advisory locks span retrieval and page commits. Every HTTP attempt lands
before decode. Canonical rows, receipts, manifests, outbox and checkpoints commit
atomically. Windows, pagination cursors, due times and source failures survive
restart. Long Retry-After deferrals persist and also apply to manual backfills.
Missing/invalid checkpoints cannot mark a parse failure as last success. A failed
job is reported without preventing independent jobs from running. Partial channels
stay partial; no dummy fill or zero substitution occurs.

The default bus is `none`: durable outbox rows remain pending. Snapshot processing
reads stored records directly, so Redis is not required. `--bus memory` is a test
sink only. Redis transport remains in the preserved draft for future recovery.
The existing broker/evidence database are never modified by the verification runner.

Validation: portable scheduler tests cover due times/manual runs, page-budget
restart, HTTP/decode/manifest failures, persisted rate limits and independent jobs.
`just test-storage` also runs the real worker SIGKILL/restart test in disposable
PostgreSQL, verifies a second process cannot acquire its source lock, and checks
exact resumed offsets with no lost or duplicate values. The full migration cycle
passed 39 tests before and after downgrade/upgrade on 2026-10-29 Berlin.

A bounded live worker pass against another isolated migrated database ran all nine
registered sources. Both model jobs succeeded; community/Bright Sky/UBA jobs were
partial due to actual missing channels/hours. A second worker process returned
NOT_DUE for all nine. Raw responses, run results and the disposable DB export are
retained under ignored data/runtime/refresh-check-20261029/. These are live worker
results, distinct from synthetic restart tests and from verified API/frontend data.
Processed snapshots and serving still need their own validation.
