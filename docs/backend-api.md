# Backend API contract

The FastAPI application defaults to offline `mock` mode with synthetic inputs.
Explicit `GREENAIR_SERVING_DATA_MODE=stored` plus `GREENAIR_DATABASE_URL` selects
persisted real-source results. Day air/weather are models; sensor markers are
measurements. Versioned spatial results add rider-derived attributes with explicit
missing coverage and unknown survey age. See the [stored contract](integrations/real-serving-contract.md)
and [verified spatial contract/evidence](integrations/atrai-spatial.md).

## Run and explore

```sh
just dev
# Or: just backend-up
```

- Swagger UI: <http://localhost:8000/docs> (interactive Try it out)
- OpenAPI 3.1 JSON: <http://localhost:8000/openapi.json>
- ReDoc: <http://localhost:8000/redoc>

The document is generated from the registered routes and Pydantic models. Examples,
operation IDs, field constraints, tags, and shared errors appear in Swagger. There is
no manually synchronized YAML specification. Export a snapshot when needed with
`just openapi`; it writes to stdout, without changing tracked files.

## Endpoints

All endpoints are public, read-only GETs. No authentication or request body is required.

| Canonical resource route | Existing frontend route | Result |
|---|---|---|
| `/health` | same | Process liveness, independent of data availability |
| `/v1/days/{date}` | `/api/v1/day?date=` | 24 city-wide hours with nullable values, factors and source metadata |
| `/v1/grids/{date}` | `/api/v1/grid?date=` | GeoJSON cells with 24 values per factor |
| `/v1/sensors` | `/api/v1/sensors` | Paginated resources / compatibility array of station markers |
| `/v1/sensors/{sensor_id}` | — | One sensor; IDs are discovered by listing |
| `/stations/status` | same | Mock station upload status; opt-in live adapter remains available |
| `/v1/segments` | `/segments` | Paginated road GeoJSON (invented in mock mode); optional `bbox=west,south,east,north` |
| `/v1/segments/{segment_id}` | — | One segment; stable IDs are discovered by listing |
| `/v1/scores?profile=&t=` | `/scores?profile=&t=` | Score tuples keyed by segment ID |
| `/v1/scores:lookup?lat=&lon=&profile=&t=` | `/score` with same query | Nearest line within 200 m and component goodness scores |
| `/v1/segments/{segment_id}/bestTimes/{date}?profile=` | `/best-time?segment_id=&date=&profile=` | Up to three distinct recommended hours |
| `/v1/status` | `/status` | Build/source status, actual date coverage and spatial availability |

In mock mode, try date `2026-10-29`, sensor `mock-1`, segment `1`, profile `running`, and UTC hour
`2026-10-29T12:00:00Z`. The score lookup example is lat `49.1425`, lon `9.2115`.
Profiles: `running`, `cycling`, `walking`; `cycling` maps to the engine's `road_cycling`.

```sh
curl 'http://localhost:8000/api/v1/day?date=2026-10-29'
curl --compressed 'http://localhost:8000/api/v1/grid?date=2026-10-29'
curl 'http://localhost:8000/api/v1/sensors'
curl 'http://localhost:8000/scores?profile=running&t=2026-10-29T12:00:00Z'
curl 'http://localhost:8000/score?lat=49.1425&lon=9.2115&profile=running&t=2026-10-29T12:00:00Z'
```

## Mock mode behavior

Supported mock dates are 2020-01-01 through 2100-12-31; other dates return 404 and
malformed dates return validation errors. This includes the frontend's historical
`2026-06-20` example and seven-day outlook. It is a demo date range, not downloaded
history or a real forecast horizon.

Day/grid arrays always have exactly 24 Europe/Berlin wall-clock slots, even on DST
transition dates, as the frontend requires. Recommendations identify actual UTC
instants: nonexistent spring hours are skipped and repeated autumn hours use fold=0.
The core factor contract does not apply sport weights. Optional street-score queries
use the merged sport engine and are a different scoring contract. Their components
are goodness scores on a 0–100 scale, not original physical measurements. The street
`kind: forecast` field is the temporal category required by the optional consumer;
`source: mock` is the authoritative provenance. The frontend labels this source as simulated. Keep its street-overlay integration
disabled until vector tiles are connected or the overlay accepts the backend GeoJSON.

