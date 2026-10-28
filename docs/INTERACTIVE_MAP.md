# Interactive map

EcoMAB keeps one MapLibre GL map mounted while the user changes sport, hour and layer. The base map uses the OpenFreeMap Positron style and OpenStreetMap-derived tiles. The application displays attribution through MapLibre; tiles and styles require network access.

## Offline and example conditions

The bundled Heilbronn scenario contains three illustrative hours on 29 October 2026, 14:00–16:00 Europe/Berlin. It is not a set of observations, a live forecast or street-level data. When rendered road geometry is available from the basemap, the app can apply one citywide example value uniformly to those real OSM-derived lines. The legend and details identify the example and say it is not a street measurement. No sensor positions or route geometry are invented.

The selected running, cycling or walking score and the temperature, PM2.5, wind and traffic layers use the scenario metrics. Safety and surface have an unavailable state when verified coverage is absent. The time slider updates the data source without creating another map instance. The Best Time view compares only the available example hours, not a verified route recommendation.

## Proposed backend integration

`VITE_ECOMAB_API_BASE_URL` enables the proposed consumer API. `src/consumer-api.js` validates score snapshots, converts selected timestamps to UTC hours and guards against stale request races. `src/segment-overlay.js` adds a separate vector source for the backend's `segments` source layer. Feature state joins the snapshot's integer `segment_id` to the backend's own tile features; OSM basemap IDs are not used as backend IDs. On snapshot changes, previous state is removed before new state is applied. Zero remains a valid score and an absent segment stays neutral. A new `build_id` rebuilds the vector source; mismatched builds are not joined.

The backend API and actual vector tiles have not been verified against a deployed service. The app keeps the OSM map and illustrative fallback when those services are unavailable. The existing integration does not yet complete every proposed endpoint, full-day DST controls or comprehensive SSE recovery. The UI supports inspecting a backend segment via `/score` when available; absent street detail is reported as unavailable.

## Data and source boundaries

Backend scores and component values belong to the backend; the frontend does not recalculate authoritative scores from the reference weight table. Each example metric keeps its source and time in the normalized data. Real sensor markers and real routes require actual returned geometry. Wearable samples remain separate and are not uploaded through the environmental endpoint.

## Relevant files and checks

- `src/app.js`: map lifecycle, controls, selected time and interaction panels.
- `src/map-layers.js`: citywide layer selection and illustrative color bands.
- `src/segment-overlay.js`: vector source and feature-state join.
- `src/consumer-api.js`: endpoint client, validation and request selection.
- `src/environment.js` and `public/fixtures/`: illustrative scenario and field provenance.
- `tests/consumer-api.mjs`, `tests/map-analytics.mjs`, and `tests/browser/`: contract and browser checks.

Run `npm test`, `npm run lint`, `npm run build`, and, on a machine that can run a local server and Chromium, `npm run test:browser`. Unit tests use fixtures and do not establish that backend tiles or live scores work.
