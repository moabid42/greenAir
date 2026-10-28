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

## Normalizer and QC

`app/processing/normalizer.py`: `normalize(raw)` for one value and
`normalize_batch(raws)` for a batch with series checks.

- Provider keys map case-insensitively to a phenomenon (`RAW_KEYS`): openSenseMap
  German titles (`Temperatur`, `PM25`), ATRAI keys (`Finedust PM2.5`) and generic
  names. Unknown keys are skipped and counted in `unmapped_keys`.
- Units convert to the canonical unit (`CONVERSIONS`), for example K and °F to °C,
  Pa to hPa, km/h to m/s. Both micro characters (U+00B5, U+03BC) are accepted.
- Duplicates by `Observation.key` are removed and counted.
- Values are never silently dropped. A failed check keeps the value and adds a flag.

| Flag | Meaning | Blocks use |
|---|---|---|
| `assumed_utc` | provider time had no time zone (ATRAI `createdAt`) | no |
| `assumed_unit` | provider gave no unit; canonical unit assumed | no |
| `non_numeric` | value cannot be parsed | yes |
| `unknown_unit` | unit has no conversion; value set to `null` | yes |
| `out_of_range` | outside `PLAUSIBLE` bounds | yes |
| `stuck` | ≥ 10 identical consecutive values of a stationary temperature, humidity, pressure or PM series | yes |
| `humid_pm` | PM with the nearest humidity of the same station within 5 min above 75 % (ATRAI rule, reference §3.3) | yes |

The thresholds are defaults. `Observation.usable` is false for blocking flags
and for `null` values.

## Temporal profile builder

`app/processing/temporal.py` (scoring draft §4.1–§4.2). Only usable stationary
measurements (`kind == "observation"`) count; mobile, model and flagged values
do not.

- `current_level(...)`: §4.1 median of the latest value of each live station. A
  station is live with a usable value in the last 30 minutes. Optional per-station
  `Calibration` (`x_ref ≈ alpha·x + beta`, fitted with `fit_calibration` on
  overlapping history). Without live stations, an optional reference value is
  used (`method="reference"`); otherwise the level is unknown (`None`).
- `hourly_levels(...)`: per UTC hour, the median over stations of each station's
  hourly mean.
- `climatology(levels)`: §4.2 median per local (weekday, hour) in
  `Europe/Berlin`, so rush hours keep their wall-clock time across DST. On the
  night the clocks go back, both UTC hours count toward local 02:00.

No reference station (UBA/LUBW) is connected yet, so calibrations default to the
identity. The e2e test uses synthetic data with a known pattern and checks that
the climatology recovers it across the 2026-10-25 DST change.
