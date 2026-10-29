# Verified ATRAI spatial inputs

Research: immutable 2026-10-28 catalog records 5 (roughness), 8 (overtaking),
10 (flow), 11 (roads); reference §3.2–3.4, §16 and §19.2. These listings originally
confirmed collection names, not functioning item contracts. See the exact URLs,
parameters, UTC retrieval times, status and SHA-256 of **every capture page** in
[2026-10-29 evidence](atrai-spatial-evidence-20261029.json). Raw bodies remain in
ignored `data/runtime/spatial-check-20261029/layers.sqlite`, not this repository.

## Live contract and documentation

On 2026-10-29 07:50 UTC, bounded GET probes (`f=json&limit=3&offset=0`, 25-second
timeout, two attempts maximum) returned HTTP 200 application/json for all four
city line collections. Envelope: FeatureCollection, features, numberMatched,
numberReturned, offset, limit. Features have LineString WGS84 [longitude, latitude],
properties and no GeoJSON ID. Observation, provider build and issue times are
**not supplied**. Retrieval does not establish measurement freshness. Properties
and raw bytes remain intact; application capture time freezes across pages.

Current primary sources inspected:

- [Green City bike guide](https://hackathon.greencity.hn/resources/bike-data),
  fetched 07:50:39 UTC, HTML SHA-256
  `4392082b83b9cba2bd018d11f001495ffd1157ce8c1504593d34119086ece873`.
- [API schema](https://api.atrai.bike/openapi.json), fetched 07:50:40 UTC,
  SHA-256 `a670800967838e786694277608c6a38836f4c4cd77ccc756fd085fcc46fb3247`.
- Provider repository, linked by the guide, inspected at
  `cd412840214b5ec947e2213a11793da0fa4e9789`:
  [items implementation](https://github.com/reedu-reengineering-education/atrai-bikes-ingestor/blob/cd412840214b5ec947e2213a11793da0fa4e9789/src/api.py#L420),
  [roughness calculation](https://github.com/reedu-reengineering-education/atrai-bikes-ingestor/blob/cd412840214b5ec947e2213a11793da0fa4e9789/src/atrai_processes/bumpy_roads.py#L107),
  [histogram bins](https://github.com/reedu-reengineering-education/atrai-bikes-ingestor/blob/cd412840214b5ec947e2213a11793da0fa4e9789/src/atrai_processes/map_points_to_road_network.py#L6).

The built-in-datasets docs URL returns a 467-byte SPA shell; that response does
not establish field semantics. Provider code confirms campaign is an unused
placeholder. There is no bbox/datetime filter or ORDER BY/snapshot token in this
items implementation. Our bbox is checked locally, including every line vertex.

**Documented discrepancy:** the guide/reference describe normalized roughness
0–1; inspected code multiplies by 100. All 9,600 captured values lie in [0,100].
Canonical roughness therefore divides the original `Normalized Roughness` by 100,
with explicit validation, without rewriting the research snapshot. Histogram
string contains five comma-separated integer counts in [0,50), [50,100),
[100,150), [150,200), [200,infinity) cm. All 1,389 sums match Number of Points;
below-150cm share is first three bins / total. Flow is a normalized speed proxy,
never vehicles/hour or a live traffic count. Provider rebuild cadence, survey
period and dataset redistribution license remain unknown; cite ATRAI/senseBox
and OpenStreetMap contributors for road geometry. Do not call these live readings.

## Import accounting and joins

2026-10-29 07:56:15–07:56:49 UTC, 55 bounded requests (`limit=1000`, final page
shorter), all HTTP 200 JSON:

| Collection | Reported | Local | Outside bbox | Exact unique road joins |
| --- | ---: | ---: | ---: | ---: |
| road_network_heilbronn | 34,243 | 34,241 | 2 | 34,241 |
| bumpy_roads_heilbronn | 9,600 | 9,600 | 0 | 9,600 |
| overtaking_distance_heilbronn | 1,389 | 1,389 | 0 | 1,389 |
| traffic_flow_heilbronn | 7,155 | 7,154 | 1 | 7,154 |

Road identity is opaque `properties.index` (OSMnx directed edge tuple string).
Never eval it. Static layers match only a **unique exact directed coordinate
sequence plus opaque osmid**. IDs/streetid/road_segment and osmid alone are not
join keys. Reversed or ambiguous geometries remain unmatched. The checked capture
had no ambiguous/unmatched local layer geometries; that is dated evidence, not a
promise about future builds. Multiple contributions to one edge must not silently
win by arrival order.

`just ingest-spatial --max-pages 4` explicitly selects manual jobs; repeat to
resume the same capture. Normal polling remains unchanged. Bounded HTTP lands each
attempt before decoding. Each page atomically saves raw refs, original properties,
receipts, manifest and cursor. New captures retain intraday differences; replay
of the same capture is idempotent and stable road IDs survive a rebuild.

`SpatialRepository.latest_capture` accepts only successful contiguous pages with
unchanged total, exact distinct receipt count, no unresolved features and matching
local row counts. It skips interrupted/duplicate/inconsistent builds and preserves
last success. **Count-consistent capture is not an atomic upstream snapshot**:
offset windows can move without changing count/IDs. The provider has no contract
that can prove otherwise; raw page hashes and capture time range retain this limit.

Global raw-bike and track-point limit-3 probes returned foreign-city points.
Their event timestamps lack timezone offsets; track_points lacks groupTags.
No global export, guessed city filter, timestamp conversion, or raw mobile pollutant
calibration is used here. Static layers themselves are mobile-derived inputs;
local canonical measurements can supply temporal levels independently. Missing
PM spatial coverage must remain explicit.

## Local validation

Adapter/accounting tests cover source identity, bounded requests, UTC capture
continuity, changed totals, replay, retained raw properties, outside-bbox geometry,
duplicate identities across pages and last-success fallback. SQLite validates
portable logic only; production PostGIS verification is recorded separately when
run. Captured totals are historical and are not availability guarantees.

## Versioned spatial processing

`just process-results --spatial --reference-days 7` builds `spatial-v1` independently
of day/sensor results. Optional `--as-of` accepts an explicit aware cutoff for
repeatable replays. The input window is at most 31 days and reads at most 50,000
canonical measurements; exceeding the budget fails instead of silently truncating.
Missing/failed road captures cannot publish a spatial result; interrupted new
captures preserve the last usable result. Result/input hashes retain raw refs,
capture summaries, canonical values, reference times, joins and processing issues.

Original static values remain raw. Normalization validates percentage/fraction
ranges, contributing boxes/points, five histogram bins and matching totals. It
never guesses scales, clamps invalid values, parses Python expressions, joins by
page position, or lets conflicting contributions silently win.

Canonical mobile PM2.5/temperature samples match a uniquely nearest road within
20 m (ties within 1 cm are excluded). The existing median/shrinkage builder compares
samples only to contemporaneous usable outdoor stationary UTC hourly levels.
Station interpolation requires at least 24 shared hours and stays within 2 km;
no model values enter spatial calibration. Provider and station identity remain
separate. No qualifying samples/stations means `pm_source=none`, zero samples and
no heat anomaly. Internal neutral ratio1 is **not** a measured street pollutant.

[Full-capture processing evidence](atrai-spatial-processing-20261029.json) combines
the live-captured static layers with **historical selected first-slice fixtures**,
not a fresh stationary history: 34,241 roads retain the exact expected static
coverage; PM coverage is none on all streets, temperature has one reference hour,
PM has no usable reference hours. No raw mobile pollutant values were fetched or
assumed from the global API. This is a valid partial spatial result, not a street
pollution survey. Unknown provider survey age remains visible.

`tests/fixtures/atrai-selected.json` contains two road features and one feature per
static collection selected from these captures, with original page hashes/URL/
parameters/retrieval times. Only the test replay rewrites envelope totals to model
a complete small capture; the selection is explicitly not a complete live export.
Separate **synthetic** canonical mobile/station tests prove temporal matching,
indoor exclusion and shrinkage without passing invented values off as observations.

Disposable PostgreSQL17/PostGIS/Timescale validation ran the migration upgrade →
61 tests → downgrade to empty application schema → upgrade → 61 tests again.
This exercised selected real layer JSONB/geometry/receipts, complete-capture reads,
versioned spatial snapshot persistence/restart and idempotency. The disposable
container was removed; the existing evidence database was not used.