The grid spans [9.15, 49.105, 9.275, 49.178], using nominal 250 m cells, stable IDs,
and deliberately generic demo place names. Sensor marker identities and all street
lines are invented; they must not be interpreted as a verified street network.

## Google API design guidance

The HTTP API applies Google's resource-oriented design ([AIP-121](https://google.aip.dev/121)),
Get/List methods ([131](https://google.aip.dev/131), [132](https://google.aip.dev/132)),
custom methods ([136](https://google.aip.dev/136)), pagination
([158](https://google.aip.dev/158)), and JSON error representation
([193](https://google.aip.dev/193)). It does not implement protobuf services, Google
Cloud API infrastructure, or claim complete AIP conformance. OpenAPI generation uses
[FastAPI's metadata support](https://fastapi.tiangolo.com/tutorial/metadata/).

Resource names are `days/{date}`, `grids/{date}`, `sensors/{id}` and `segments/{id}`.
For the existing frontend's sensor shape, `name` is still the display name and
`resourceName` is the resource identity. Core JSON uses camelCase and street JSON
retains snake_case. Frontend aliases preserve existing paths and bare sensor arrays;
GeoJSON collections preserve their standard envelope. Paginated collections accept
`page_size` (1–100, default 50) and `page_token`; pass `next_page_token` unchanged with
the same filters. No-data geographic queries return an empty collection or 404 for
point lookups; they do not invent coverage outside demo lines.

Errors use `{error: {code, status, message, details}}`, with typed Google `ErrorInfo`
details. Canonical `/v1` validation returns HTTP 400 / INVALID_ARGUMENT; compatibility
routes retain FastAPI's 422 for automatic field validation. Explicit semantic
validation returns 400, unknown resources/coverage 404, and live upstream failures
502 / UNAVAILABLE. This replaces the old station error's `detail` field.

## Frontend configuration and replacement boundary

For the core UI, set `NEXT_PUBLIC_API_URL=http://localhost:8000` before starting or
building the frontend. Set `GREENAIR_CORS_ORIGINS` to a JSON list of frontend origins
for local non-container runs. Compose defaults to localhost:3000, :3200 and :5173.
Day/grid use a five-minute cache policy (including mock history), sensors one minute;
large JSON responses support gzip. `X-Data-Source` and `X-Build-Id` accompany the core
responses. The mock build is versioned; it is not a timestamp of measured data.

`app/serving/repository.py` is the replaceable query interface. `create_app(repository=...)`
and `get_repository` dependency overrides support either provider in tests without
changing route paths. No file reads, database SQL, or provider
fetching are embedded in serving routes. The default provider generates deterministic
values on demand; the stored provider reads immutable versioned results.

`/stations/status` has its separate opt-in `GREENAIR_STATION_DATA_MODE=live` adapter.
It does not select the repository used by day/grid/sensors. Stored mode reads
versioned snapshots built by independent ingestion/processing commands, never by
API startup. Stored core responses use no-cache so updated snapshots are visible.
Missing data is null/404, storage outages 503; there is no dummy fallback.

Run `just ingest-spatial --max-pages 4` repeatedly to resume a manual city-layer
capture, then `just process-results --spatial --reference-days 7`. This adds real
road geometries, partial grids and derived sport scores in stored mode. Core grid
factors still receive client-side sport weights; optional street scores use the
separate backend engine. They are different contracts. Street cursor tokens bind
the spatial build and bbox; restart pagination if either changes.

Spatial arrays accept null; `green` is null without a verified greenery source.
Cells expose surface goodness, close-pass goodness, static flow, contributing road
IDs/counts and provenance. City model air remains spatially uniform without measured
adjustments. Grid confidence stays zero and recommendable=false until an area-level
confidence model is validated. Street confidence is zero without PM evidence;
missing required city inputs yield a null detail score and no score tuple. Best-time
results exclude zero-confidence/stale hours. Unknown rider survey age is explicit.

SSE, vector tiles, large backfills and score calibration remain deferred. Dated
research/capture counts and synthetic test values are never current observations.
