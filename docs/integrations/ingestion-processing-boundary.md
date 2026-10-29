# Ingestion to processing boundary

The recovered adapter/storage vocabulary remains separate from the established
processing contract. `app.processing.ingested.project_observation` maps validated
persisted values without applying the provider conversion twice. No live source
claim is made by this boundary; all regression data here is explicitly synthetic.

| Ingestion | Processing |
| --- | --- |
| `forecast` | `model` |
| `temp`, `rh`, `pressure_msl`, `pm25` | `temperature`, `relative_humidity`, `pressure`, `pm2_5` |
| `ts_utc` | `observed_at` |
| WGS84 Point `geom` | `longitude`, `latitude` |
| `wind_speed` km/h | m/s (divide canonical value by 3.6 once) |
| `precip` mm | mm/h only with verified 3600-second interval |
| `raw_ref`, `issued_at` | preserved unchanged; retrieval comes from raw landing |

ProviderValue stores platform, sensor/sample identity and original key/value/unit
alongside the canonical value. It is JSONB on each stored observation. Missing
values remain null; zero remains zero. Legacy rows lacking these originals remain
replayable but cannot be projected by guessing metadata. Unsupported channels and
line geometries remain in storage and fail projection explicitly. The boundary
projects canonical values; subsequent processing/QC remains the caller's job.

Mobile observations require a stable sample ID. Canonical IDs incorporate sensor
and sample identity, so parallel sensors and coincident moving samples survive.
The database uses the deterministic canonical ID plus time partition for uniqueness;
its older station/time constraint was too coarse. Legacy stationary measurement
hashes are unchanged. Processing keys now also include sensor and model issuance.

Unknown provider model issuance is null, independent of retrieval and application
build time. The adapter must never use `generationtime_ms` as issuance. A model
capture without issue time uses its raw reference for build identity, preventing
separate captured runs from collapsing while replay of the same capture deduplicates.
Known issue times distinguish revised runs. This policy does not claim that retrieval
is the start of a model run. API freshness must use retrieval separately.

Revision 0003 preserves existing rows and adds nullable values/provenance. Its
reverse migration fails rather than discards nulls, unknown issuance or distinct
samples that cannot satisfy the older schema. Production migrations require an
explicit database URL. Do not downgrade evidence data to force compatibility.

Validation: synthetic regressions exercise storage → projection, adapter-converted
Kelvin values with originals retained, wind units, nulls/zero, mobile/sensor identity,
unknown model issuance, Berlin DST folds and rejected naive times, unsupported
channels and unverified rain intervals. Published processing JSON schemas are
regenerated with the models. PostgreSQL tests exercise the actual hypertable's
nullable values, JSONB provenance and sample identity in the migration-cycle runner.

Next: recover landed HTTP handling, then adapt each source to populate ProviderValue
from its checked contract. Source job IDs may differ from provider namespaces in
old drafts; reconcile these explicitly before calling the repository's source guard.
No source adapter or real serving provider is enabled by this change.
