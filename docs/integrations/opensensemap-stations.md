# Green City stationary senseBox status data contract

## Purpose and selection

- Feature: live status and latest readings of the Green City stationary
  senseBoxes, for a sensor-health view and the current city level `L(t)` in the
  scoring draft (a box is "live" with a reading in the last 30 minutes).
  Variables: temperature, humidity, pressure, illuminance, UV, PM1/2.5/4/10.
  Acceptable age: 30 minutes (application setting).
- Source type: observation (latest value per sensor) plus box metadata.
- Catalog: `data/GREENCITY_HEILBRONN_ENDPOINT_CATALOG_2026-10-28.csv:97`
  (`https://api.opensensemap.org/boxes?grouptag=heilbronn`), and `:46` for the
  ATRAI mirror `osem_home_data_heilbronn`.
- Reference: §5 (senseBox:home), §15 (openSenseMap), snapshot 2026-10-28.
- Original research verification wording: row 97 "Documented route family; not
  independently queried"; row 46 "Direct catalog name; schema in official bike
  guide where present".
- Selection: use openSenseMap `/boxes` with `grouptag=GreenCityHN` for the live
  status. The catalog tag `heilbronn` returns 49 mobile bike boxes, not the
  stationary boxes. The ATRAI mirror is not live (see below), so keep it for
  history only.

## Checked contract

- Method: `GET https://api.opensensemap.org/boxes?grouptag=GreenCityHN&full=true`,
  no authentication, 30 s timeout.
- Provider documentation: no separate documentation consulted; the contract
  below is from the observed response.
- Probe: 2026-10-28T17:08:18Z, macOS workstation. HTTP 200,
  `application/json; charset=utf-8`, 27,450 bytes, a JSON array of 14 boxes.
  Re-run through `/stations/status` at 2026-10-28T17:10:09Z: 6 online,
  7 stale (30 min threshold), 1 without any measurement.
- Evidence: trimmed capture of 3 boxes in
  `services/backend/tests/fixtures/opensensemap_greencityhn_boxes_2026-10-28.json`.
- Box fields observed: `_id`, `name`, `exposure` (`indoor`/`outdoor`),
  `grouptag` (array), `model`, `currentLocation` (GeoJSON Point,
  `[lon, lat]` or `[lon, lat, height]`), `createdAt`, `updatedAt`,
  `lastMeasurementAt` (absent on a box that never uploaded).
- Sensor fields observed: `_id`, `title`, `unit`, `sensorType`, `icon`,
  `lastMeasurement` `{value: string, createdAt}`; `lastMeasurement` is absent
  for a sensor without data. With `full=false` it is a measurement id string.
- Sensor titles are German (`Temperatur`, `rel. Luftfeuchte`, `Luftdruck`,
  `Beleuchtungsstärke`, `UV-Intensität`, `PM1`, `PM25`, `PM4`, `PM10`); one box
  has an extra humidity sensor. Units: °C, %, hPa, lx, μW/cm², µg/m³.
- Timestamps: ISO 8601 UTC with `Z`.
- Geographic filter: the group tag only. Boxes are in the wider Heilbronn
  district (for example Öhringen, Beilstein, Lauffen), not only the city.
- Stable IDs: box `_id`, sensor `_id`. Values are latest-only; no history here.
- License / attribution: not checked.

### ATRAI mirror `osem_home_data_heilbronn` (same check session)

- `GET https://api.atrai.bike/collections/osem_home_data_heilbronn/items?f=json&limit=5&offset=0`
  at 2026-10-28T17:07:21Z: HTTP 200, GeoJSON FeatureCollection,
  `numberMatched` 2,026,306. `groupTags` is a JSON-encoded string
  `"[\"GreenCityHN\"]"`.
- Every sampled `created_at` (ingestion time) is on 2026-09-30, so the mirror
  looks like a one-time sync, not a live feed. `createdAt` has no time zone.
  Provider sensor keys differ from openSenseMap (`Temperature`, `Finedust PM2.5`).
- The provider OpenAPI (`/openapi.json`) lists only `limit`, `offset` and
  `campaign` for items; there is no sort or time filter. `/collections/{name}`
  and `/queryables` return 404.
- Order is not stable: offsets 2,000,000 and 2,026,000 returned overlapping
  `index` ranges. Full exports must deduplicate by `index` and verify coverage.

## Implementation and validation

- Adapter: `services/backend/app/ingestion/adapters/opensensemap.py`; status:
  `services/backend/app/processing/station_status.py`; route
  `GET /stations/status` in `services/backend/app/api/routes/stations.py`.
- Missing values stay `null`; `raw_value` keeps the provider string; a
  non-numeric value gives `value: null`.
- States: `online` (newest upload not older than
  `GREENAIR_STATION_STALE_AFTER_MINUTES`, default 30), `stale`, `no_data`.
  The threshold is an application choice, not a provider guarantee.
- 3 attempts with exponential backoff on 429/5xx and network errors. Wrong
  content type, wrong payload shape and other HTTP errors fail at once. The
  route returns 502. There is no cache; each request calls the provider.
- Checks: 10 offline tests in `services/backend/tests/test_stations.py`
  (parsing, nulls, threshold border, retries, failures). Live check above.
- Not yet: stuck-sensor detection, outdoor sun-exposure flag, sensor history,
  calibration against an official station, caching.
