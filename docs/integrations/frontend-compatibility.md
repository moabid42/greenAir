# Frontend/backend compatibility review — 2026-10-28

Reviewed frontend `origin/web/ecomab-frontend` at `17fd270` against backend `dev`
`9dd12b4`. The frontend was fetched into a detached temporary worktree; no frontend
or backend application code was changed or pushed during this review. `playground/`
is absent from the published dev tree and its history. The user's existing local
`.gitignore` changes were preserved.

## Evidence

- Installed the frontend's locked dependencies and built the unmodified Next.js
  production application using Node 24. Compilation, linting and type checking passed.
- Built with `NEXT_PUBLIC_API_URL=http://localhost:8000` and an empty
  `NEXT_PUBLIC_ECOMAB_API_BASE_URL`. Served production frontend at localhost:3000
  against the healthy Docker backend on localhost:8000.
- Chrome browser test used a 430×932 viewport, Europe/Berlin timezone, and fixed
  client date 2026-10-29 at noon local time. Tested Today, seven-day outlook,
  historical 2026-06-20 selection, Explore hourly playback, ranked place details,
  Analytics and a Coach question requesting tomorrow's conditions.
- All 21 backend browser responses were HTTP 200. No browser runtime exceptions or
  Open-Meteo requests occurred. Core API CORS worked under the frontend's existing
  cross-origin isolation headers. Some map terrain/tile requests were cancelled
  during navigation; these were separate from backend requests.
- Executed the actual frontend `hourScore`, `cellScore`, `bestWindows`, `rankSpots`
  and `nearestCell` code against backend responses. All 351,648 cell-score
  calculations were finite and within 0–100, across all three activities and four
  dates including both 2026 DST transition dates.
- The actual frontend `validateSnapshot` and `validateDetail` accepted backend
  street-score responses for running, cycling and walking. Sensor responses matched
  the consumer shape. Grid cells numbered 1,221, with all hourly arrays length 24.
- One grid transfer measured 45,001 bytes with gzip (1,320,333 bytes uncompressed),
  about 0.32 seconds locally. This is a single local sample, not a performance SLA.

## Compatibility and remaining work

The three core endpoints `/api/v1/day`, `/api/v1/grid` and `/api/v1/sensors` work
with the existing client. No payload or scoring-weight changes are needed for the
current mock integration. Sport weighting remains in the frontend for day/grid.

Keep the optional street overlay disabled for now. Its `consumer.ts` and
`components/map/segmentOverlay.ts` require MVT at
`/tiles/segments/{z}/{x}/{y}.pbf` with the `segments` source layer and integer IDs.
The backend currently serves GeoJSON instead; an actual tile request returned 404.
Its score/detail JSON passes validation, but the optional badge reads only `kind`
and would label mock scores as forecasts. It must also read `source: mock` before
this feature is enabled with synthetic inputs. Frontend and backend street/core
scores are distinct scoring contracts, as documented in `docs/backend-api.md`.

Mock provenance needs small frontend wording changes before showing the demo:

- `components/shell/MobileShell.tsx:34` interprets every mock day as an unreachable
  weather feed. The backend deliberately supplies mock data; it is not a fetch failure.
- `components/screens/CoachScreen.tsx` says "Answers from live data" in mock mode.
- `components/screens/Onboarding.tsx` says the data comes from real sensors.
- `components/sheets/SensorSheet.tsx` describes every reading as a measurement and
  labels the provider using `kind`; the frontend Sensor type currently omits `source`.

Bike-specific ATRAI layers and geocoding/base-map/terrain are fetched directly by
this frontend. They are outside the three core backend APIs. Their provider
availability and complete live coverage were not verified by this review. SSE is
not consumed yet and is not needed for the tested flows.

## Reproduce

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` in `apps/web/.env.local`, leave
`NEXT_PUBLIC_ECOMAB_API_BASE_URL` empty, and build/start the frontend on port 3000.
The default backend Compose CORS configuration already allows this origin.
For other origins, configure `GREENAIR_CORS_ORIGINS` and recreate the backend.

This review's temporary checkout is
`/private/tmp/greenair-frontend-review-r24kxpx1`; production preview is
http://localhost:3000. Browser evidence is in
`/private/tmp/greenair-frontend-integration/` (report JSON and screenshots).
These are local review artifacts, not environmental data or committed datasets.

## Integration follow-up — 2026-10-28

The reviewed frontend branch has now been merged into dev with the separate admin
app. Mock-day toasts, Coach/onboarding wording, sensor sheets, and optional street
labels now honor synthetic provenance. Demo sensor factories explicitly mark their
values mock. Vector tiles remain deferred; the optional street overlay stays off.
Root just recipes and CI jobs now check both apps, and Compose CORS includes the
admin's localhost:3200 origin. The original review evidence above remains historical.
