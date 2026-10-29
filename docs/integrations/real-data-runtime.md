# Real application runtime — 2026-10-29

The merged adapters/repository existed, but the previous Compose stack selected
mock mode and never ran migrations, ingestion or processing. The web client also
selected offline synthetic data when its backend URL was unset; admin generated
sample traffic/uploads and Devices offered synthetic wearable sessions.

## Default lifecycle

`just up` builds and starts the existing `greenair-demo` project with a **new,
dedicated** persistent PostgreSQL 17/PostGIS/TimescaleDB service, production
migrations, separate refresh worker, stored-data API and web/admin frontends.
The project name is retained to avoid orphaning existing app containers; it does
not mean data is synthetic. Other projects' existing databases/Redis are untouched.
The volume `greenair-demo_real-data` survives `just down`. Never use `down -v`
unless intentionally deleting this application's stored inputs and results.

App defaults and Compose/dev recipes select stored serving/live station status.
Host development uses the Compose database at localhost:55433; override
GREENAIR_DATABASE_URL or GREENAIR_DATA_PORT deliberately. Compose uses the internal
database hostname and local development credentials, independently of inherited
host DB URLs. No fixture import runs. The database port is loopback-only.

The worker runs bounded passes every 60 seconds; individual sources retain their
existing application polling cadences and persisted retry/checkpoint policy.
Weather/modelled air, stationary openSenseMap, Bright Sky and five UBA channel jobs
run independently. After each pass it processes today/tomorrow and latest sensors. Spatial artifacts
rebuild hourly or when new street-capture pages arrive, avoiding a large new
snapshot on every scheduler tick.
The first results can take a minute; the API remains available while uncovered
resources report unavailable. The source models currently cover two UTC days;
Berlin boundary hours, unsupported channels and longer horizons may be missing.
They never receive generated replacement values.

Four verified city-only ATRAI jobs bootstrap in at most four 1,000-feature pages per
source/pass, resume committed offsets, then recapture weekly. Weekly is our refresh
policy, **not** the provider's measurement cadence. Failed jobs respect persisted
backoff. Complete captures publish spatial results; partial imports cannot publish
an invented map. Prior usable results survive failures and application restarts.
Static source survey/build times remain unknown. No global raw bike export is added.

The API never starts a worker or makes a database connection during app creation.
`/stations/status` is the separately configured live openSenseMap request route.
`/api/v1/data-status` reads stored counts, source checkpoints, UTC attempt/success
and observation/model-valid times, plus latest processing attempts. It excludes raw
payloads, credentials and private client data. Storage errors return 503. Latest
attempts may be unavailable while serving retains an older usable result.

## Clients

Web defaults to localhost:8000; failed requests stay errors. Production Devices
waits for real Bluetooth heart-rate notifications; old sample wearable histories
are not selected. Explicit NEXT_PUBLIC_DEMO_MODE=true enables the offline fixtures
for deliberate testing only. Compose does not expose/enable that switch.
Backend offline demos/tests explicitly select both mock mode environment variables.
CI's documented mock route smoke remains offline and explicitly configured.

Admin Overview and Source data read actual database counts, refresh states and
build identifiers. CSV exports those source facts. Client-upload and server-request
analytics remain unavailable; there is no upload/traffic telemetry service. Browser
endpoint probes/configuration remain browser-local. Unavailable values show a dash
or an explanation rather than generated traffic/clients. Historical sample generator
utilities remain only as unused fixtures, not normal application data dependencies.

Real city weather/air **models**, station **measurements**, and historical
rider-derived street attributes remain distinguished. Missing traffic/safety,
street pollution calibration, greenery and spatial confidence remain explicit.
Place rankings are withheld. The first complete live build also produced station-IDW PM estimates on 4,449 roads
from sufficient shared stationary hours; these are derived estimates, not street
measurements or calibrated confidence. UI/API labels retain that distinction.
No claim of measured street PM or current traffic
follows from enabling these feeds.

## Source contracts and fresh evidence

Reuses the catalog/reference citations and validated request/parser contracts in
[weather sources](weather-sources.md) (catalog 80–82, 91/93; reference §11/§13),
[openSenseMap](osem-source.md) (reference §15), [UBA](uba-source.md) (architecture
candidate, not a catalog verification claim), and [ATRAI spatial](atrai-spatial.md)
(reference §3). Dated research snapshots are unchanged.

Fresh live GETs from this runtime began 2026-10-29T09:42Z. Actual raw HTTP bodies,
URLs/parameters, response types, SHA256, retrieval/observation times, manifests,
canonical rows and checkpoints are persisted in its database. Weather/modelled air
returned aligned 48-hour arrays; community/UBA/Bright Sky results were partial
where actual channels/hours were absent. These are fresh upstream fetches, not
replays of the test captures. Small metadata evidence and browser results are
retained locally under ignored `data/runtime/real-runtime-20261029/`; bodies and
credentials are not committed.

Provider docs reviewed again: [weather](https://open-meteo.com/en/docs),
[air](https://open-meteo.com/en/docs/air-quality-api),
[Bright Sky OpenAPI](https://api.brightsky.dev/openapi.json),
[openSenseMap docs](https://docs.opensensemap.org/). Existing UBA/ATRAI contract
notes link exact primary schema/code; browser-tool access to UBA YAML/ATRAI source
was limited, separately from successful live provider requests. No new request or
unit contract was inferred from that limitation.

## Validation

See the task's STATE entry for final test counts and live/browser results. Offline
fixture e2e remains separate from the live default-stack checks. Real Bluetooth
hardware and native watch integrations are not simulated as successful connections.
