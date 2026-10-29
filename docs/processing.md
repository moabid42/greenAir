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

## Forecaster

`app/processing/forecaster.py` (scoring draft §4.3). Results are labelled
forecasts (`Forecast.method`), never observations.

- `model_series(observations, phenomenon)`: hourly mean of usable `kind == "model"`
  values (Open-Meteo air quality, Bright Sky or Open-Meteo weather).
- `forecast(...)` chooses, in order:
  1. `model_bias_corrected`: `M(t) · b(t0)`, with `b` = mean level / mean model over
     the hours of the last 24 h present in both;
  2. `model_uncorrected`: the model when no overlap exists;
  3. `climatology_decay`: climatology times today's anomaly ratio, decaying with
     `exp(-τ/6 h)`.
- Temperature uses the additive form (difference instead of ratio), because a
  ratio of °C values is undefined around 0 °C. This is an extension of the draft.

Sensor checks (`stuck`, `humid_pm`) apply only to measurements; smooth model
output is not a stuck sensor. The e2e test found this case.

### Weather and air-quality keys (probe 2026-10-28T18:38:58Z)

| Request | Result |
|---|---|
| `GET https://air-quality-api.open-meteo.com/v1/air-quality?latitude=49.1427&longitude=9.2109&hourly=pm2_5,pm10,nitrogen_dioxide,ozone,uv_index&forecast_days=1&timezone=UTC` | HTTP 200 JSON; `hourly_units`: `μg/m³` (U+03BC) for PM and gases, `""` for `uv_index`; grid point 49.1, 9.2 |
| `GET https://api.open-meteo.com/v1/forecast?...&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` | HTTP 200 JSON; `°C`, `%`, `km/h`, `mm` |
| `GET https://api.brightsky.dev/weather?lat=49.1427&lon=9.2109&date=2026-10-28&last_date=2026-10-28T02:00` | HTTP 200 JSON; fields `temperature`, `relative_humidity`, `wind_speed`, `precipitation`; no units in the payload |

The normalizer maps these keys. Bright Sky adapters must set `raw_unit`
(`°C`, `%`, `km/h`, `mm`) because the payload has none. `mm` is accepted for
precipitation only because both providers report hourly steps.

## Spatial layer builder

`app/processing/spatial.py` (scoring draft §3). Geometry is WGS84
`[longitude, latitude]`; distances use haversine and a local equirectangular
projection, without GIS libraries.

- `Segment`: id, polyline and optional static ATRAI attributes (`roughness`,
  `overtaking_share`, `flow`, each 0–1). Real segments will come from the ATRAI
  `bumpy_roads`, `overtaking_distance` and `traffic_flow` layers (reference §3);
  that adapter is ingestion work.
- `SegmentIndex`: grid index; a sample matches the nearest segment within 20 m.
- `build_layers(...)`: usable mobile PM2.5 samples give `r = x / L(hour)`, usable
  mobile temperatures give `T - T_ref(hour)`; per segment the median is shrunk with
  κ = 20 (§3.1, §3.2). Humid PM is already excluded by its QC flag. Ratios are
  floored at 0.1, because a reading of 0 means "below detection". The report counts
  matched, unmatched and level-less samples.
- `station_ratios(...)` and `fill_uncovered(...)`: §3.4 long-run ratio of each box
  (at least 24 shared hours) and inverse-distance-squared fill for segments without
  samples (`pm_source="idw"`).

Not yet: separate day and night heat anomalies, seasonal patterns, the §3.5
rush-hour contrast, and an OSM `surface` fallback for roughness.

## Scoring engine and pipeline

`app/scoring/engine.py` scores every segment × hour × profile (scoring draft
§5–§7): PM2.5 is the forecast level times the segment ratio (optionally with the
§3.5 exponent γ(t) from the NO₂ climatology), temperature adds the segment
anomaly, NO₂, O₃, UV and wind are city-level, and daylight comes from an
approximate sun-position formula (±0.5°). Missing components are dropped and
lower the confidence (IDW segments: coverage 0.3; no data: 0).

`app/processing/pipeline.py` runs all stages in one process:

```sh
cd services/backend
uv run --locked python -m app.processing.pipeline INPUT.json [--output RESULT.json]
```

| Input (`PipelineInput`) | Meaning |
|---|---|
| `issued_at` | forecast issue time; scores cover the next `horizon_hours` (default 24) full hours |
| `raw_observations` | `RawObservation` records: stations, bike samples and `kind="model"` forecasts |
| `segments` | `Segment` records with optional static attributes |
| `profiles` | default: running, road cycling, walking |
| `severe_weather_alert` | closes the alert gate |
| `rush_hour_contrast` | enables §3.5 (default off, as the draft advises) |

The output (`PipelineResult`, [JSON Schema](contracts/pipeline-result.schema.json))
contains the normalization summary, the forecast method per phenomenon, the
segment layers, every score with its components, gates and confidence, and the
top three hours per segment and profile. Layers and scores are `kind="derived"`,
forecasts `kind="forecast"`. This is the `scores.updated` payload.

The e2e test runs the command as a separate process on two weeks of synthetic
stations, bike rides, an air-quality model and a weather model, and checks the
rain gate, daylight, rush-hour ranking, best times and confidence.
