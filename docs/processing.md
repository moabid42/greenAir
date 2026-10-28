# Processing

This document covers the **Processing** box of the [architecture diagram](research.md):
normalizer and QC, temporal and spatial builders, forecaster and scoring engine.
Ingestion (scheduler, adapters, raw landing) is owned separately; this box starts
at the `observations.raw` boundary and ends at `scores.updated`.

All code is plain Python in `services/backend/app/processing` and
`services/backend/app/scoring`, without a database or broker. End-to-end tests in
`services/backend/tests/e2e` run each stage from fixture files on disk.

## Observation contract (ingestion -> processing)

Adapters emit one [`RawObservation`](contracts/raw-observation.schema.json) per
provider value. The normalizer produces [`Observation`](contracts/observation.schema.json).
Both are defined in `app/schemas/observations.py`; the JSON Schema files are
generated from it (`uv run --locked python -m app.schemas.export_contracts` in
`services/backend`) and a test fails when they are out of date.

| Field | RawObservation (adapter output) | Observation (normalizer output) |
|---|---|---|
| `source` | provider and collection, e.g. `atrai:osem_home_data_heilbronn` | unchanged |
| `station_id` | provider device id (`boxId`) | unchanged |
| `platform` | `stationary` or `mobile` | unchanged |
| `kind` | `observation`, `model` or `derived` | unchanged |
| `raw_key` / `raw_value` / `raw_unit` | provider key, value and unit as received; `null` stays `null` | kept for traceability |
| `phenomenon` / `value` / `unit` | — | canonical name, converted value, fixed unit |
| `observed_at` | provider event time; may be naive | UTC, time-zone aware |
| `longitude` / `latitude` | WGS84 | unchanged |
| `retrieved_at` | UTC retrieval time, if known | unchanged |
| `sample_id` | separates mobile samples with the same timestamp | unchanged |
| `qc_flags` | — | see the normalizer section |

Rules for adapters:

- Emit one record per provider value, also when the value is `null`. Do not
  rename keys or convert units; the normalizer owns the mapping.
- Keep event time (`observed_at`) separate from retrieval and ingestion times.
  Pass a naive time unchanged when the provider gives no time zone.
- Set `kind` to `model` for forecasts and model output (Bright Sky forecast,
  Open-Meteo), never `observation`.
- The upsert identity is `(source, station_id, phenomenon, observed_at, sample_id)`.
