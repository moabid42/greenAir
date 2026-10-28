# Stored-input processing and result snapshots

`just process-results` processes already stored observations without contacting
providers. Default scope is today's and tomorrow's Berlin dates plus latest sensors;
`--date YYYY-MM-DD` builds one day plus sensors. `just refresh-once` runs the bounded
registered ingestion pass, then processing even when some upstream jobs report
partial coverage. It exits nonzero for partial ingestion or unavailable results.
GREENAIR_DATABASE_URL must explicitly select a migrated database. Workers and
processing remain separate entrypoints from API startup.

## Inputs and semantics

[Source contracts](real-source-validation.md) retain catalog/reference citations,
provider originals and dated live evidence. `ResultRepository` reads canonical rows
with raw retrieval timestamps and PostGIS geometry. Day reads are bounded by the
actual UTC interval for a Berlin date and an explicit maximum row budget. Exceeding
the budget fails without publishing silently truncated results. Sensor reads use
SQL latest-per-source/station/phenomenon/sensor ranking, not a history transfer.

`conditions-v1` artifacts retain raw references, original values/units, separate
observation/retrieval/provider-issue times, platform, sensor identity and exposure.
Build time belongs to the result snapshot and never replaces provider issuance.
Only the latest captured model run per source within a day's inputs is selected;
revisions are never averaged. Nulls and QC-blocked values produce missing coverage.
Unsupported channels and unprojectable legacy records remain in storage and are
counted as explicit issues; they are not guessed or silently treated as clean data.

The existing QC code now accepts canonical observations without reconverting their
provider originals. Range checks apply to all sources. Community humidity/stuck
checks are restricted to openSenseMap, and stuck runs are per sensor. Smooth models
and official station records do not inherit community sensor rejection rules.
Indoor and future-dated measurements are excluded from outdoor hourly city levels;
indoor sensors remain identifiable in sensor artifacts. Model time series stay
separate from measured hourly medians. No calibration or forecast bias correction
is claimed without evidence, and no synthetic traffic/safety/spatial score is built.

Day artifacts contain exact UTC instants: Berlin DST transition days have 23 or 25
hours. Serving will explicitly project these to the client's 24 wall-clock slots,
without fabricating timestamps or duplicating source records. This artifact contract
is separate from the public factor API; API/frontend changes are the next stage.
Coverage counts require temperature, humidity, wind, PM2.5 and NO2 for each actual
instant. SUCCESS means those model channels cover the day, not that all readings
are measured or every possible channel exists. Missing slots remain explicit.

## Persistence and failure behavior

Migration 0004 creates immutable versioned result snapshots. Build IDs combine a content fingerprint
with the resource key and algorithm/schema version. Unchanged
inputs return the original snapshot/build time on restart. Algorithm changes must
bump the version. Source locks prevent concurrent processing of the same resource.
Payloads include precise model/measurement provenance and QC/unsupported issues.
No available values yields UNAVAILABLE. Latest-serving lookup excludes unavailable
builds so an empty later attempt does not destroy last-success data. Retrieval ages
and source checkpoint status remain available for serving freshness/failure labels.
Historical snapshots are retained; no implicit 2020–2100 horizon is asserted.

## Validation

Offline tests exercise latest-run selection, original wind units and null versus
zero, sensor latest ranking, indoor/future exclusion, source-specific QC, DST axes,
input-budget failure, immutable restart and unavailable versus last-success lookup.
`just test-storage` validates actual PostGIS/TimescaleDB reads and JSONB artifacts,
worker kill/restart and all migrations through downgrade/upgrade: 47 tests passed
twice on isolated PostgreSQL. This is distinct from live provider availability.

[Live processing evidence](processing-live-evidence.json) records two separate CLI
runs against the fresh worker's isolated database. 2026-10-29 has complete required
model coverage; 2026-10-30 is partial at the captured forecast horizon. Sensor
results are partial due to unsupported/missing inputs. The second CLI returned
identical build IDs and original build times. Actual payloads/raw inputs and a DB
export are retained only under ignored data/runtime/refresh-check-20261029/.
The app still serves mock data until the real repository/API/frontend stage.

Root lint/tests also passed: 252 backend passed, three explicit PostgreSQL tests
skipped offline; 12 research-tool and 45 commit tests passed. The containerized
demo smoke passed all 20 routes/Swagger/OpenAPI without database/broker startup.
All verification containers were removed after exporting a portable SQLite capture
and canonical/snapshot store (1,115 values, 14 raw responses, three snapshots).
Reprocessing the portable export reproduced the same day build ID. The original
PostgreSQL evidence database and Redis remain running and untouched. A full
PostgreSQL dump is also local; TimescaleDB emitted its usual circular-constraint
restore warning, so use the verified portable capture/replay for straightforward
future smoke checks instead of assuming a plain pg_restore needs no extension setup.
