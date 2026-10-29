# Real serving contract and missing values

Core day fields now accept explicit nulls. Null means absent/unusable input; zero
remains an actual numeric value. Factor scores accept null independently, so missing
traffic and safety do not become invented defaults. Sport weights stay in the client.
Each hour can carry actual UTC instants, missing-channel names and per-channel
source kind, valid times, retrieval/issue times, raw references, units and QC flags.
The public day retains 24 Berlin wall-clock slots; exact source instants make DST
gaps/repeated hours traceable. Provider selection is explicit, as described below.

Day/grid/sensor provenance accepts mock, forecast (model output), measured, mixed or
unavailable. Day metadata includes build/retrieval times, partial/stale status and
attribution. Grids can be explicitly disabled with no features and an unavailable
status/message. Sensors retain indoor/outdoor exposure, per-channel provenance and
staleness. Dynamic OpenAPI derives these contracts from the actual models.

The frontend formats missing raw values as an em dash or No data, draws missing
hours neutrally, and excludes missing core weather/air hours from recommendations.
Internal unavailable scores use NaN only as a client calculation sentinel; API JSON
uses null, and display/chart/recommendation boundaries handle it explicitly. Missing
traffic never becomes Quiet. Analytics/Coach omit unavailable values from ranges;
no-data sensor or day requests do not silently fall back to dummy data. Date changes
clear old map/sensor data and cancel outdated sensor fetches. Offline demo mode now
uses consistently synthetic inputs instead of mixing live browser weather with
invented air values. Backend-provided grids are never replaced by synthetic ones.

Validation: backend nullable/OpenAPI tests plus existing API checks; frontend core
tests check that daylight-only missing hours cannot produce recommendations, zero
stays numeric, and partial windows exclude gaps. `just check-web` includes these
checks plus lint/type-check/build; CI already calls the same recipe. Captured replay and production browser verification are recorded in the serving
and spatial validation notes.

## Stored provider

`GREENAIR_SERVING_DATA_MODE=stored` plus an explicit GREENAIR_DATABASE_URL selects
`StoredRepository`. Default mock startup remains independent of infrastructure.
Stored startup creates an engine lazily and disposes its pool on application shutdown;
it never queries, migrates, polls or fetches upstreams during startup. Unavailable
storage produces a typed 503 on data requests while health remains live. A date with
no usable stored model coverage returns 404; `/v1/status` lists actual snapshot dates.

The day projection reads Open-Meteo weather and CAMS air channels from their specific
source namespaces. It does not blend other model runs or relabel modelled NO2 as a
station reading. A repeated Berlin hour averages its two real UTC instants only if
both are usable; a spring gap is null, with no fabricated timestamp. Each channel
lists its source/valid/issue/retrieval times, original raw refs and canonical units.
Wind is projected from processing m/s to the existing client km/h field once.
Daylight is a derived approximate solar-position calculation at the city point,
labelled independently; it asserts no street illumination coverage.

Factors follow the existing frontend heat/air/wind formulas; client sport weighting
is unchanged. Traffic and safety remain null, and whole-day status remains partial.
Staleness uses the oldest required-channel retrieval versus a configurable three-hour
application threshold, not build time. Last-success snapshots keep their original
build IDs/times after restart or upstream failure. No response silently substitutes
a demo value. Cache headers and X-Data-Source reflect the selected result.

Sensor markers cover openSenseMap and the checked official UBA stations. Outdoor and
indoor exposure, original sensor IDs via per-channel provenance/raw refs, units and
actual observation times remain available. Parallel sensors get distinct channel
labels. Stale flags consider every channel (30 minutes for community sensors,
three hours for hourly UBA); these thresholds are application choices, not provider
cadence guarantees. DWD weather inputs remain stored without being mislabelled as
senseBox markers. Without a usable spatial snapshot, the real grid is an explicitly
disabled empty collection and street queries return no verified data. No synthetic spatial
scores are mixed with real day/sensor results.

Compose passes the explicit mode/database variables while retaining the separate
hardened demo project and nonroot runtime. From Docker Desktop, an existing local
PostgreSQL service uses host.docker.internal in its URL; use an explicitly selected
migrated database and keep credentials in environment variables. The public API is
read-only; refresh remains an independent command. Offline SQLite capture replay
is also supported for local tests; it does not emulate PostGIS/TimescaleDB.

## Frontend layer labels

A persistent expandable source notice identifies modelled city conditions, partial
coverage and stale stored results with separate retrieval/build times in Berlin.
It names Open-Meteo/CAMS attribution and states when street grids/rankings are
unavailable. Station sheets label measured versus synthetic data, indoor/outdoor
exposure, stale channels, units and per-channel observation times. Modelled NO2 is
never labelled as an official station observation. City-wide recommendations cannot
open a fabricated street/place. Coach declines park/street ranking without spatial
coverage, and its facts retain source/coverage metadata.

Stored mode uses the verified backend's historical surface/close-pass/flow lenses
and never fetches the old direct ATRAI overlays/statistics. Grids expose nullable
arrays/greenery, road counts and IDs, per-layer provenance, zero area confidence and
recommendable=false. Place rankings stay withheld; map cells remain inspectable.
Street detail scores are nullable, component methods explain city models versus
static inputs, PM confidence stays zero without evidence, and best-time results
exclude stale/zero-confidence hours. See [spatial evidence](atrai-spatial.md). Mock mode remains clearly separate. Berlin calendar/hour
selection is explicit even when the browser timezone is UTC. Reminder conversion
rejects nonexistent spring hours and selects the earliest repeated autumn instant.
Missing/out-of-horizon days display the typed no-coverage error and offer a date
picker instead of retaining old map data or spinning indefinitely.
