> Current runtime (2026-10-29): `just up` serves real stored provider data. Overview
> and Source data read `/api/v1/data-status`; synthetic traffic/upload figures have
> been removed. Client uploads and server request analytics remain unavailable.
> Configuration and endpoint-probe history stay in this browser. The older API
> proposals below are historical; see [runtime details](../../docs/integrations/real-data-runtime.md).

# EcoMAB Admin

A web admin for the EcoMAB platform: monitor data endpoints, review incoming client data and check system health.
It is a **second frontend**, separate from the public web client (`../frontend`), with the same visual identity
(palette, Inter, logo, card and button styles).

| Section | What it does |
|---|---|
| **Overview** | Healthy and degraded endpoint counts, requests and client data with trends, the endpoint table with details panel, the aggregated client-data chart and the data-type breakdown. On a window of at least 1360×720 it is a single screen with no page scroll, laid out like the reference design (it shows the 4 endpoints that need attention first, with a link to all of them). Smaller windows get a stacked layout that scrolls |
| **Endpoints** | Every endpoint the web client uses or expects. Search, filter by status and source, sort, add, edit, remove, check now, redirect configuration, per-endpoint latency history |
| **Client data** | Records, unique clients and requests over a date range, chart (records, clients or both), breakdown by type, recent uploads with filters, CSV export |
| **Settings** | Backend URL, check interval, timeout, "slow" threshold, default range, export / import configuration, restore defaults, clear history, access and privacy notes |

## Run it

```bash
npm install
npm run dev        # http://localhost:3200
npm test           # unit tests for probing, health rules, validation and statistics
npm run lint && npm run typecheck && npm run build
```

Optional: copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to the greenAir backend (or set it in Settings).
Without an override, the backend URL is `http://localhost:8000`.

## Data sources

| Part | Source |
|---|---|
| Endpoint status, latency, last check, uptime, recent checks | **Real.** A plain `GET` from your browser to each URL, timed until the response headers arrive. Third-party endpoints (Open-Meteo, atrai.bike, Photon, OpenFreeMap) are checked for real today. greenAir endpoints are checked as soon as a backend URL is set. |
| Healthy / degraded counts and their "vs. previous check" trend | **Real**, derived from the checks above. |
| Provider counts, refresh status and processing builds | **Stored real data** from `/api/v1/data-status`, including UTC times and source-status CSV. |
| Total server requests, client uploads and unique clients | **Unavailable.** There is no collection service; these figures are not generated. |
| Wearable sync endpoint | **Planned.** No such endpoint exists (wearable data stays on the device). Shown as Not configured. |
| Adding, editing, removing endpoints and redirect settings | **Saved in this browser only.** They change what the admin checks, not what the web client calls. The redirect dialog says so. |

How status is decided (`src/lib/health.ts`): **Offline** when the last check failed (HTTP error, timeout, unreachable);
**Degraded** when it passed but was slower than the threshold (default 1 s) or one of the previous four checks failed;
**Healthy** for a verified HTTP 2xx response within the threshold; **Not configured** when there is no URL (or `{base}` without a backend URL).
CORS-hidden responses are **Unverified**, including older stored opaque successes. They cannot count as healthy or inflate uptime.
These checks establish HTTP reachability, not payload validity, ingestion success or data freshness.
Each row shows its source/actual host. External provider URLs are independent of the backend URL in Settings.
Changing that URL clears old backend probe history; delayed results for replaced URLs are discarded.
Read Source data for stored inputs, refresh states and build times.

## Access control: none

**There is no sign-in, no roles and no server.** Anyone who can open this address can see and change everything in it.
The app says so in the sidebar, on Overview and in Settings. Keep it on a private network or behind an authenticating
proxy until real access control exists. What it does to limit harm: it is served `noindex`, refuses to be framed
(`X-Frame-Options: DENY`), sends no referrer, refuses endpoint URLs that contain credentials or API keys (they would be
stored unencrypted), and keeps everything in local storage only.

## Structure

```
src/app/            Overview (page.tsx), endpoints/, client-data/, settings/, error + not-found
src/components/     Shell (sidebar, tablet rail, mobile bottom nav), AdminProvider (state + checks), EndpointTable,
                    EndpointDetails, EndpointDialogs, Charts (SVG, no chart library), StatCard, ui primitives
src/lib/            types, defaults (the endpoint catalogue), probe, health, validate, sim, stats, storage, csv
tests/              node:test unit tests
```

The endpoint catalogue in `src/lib/defaults.ts` follows the "Expected API endpoints" section of the web client's README
(`apps/web` in the greenAir repository). The design tokens in `src/app/globals.css` and `public/brand.png` are copies from
the web client; if the identity changes, update both.

## Known limits

- Checks come from the admin's browser, so they measure what you can reach from there; real monitoring belongs on a server.
  Checks run only while the admin is open.
- Configuration and history are per browser: not shared between admins or devices, not encrypted, lost if site data is cleared.
- Redirect settings are a record of intent. Nothing applies them.
- Pipeline counts describe the stored database; real check history starts with this browser.
- Browser consoles log a "Failed to load resource" line when a checked endpoint answers with an error. That is the check working.
- Browser coverage is Chrome; Safari/Firefox and real Bluetooth hardware need separate validation.


## Docker

From the repository root, `just up` builds and starts the API, web and admin;
`just down` removes the application containers/network without deleting volumes.
Web is at http://localhost:3000, admin at http://localhost:3200 and API docs at
http://localhost:8000/docs. See [stack configuration](../../README.md#run-everything-with-docker)
for custom ports and the browser API URL, which is embedded during image builds.
The existing npm development and validation commands remain available.
