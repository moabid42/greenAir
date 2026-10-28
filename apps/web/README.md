# Web client boundary

The MapLibre web client for greenAir (EcoMAB Heilbronn), built with Next.js. It consumes the
backend's REST API, then vector tiles and score update SSE once those interfaces exist.
Until the backend serves data it runs in demo mode.

See the [architecture mapping](../../docs/architecture.md).

This README documents **both frontends**: the public web client ([Expected API endpoints](#expected-api-endpoints)) and the
admin frontend ([Admin frontend](#admin-frontend)). If you are new here, read `readme_before_readme.txt` in this folder first.

Built for the Green City Hackathon Heilbronn, Oct 2026. **Mobile first**: it is a phone app (installable PWA). On a big screen it shows as a phone-sized column.

## Run it

Run the commands below from this folder (`apps/web`).

```bash
npm install
npm run dev -- -p 3100     # http://localhost:3100  (port 3000 works too if it is free)
```

Open it on a phone-sized window (or your phone, same Wi-Fi: `http://<laptop-ip>:3100`). Install and GPS need HTTPS (e.g. a Vercel deploy).

No backend yet? It runs in **demo mode**: real Open-Meteo weather and air quality for Heilbronn, spread over the city with a local model. Real senseBox:bike cycling data loads from atrai.bike. When the backend exists: copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` (shapes in [Expected API endpoints](#expected-api-endpoints)).

Optional street-by-street scores (vector tiles + `/scores`, `/score`): set `NEXT_PUBLIC_ECOMAB_API_BASE_URL`. Off by default; the client in `src/lib/api/consumer.ts` has been exercised only against a stub, not a deployed service.

**Look and feel** follows the EcoMAB identity: deep green `#075b4a` on mint, Inter, the leaf-and-route logo (`public/brand.png`).

## What is in the app

| Screen | What it does |
|---|---|
| **Intro** (first run) | Sport, where you start, what you are sensitive to |
| **Map tools** | On Today and Explore: use my location, map layers (views, sensor markers, legend), reset north, and a data-status pill. Tap a sensor marker for its readings, source and time |
| **Today** | Map first. The Day Dial is the time control (tap or drag the ring). Best window, conditions, best spots on the map. Lens chips: Overall / Heat / Air / Traffic / Wind |
| **Week sheet** | Pick a day: today, tomorrow, a real hot day (20 Jun), any date, plus a 7-day outlook with each day's best window |
| **Explore** | Flat city map. Scrub or play through the day; heat alert; best places for the chosen layer |
| **Place** | One spot up close: dial, best time, 6 factors, save, navigate, remind |
| **Ride** | Real measured road roughness and overtaking distance from senseBox:bike, inside your reach |
| **Coach** | Ask anything. Answers come from the live data, with cards and action buttons. Voice input where the browser supports it |
| **Analytics** | Environment for today or the next 7 days, wearable sample sessions joined to the real weather and air at the closest hour, your local-only readings (export / delete) |
| **Devices** | Simulated WHOOP and Apple Watch sessions, a real Bluetooth heart-rate sensor (Web Bluetooth), privacy and sync controls, plus the watch faces, alerts and workout sources from before |
| **Me** | Preferences that change the scores, saved places, reminders, data and privacy |

## The Coach

Works with **no key**: a built-in analyst (`src/lib/coach/engine.ts`) understands the question (time, day, topic) and answers from the data.

**Private on-device AI (optional).** In the Coach tap **AI**, then **Download Qwen3-0.6B** (about 0.45 GB, once). After that the model chats in the browser and nothing is sent to any server.

- Model: Qwen3-0.6B, **GGUF Q5_K_M** (`unsloth/Qwen3-0.6B-GGUF`; the official `Qwen/Qwen3-0.6B-GGUF` repo only ships Q8_0).
- Runtime: `@wllama/wllama` (llama.cpp compiled to WebAssembly). The `.wasm` is served from `public/wllama/`, not a CDN. WebGPU is used when available, otherwise the CPU (4 threads, which needs the COOP/COEP headers in `next.config.ts`).
- **Thinking mode is off** (`reasoning: false` plus `enable_thinking: false`). Answers are capped at 70 tokens, low temperature and a fixed seed keep them brief and consistent.
- **Division of labour:** data questions (best time, heat, air, wind, where, week, routes) are answered instantly and exactly by the built-in analyst (`src/lib/coach/engine.ts`). The model handles conversation, because a 0.6B model repeats numbers instead of reasoning about them.
- The fixed start of the prompt (`src/lib/ai/prompt.ts`) is pre-processed once at load and reused, which is what keeps replies quick on a CPU.
- It sleeps 45 s after the app goes to the background. Preferences and optional chat history live in `localStorage` (not encrypted).

## Honest limits

- **Watch sync:** a website cannot read Apple Health / Health Connect / Garmin. Reminders reach a paired watch because phones mirror notifications. Reading workouts needs the native app.
- **Reminders** fire while the app is open or alive in the background. Reliable background delivery needs a push server.
- Street-by-street differences in demo mode come from a simple model (parks and the Neckar cool, main roads add NO₂). City-wide weather and air are real.
- Rush hours 7–9 and 16–18 are an approximate German-city prior, not a Heilbronn measurement.

## Where things live

```
src/
  app/                       page, layout, manifest
  state/app.tsx              all app state: preferences, data, navigation, reminders
  components/
    shell/                   MobileShell (phone frame), TabBar
    map/                     MapStage (steers the camera per screen), SportMap (MapLibre)
    screens/                 Today, Explore, Place, RideCard, Coach, Analytics, Devices (+ WatchAlerts), Me, Onboarding
    sheets/                  LocationSheet, WeekSheet
    ui/                      DayDial, HourBars, Sheet, Toggle, ActivityPicker
  lib/
    api/                     types (the backend contract), client, demo data, atrai, geocode
    score.ts  lens.ts  rank.ts  ride.ts  dial.ts  reminders.ts  prefs.ts
    coach/engine.ts          the Coach's analyst
```

Preferences, saved places and reminders live only in the phone's `localStorage`.

## Expected API endpoints

Every HTTP interface the web client (EcoMAB Heilbronn) uses or expects: what each endpoint
returns, the rules the UI relies on, how often it is called and what users see when it fails.
It is written for the backend (`services/backend`) and for anyone wiring the client to real data.

- **Source of truth for the shapes:** `src/lib/api/types.ts` (core API) and `src/lib/api/consumer.ts`
  (optional street scores). File paths below are relative to `apps/web`.
- **Working reference implementation:** `src/lib/api/demo.ts` and `src/lib/model.ts`. With no backend configured the
  client runs in *demo mode*: real Open-Meteo weather and air quality, spread over the city by a local model. A backend
  can copy that logic and replace its inputs with real data.
- **The one module that talks to the backend:** `src/lib/api/client.ts`.

## Contents

1. [Status at a glance](#1-status-at-a-glance)
2. [Configuration](#2-configuration)
3. [Conventions](#3-conventions)
4. [How the score works (backend vs client)](#4-how-the-score-works-backend-vs-client)
5. [Core endpoints](#5-core-endpoints)
   - [`GET /health`](#get-health)
   - [`GET /api/v1/day`](#get-apiv1day)
   - [`GET /api/v1/grid`](#get-apiv1grid)
   - [`GET /api/v1/sensors`](#get-apiv1sensors)
6. [Optional: street-by-street scores](#6-optional-street-by-street-scores)
7. [Data the client loads directly from third parties](#7-data-the-client-loads-directly-from-third-parties)
8. [Call patterns and failure behaviour](#8-call-patterns-and-failure-behaviour)
9. [Privacy rules for the API](#9-privacy-rules-for-the-api)
10. [Acceptance checklist](#10-acceptance-checklist)
11. [Open questions and assumptions](#11-open-questions-and-assumptions)

---

### 1. Status at a glance

| Endpoint | Needed for | Called by the client today | Exists in `services/backend` |
|---|---|---|---|
| `GET /health` | Liveness (deploy checks) | No | **Yes** |
| `GET /api/v1/day?date=` | Best time, timeline, reasons, week outlook, Analytics, Coach | **Yes** (required) | No |
| `GET /api/v1/grid?date=` | Best places, per-place view, ranking, tap-a-place | **Yes** (required) | No |
| `GET /api/v1/sensors` | Sensor markers and their details sheet | **Yes** (optional, degrades to no markers) | No |
| `GET /scores` | Street segment colours on the map | Only if `NEXT_PUBLIC_ECOMAB_API_BASE_URL` is set | No |
| `GET /score` | "Street conditions" details sheet | Only if the above is set | No |
| `GET /tiles/segments/{z}/{x}/{y}.pbf` | Street segment geometry (vector tiles) | Only if the above is set | No |
| `GET /status`, `GET /events` (SSE) | Build/freshness, live refresh | Not yet (reserved) | No |

The three core endpoints (`day`, `grid`, `sensors`) are all the app needs to run end to end. Everything in section 6 is
an optional enhancement and is **off** unless configured.

### 2. Configuration

| Variable (client, build time) | Meaning | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the core API, no trailing slash, e.g. `http://localhost:8000`. **Unset = demo mode.** | unset |
| `NEXT_PUBLIC_ECOMAB_API_BASE_URL` | Base URL of the optional street-score API (section 6). May be the same host. | unset (feature off) |

`NEXT_PUBLIC_*` values are embedded in the browser bundle, so they must never hold secrets.

**CORS.** The browser calls the API directly, with no proxy. The backend reads `GREENAIR_CORS_ORIGINS`
(see `services/backend/app/core/config.py`), a JSON list, for example:

```sh
GREENAIR_CORS_ORIGINS='["http://localhost:3000","https://web.example.org"]'
```

The client sends plain `GET` requests with only `Accept: application/json` (no cookies, auth or custom headers), so no
CORS preflight is triggered. Keep it that way: please do not require custom request headers.

### 3. Conventions

| Topic | Rule |
|---|---|
| Format | JSON, UTF-8, `Content-Type: application/json` (vector tiles: `application/vnd.mapbox-vector-tile`). |
| Local time | **All hours are Europe/Berlin wall-clock hours, 0–23.** Arrays of 24 are indexed by hour. Daylight-saving days still return exactly 24 entries (index = wall-clock hour). |
| Dates | `YYYY-MM-DD`, interpreted in Europe/Berlin. |
| Instants | ISO 8601 UTC with `Z` (e.g. `generatedAt`, `updatedAt`). |
| Scores | Every factor score is **0–100, where 100 = best for sport**. Integers or decimals are accepted; the client rounds for display. Out-of-range values are not clamped by the client, so clamp on the server. |
| Units | °C, % relative humidity, µg/m³ for PM2.5 and NO₂, km/h for wind, metres for coordinates' grid size. |
| Coordinates | WGS84, GeoJSON order `[longitude, latitude]` (the sensor objects use separate `lat` / `lng` fields). |
| Compression | Please serve gzip or brotli. The grid is roughly 600 KB uncompressed. |
| Caching | `day` and `grid` for a past date are immutable; for today/future they change as forecasts update. Recommended: `Cache-Control: public, max-age=300` for today and the next days, `max-age=86400, immutable` for past dates. `sensors`: `max-age=60`. |
| Versioning | Core paths are under `/api/v1`. A breaking change needs `/api/v2`; additive fields are safe (the client ignores unknown fields). |
| Errors | The client only checks `res.ok`. Any non-2xx is a failure and the body is **not** read. Use standard codes anyway (below) and, ideally, a JSON body such as `{ "detail": "…" }` for logs. |
| Auth | None. The API is public and read-only. |

**Status codes the backend should use**

| Code | When |
|---|---|
| `200` | Success. |
| `404` | No data for that date (for example beyond the forecast horizon, or before data exists). |
| `422` | Malformed query parameter (for example `date=2026-13-40`). |
| `503` | Upstream data temporarily unavailable. The client shows its retry state. |

### 4. How the score works (backend vs client)

The backend computes **per-factor scores** (and the raw measurements behind them). The client turns them into **one index
per sport** — so switching Run / Ride / Walk, or turning on "sensitive to air / heat", never needs a new request.
**The backend must not apply sport weights itself.**

#### 4.1 Factors

| Factor | Meaning | Suggested inputs | Reference curve (`src/lib/model.ts`) |
|---|---|---|---|
| `heat` | How comfortable the temperature is | senseBox:home and Mobile Datalogger temperature and humidity, DWD | `perceived = T + (T>20 && RH>60 ? (RH-60)·0.1 : 0)`; `100` for 5–18 °C; `100 − (perceived−18)·6.5` above; `100 − (5−perceived)·5` below; clamped 0–100 |
| `air` | Air cleanliness | senseBox:home PM2.5, **LUBW Weinsberger Straße NO₂** | `100 − (pm25/25)·55 − (no2/100)·45`, clamped |
| `wind` | Is it calm enough | DWD / Bright Sky / Open-Meteo | `100` up to 15 km/h, then `100 − (v−15)·3`, clamped |
| `traffic` | Commuter-peak exposure | hourly bike counts and the NO₂ daily shape ("commuter fingerprint") | `100 − rush·(15 + exposure·85)`, clamped; `exposure` 0–1 = how "main-road" a place is |
| `light` | Can you see and be seen | sun position | `max(daylight·100, min(35, streetLit·40 + 5))`: a lit street at night never scores above 35 |
| `safety` | Road surface and overtaking safety (cyclists) | senseBox:bike roughness and overtaking distance (atrai) | Static per place, 0–100. `null` where there is no bike data nearby |

`rush` (0–1) is how strongly an hour is a commuter peak. The demo uses an approximate German-urban prior (peaks around
07–09 and 16–18, small on weekends); **the backend should replace it with measured bike counts and the NO₂ shape.**

#### 4.2 Weights and the index (computed in the client, `src/lib/score.ts`)

| Sport | heat | air | wind | traffic | light | safety |
|---|---|---|---|---|---|---|
| Run | 0.30 | 0.30 | 0.10 | 0.20 | 0.10 | 0 |
| Ride | 0.20 | 0.20 | 0.15 | 0.15 | 0.10 | 0.20 |
| Walk | 0.30 | 0.35 | 0.05 | 0.20 | 0.10 | 0 |

"Sensitive to air" multiplies the `air` weight by 1.7; "sensitive to heat" multiplies `heat` by 1.7.

```text
mean    = Σ(score·weight) / Σ(weight)          // factors with weight 0 or a null score are skipped
penalty = max(0, 45 − weakest factor) · 0.9
index   = clamp(mean − penalty, 0, 100)
if any factor < 40 (a "dealbreaker"): index = min(index, 59)
```

A dealbreaker means "too hot" or "dark" can never be shown as "good". The UI words the index as: 75 and above "Go now",
60–74 "Good to go", 40–59 "Could be better", below 40 "Better wait".

### 5. Core endpoints

#### `GET /health`

Liveness only. **Already implemented** (`services/backend/app/api/routes/health.py`).

```json
{ "status": "ok", "service": "greenAir API" }
```

Not called by the client; use it for deployment health checks.

---

#### `GET /api/v1/day`

City-wide conditions for one date, one entry per hour. Drives the hero "best time" card, the day dial, the plain-language
reasons, the week outlook, Analytics and the Coach.

**Query**

| Param | Required | Format | Notes |
|---|---|---|---|
| `date` | yes | `YYYY-MM-DD` | Europe/Berlin day. Must work for **today and at least the next 6 days** (the 7-day outlook), and for **past dates** (the date picker and the "hot day" shortcut `2026-06-20` use history). |

**Response `200`** — `DayForecast`

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | string | yes | Echo of the request. |
| `timezone` | `"Europe/Berlin"` | yes | Always this literal. |
| `generatedAt` | string (ISO UTC) | yes | When this snapshot was produced. |
| `source` | `"measured" \| "forecast" \| "mock"` | yes | Shown as a badge ("measured" / "forecast" / "simulated"). Use `measured` for past days built from observations, `forecast` for future days, `mock` only for synthetic data. |
| `hours` | array of 24 `HourConditions` | yes | **Exactly 24 entries, sorted, `hours[i].hour === i`.** |

`HourConditions`

| Field | Type | Unit / range | Description |
|---|---|---|---|
| `hour` | integer | 0–23 | Wall-clock hour in Europe/Berlin. |
| `tempC` | number | °C | Air temperature. |
| `humidity` | number | % | Relative humidity. |
| `pm25` | number | µg/m³ | Fine dust, from senseBox:home. |
| `no2` | number | µg/m³ | Nitrogen dioxide, from LUBW Weinsberger Straße. |
| `windKmh` | number | km/h | Wind speed. |
| `rush` | number | 0–1 | Commuter-peak strength. |
| `daylight` | number | 0–1 | 0 = dark, 1 = full daylight (twilight ramps in between). |
| `factors` | object | each 0–100 | **All six keys required:** `heat`, `air`, `wind`, `traffic`, `light`, `safety`. `safety` is a number here even though it only matters for cycling (use the city-wide figure). |

**Example** (abridged to two hours; the real response has 24)

```json
{
  "date": "2026-06-20",
  "timezone": "Europe/Berlin",
  "generatedAt": "2026-06-20T05:00:00Z",
  "source": "measured",
  "hours": [
    {
      "hour": 0,
      "tempC": 22.1, "humidity": 55,
      "pm25": 6.4, "no2": 14.0,
      "windKmh": 7.0,
      "rush": 0.02,
      "daylight": 0.0,
      "factors": { "heat": 74, "air": 85, "wind": 100, "traffic": 99, "light": 13, "safety": 70 }
    },
    {
      "hour": 1,
      "tempC": 21.6, "humidity": 57,
      "pm25": 6.1, "no2": 12.5,
      "windKmh": 6.0,
      "rush": 0.01,
      "daylight": 0.0,
      "factors": { "heat": 77, "air": 87, "wind": 100, "traffic": 100, "light": 13, "safety": 70 }
    }
  ]
}
```

**What the client does with it**

- Picks the best consecutive windows per sport from `factors` and shows `tempC`, `pm25` and `windKmh` as the explanation.
- Uses `rush` and `daylight` for the "Rush hour" and "Daylight" tiles.
- Shows `source` and, in Analytics, the same raw values next to wearable samples.
- Makes **one request per date**: the selected day, plus one per day for the 7-day outlook (Week sheet, Analytics) and any
  day the Coach is asked about. Days that fail in the outlook are simply left out.

**Failure behaviour.** If the *selected* day fails, the whole data load fails and the user sees "We couldn't load the data"
with a Retry button; the map stays usable. The grid is not requested after a failed day.

---

#### `GET /api/v1/grid`

A grid of small cells over the city, each with per-hour factor scores. Drives **"best places"**, the per-place view, the
ranking within the user's reach, and tap-a-place on the map. (An earlier version blurred the cells into a colour surface;
that overlay was removed, so cells no longer need to tile perfectly — see the invariants.)

**Query**

| Param | Required | Format | Notes |
|---|---|---|---|
| `date` | yes | `YYYY-MM-DD` | Same dates as `/day`. The grid for a date must be consistent with `/day` for that date. |

**Response `200`** — `GridResponse`

| Field | Type | Description |
|---|---|---|
| `date` | string | Echo of the request. |
| `cellSizeM` | number | Nominal cell edge in metres (the demo uses `250`). |
| `cells` | GeoJSON `FeatureCollection` | One `Feature` per cell. |

Each cell `Feature`:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"Feature"` | yes | |
| `geometry` | GeoJSON `Polygon` | yes | One closed ring of 5 `[lng, lat]` points (4 corners + the first point repeated), WGS84. |
| `properties.id` | string | yes | **Stable and unique**, and the same across dates (for example `r12c7`). Used as the cell's identity in the UI and for saved places. |
| `properties.place` | string | yes | Nearest named place shown to the user (for example `"Pfühlpark"`). Human-readable and stable. Duplicates across cells are fine. |
| `properties.heat` | number[24] | yes | Per-hour heat score for this cell, 0–100. |
| `properties.air` | number[24] | yes | Per-hour air score. |
| `properties.wind` | number[24] | yes | Per-hour wind score. |
| `properties.traffic` | number[24] | yes | Per-hour traffic score. |
| `properties.light` | number[24] | yes | Per-hour light score. |
| `properties.safety` | number \| `null` | yes | Static surface and overtaking safety, 0–100. **`null` where there is no bike data nearby.** |
| `properties.green` | number | yes | 0–1 share of green and water around the cell (shown as "Green %"). |

**Example** (one cell, arrays shortened here; the real ones have 24 numbers)

```json
{
  "date": "2026-06-20",
  "cellSizeM": 250,
  "cells": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[[9.2100, 49.1400], [9.2136, 49.1400], [9.2136, 49.1423], [9.2100, 49.1423], [9.2100, 49.1400]]]
        },
        "properties": {
          "id": "r12c7",
          "place": "Pfühlpark",
          "heat":    [74, 77, 80, 82, 84, 84, 80, 72, 64, 58, 52, 48, 45, 44, 44, 46, 50, 56, 62, 68, 71, 72, 73, 74],
          "air":     [85, 87, 88, 88, 87, 84, 78, 70, 66, 70, 74, 78, 80, 82, 82, 80, 76, 72, 74, 78, 82, 84, 85, 85],
          "wind":    [100, 100, 100, 100, 100, 100, 100, 98, 95, 92, 90, 88, 88, 90, 92, 94, 96, 98, 100, 100, 100, 100, 100, 100],
          "traffic": [99, 100, 100, 100, 98, 92, 80, 62, 58, 78, 90, 92, 90, 90, 88, 80, 66, 60, 70, 88, 96, 98, 99, 99],
          "light":   [13, 13, 13, 14, 20, 45, 75, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 85, 40, 15, 13],
          "safety": 64,
          "green": 0.8
        }
      }
    ]
  }
}
```

**Invariants the client relies on**

- Every score array has **exactly 24** numbers. A shorter array would read `undefined` for later hours.
- `id` is unique within the response and stable across dates.
- Coverage: the demo grid spans the box **west 9.15, south 49.105, east 9.275, north 49.178** (about 1,150 cells at 250 m).
  The client finds "the cell for a location" by **nearest cell centroid**, and ranks places by centroid distance, so use a
  roughly uniform cell size and cover the whole area users can pick (the client allows a start point up to 3 km outside it).
- Index and ranking are computed in the client from these factors (section 4.2). Do not pre-combine them.
- Size is about 600 KB uncompressed for 1,150 cells — please gzip.

**Failure behaviour.** Requested right after `/day` for the same date; failing it counts as a failed data load (retry
state). Fetched once per selected date, and again by the Coach when a question needs another date.

---

#### `GET /api/v1/sensors`

Real sensors shown as markers. Tapping a marker opens a sheet with its readings, source and time.

**Query:** none. **Response `200`:** array of `Sensor`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable id (for example an openSenseMap box id). |
| `name` | string | yes | Shown as the sheet title. |
| `kind` | `"sensebox_home" \| "lubw" \| "bike_counter"` | yes | Selects the marker colour and the source line in the sheet. |
| `lat`, `lng` | number | yes | WGS84 position. |
| `latest` | object `string → number \| null` | yes | Latest readings. **Keys are free-form and shown (upper-cased) as labels**, so use readable names: `Temperature`, `PM2.5`, `Humidity`, `NO2`. `null` is shown as "—". One decimal place is enough. |
| `updatedAt` | string (ISO UTC) \| `null` | yes | Time of the latest reading. `null` shows "time unavailable". |

**Example**

```json
[
  {
    "id": "69b99dd4deee28000952cea8",
    "name": "GreenCity OpenSpace",
    "kind": "sensebox_home",
    "lat": 49.151748, "lng": 9.215319,
    "latest": { "Temperature": 21.3, "PM2.5": 4.2, "Humidity": 58 },
    "updatedAt": "2026-10-27T20:00:00Z"
  },
  {
    "id": "lubw-weinsberger",
    "name": "LUBW Weinsberger Straße",
    "kind": "lubw",
    "lat": 49.1497, "lng": 9.2342,
    "latest": { "NO2": 18.4 },
    "updatedAt": "2026-10-27T20:00:00Z"
  }
]
```

**Frequency and failure.** The client asks for sensors whenever the selected day or hour changes (the hour only matters
to demo mode), but reuses one answer for 60 seconds in backend mode, so expect roughly one request per minute per active
user. A failed request shows no markers and nothing else breaks.

---

### 6. Optional: street-by-street scores

Off by default. Set `NEXT_PUBLIC_ECOMAB_API_BASE_URL` to switch it on. When on, the **Overall** layer draws every street
segment coloured by its score, and tapping a street opens a "Street conditions" sheet. Segment geometry arrives as vector
tiles; scores arrive separately and are joined by an integer `segment_id`.

> Status: implemented in the client (`src/lib/api/consumer.ts`, `src/components/map/segmentOverlay.ts`) and exercised only
> against a stub server. **It has not been verified against a deployed backend, and no backend implements it yet.**
> Responses are validated before use; anything that does not match is rejected and the normal map stays.

#### `GET /scores`

Scores for **all segments** for one profile and one hour.

| Param | Format |
|---|---|
| `profile` | `running`, `cycling` or `walking` (client sport `run` / `ride` / `walk`) |
| `t` | UTC hour, exactly `YYYY-MM-DDTHH:00:00Z`. The client converts the selected Berlin hour to UTC (handles summer/winter time). |

**Response `200`**

```json
{
  "profile": "running",
  "t": "2026-10-29T13:00:00Z",
  "kind": "forecast",
  "version": "1",
  "build_id": "b1",
  "scores": { "12": [82, 0.9, 0], "13": [35, 0.5, 4] }
}
```

| Field | Rules |
|---|---|
| `profile`, `t` | **Must echo the request exactly**, or the client discards the response (guards against stale/out-of-order answers). |
| `kind` | `observed` or `forecast`; shown as "Street scores · observed/forecast". |
| `version` | Non-empty string. |
| `build_id` | Non-empty string identifying the segment geometry build. The client reloads tiles when it changes and never joins scores from a different build. |
| `scores` | Object keyed by **integer** `segment_id` (as a string). Each value is the tuple `[score, confidence, flags]`: `score` integer 0–100 (**0 is a valid score**), `confidence` 0–1, `flags` non-negative integer bit field. An absent segment is drawn neutral grey. |

**Flag bits:** `1` rain, `2` air, `4` alert, `8` interpolated, `16` stale. Currently, any of bits 1, 2 or 4 draws the segment
in dark red ("conditions apply"); bits 8 and 16 are carried for the detail view.

**Rendering rules (for reference):** colour by score steps at 20/40/60/80 (red → green); line opacity `0.3 + 0.7·confidence`;
grey for no score or a tile `coverage` of `"none"`.

**Timeout and races:** 8 seconds. The client aborts the previous request when the sport or hour changes.

#### `GET /tiles/segments/{z}/{x}/{y}.pbf?v={build_id}`

Mapbox Vector Tiles of the street network.

- Source layer name: **`segments`**.
- Each feature must have an integer property **`segment_id`** (the client promotes it to the feature id and joins scores by it).
  OpenStreetMap ids must **not** be used as segment ids.
- Optional feature properties: `coverage` (`"none"` = no verified data, drawn grey), `name`.
- `v={build_id}` is a cache-buster: the response for a given `v` is immutable, so serve it with
  `Cache-Control: public, max-age=31536000, immutable`.
- CORS and `Content-Encoding: gzip` as for the rest of the API.

#### `GET /score`

Detail for **one street** near a tapped point.

| Param | Format |
|---|---|
| `lat`, `lon` | WGS84 of the tap |
| `profile`, `t` | As for `/scores` |

**Response `200`**

```json
{
  "segment_id": 1,
  "name": "Stub street",
  "t": "2026-10-29T13:00:00Z",
  "kind": "forecast",
  "score": 82,
  "confidence": 0.9,
  "components": [
    { "key": "air", "label": "Air", "value": 8, "unit": "µg/m³", "weight": 0.3, "source": "forecast" }
  ],
  "gates": [],
  "missing": ["surface"]
}
```

| Field | Rules |
|---|---|
| `segment_id` | Integer. |
| `score`, `confidence` | 0–100 and 0–1. Confidence under 0.3 is shown as "little data". |
| `components[]` | `key`, `label`, `value` (number, string or `null` → "Unavailable"), `unit`, `weight`, `source` (`observed`, `forecast`, `static` or `interpolated`). Optional `goodness`, `contribution`. |
| `gates` | Conditions that apply (for example `"rain"`), shown as a warning line. |
| `missing` | Inputs that were not available, listed under "Not available". |

If there is no street near the point, return `404`. The client then says "No street data is available here", never an
invented value.

#### Reserved (not called by the client yet)

`GET /status` → `{ "build_id": "…", "sources": [{ "id": "…", "status": "ok|stale|down" }] }` and `GET /events`
(Server-Sent Events: `scores.updated` `{profile, t}` and `segments.rebuilt` `{build_id}`) are planned for freshness
information and live refresh. The client has a validating `status()` helper but does not call it. Implement them when
convenient; nothing depends on them today.

### 7. Data the client loads directly from third parties

The browser calls these itself. They are CORS-open and need no backend. The backend may later proxy or replace them
(the data reference is `docs/GREENCITY_HEILBRONN_COMPLETE_DATA_REFERENCE_2026-10-28.md`).

| Service | Used for | Request |
|---|---|---|
| **atrai.bike** (senseBox:bike OGC API) | Real cycling layers on the ride map and the Ride card statistics | `GET https://api.atrai.bike/collections/{collection}/items?f=json&limit=10000` with `collection` = `bumpy_roads_heilbronn` (road surface), `overtaking_distance_heilbronn` (close passes), `danger_zones_heilbronn` (danger zones). Loaded lazily, only in ride mode. Fields read: `properties["Normalized Roughness"]`, `properties["Average Overtaking Distance cm"]`, `properties.name`. |
| **Photon** (OpenStreetMap geocoder) | Address search and reverse lookup in the location sheet | `GET https://photon.komoot.io/api/?q=…&lat=49.142&lon=9.219&bbox=9.10,49.08,9.32,49.20&limit=6&lang=de` and `GET https://photon.komoot.io/reverse?lat=…&lon=…&limit=1&lang=de` |
| **Open-Meteo** (demo mode only) | Real weather and air for the demo city model | Forecast `https://api.open-meteo.com/v1/forecast`, archive `https://archive-api.open-meteo.com/v1/archive` (days older than about 85 days), air quality `https://air-quality-api.open-meteo.com/v1/air-quality`. Variables: `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `pm2_5`, `nitrogen_dioxide`. Not called when `NEXT_PUBLIC_API_URL` is set. |
| **OpenFreeMap** and **Mapzen terrain** | Map tiles, 3D buildings and terrain | `https://tiles.openfreemap.org/styles/positron`, terrarium terrain tiles. |

Other data worth feeding the backend with: senseBox:home (about 2M rows,
`https://api.atrai.bike/collections/osem_home_data_heilbronn/items?f=json`), openSenseMap boxes of the project
(`https://api.opensensemap.org/boxes?grouptag=GreenCityHN`), LUBW hourly NO₂ at Weinsberger Straße (external, must be
fetched by the backend), and bike counts from OpenData Heilbronn / MobiData BW.

### 8. Call patterns and failure behaviour

**App start (backend mode)**

1. `GET /api/v1/day?date=<today>`
2. then `GET /api/v1/grid?date=<today>` (sequential)
3. then `GET /api/v1/sensors`

Changing the date repeats 1–2. Opening the **Week sheet** or **Analytics → 7 days** adds seven `GET /api/v1/day` calls
(today + 6). The **Coach** may call `day` and `grid` for a date mentioned in a question. Dragging the day dial sends **no new
requests** (all 24 hours are already in memory; the sensor list comes from its 60-second cache).

**What users see when something fails**

| Failure | Result |
|---|---|
| `/day` or `/grid` for the selected date | "We couldn't load the data" card with Retry; the base map still works. |
| One day of the 7-day outlook | That day is omitted from the outlook. |
| `/sensors` | No sensor markers. |
| `/scores` | Street overlay is hidden; the normal map and scores remain. |
| `/score` | "No street data is available here." |
| Slow response | No client-side timeout on core calls (street-score calls time out after 8 s). Please respond within a few seconds. |

**Rough load per active user:** a handful of requests per session, one 600 KB grid per date change, and about one
`/sensors` request per minute. Core responses are cacheable and identical for every user.

### 9. Privacy rules for the API

- **No endpoint takes or returns anything about a person.** The client never sends the user's location, sport, name or
  preferences. `day`, `grid` and `sensors` are city-wide; the client finds "your" cell and ranks places locally.
- The only coordinates sent are the map tap for `/score` (street lookup), and only when street scores are switched on.
- Please keep it that way: no cookies, no per-user logging of query parameters beyond normal access logs, no request
  headers that identify a user.
- Wearable data (simulated or from Bluetooth) stays in the browser and is never uploaded; there is no endpoint for it.

### 10. Acceptance checklist

A backend is ready for the client when all of these hold:

- [ ] `GET /api/v1/day?date=` returns exactly 24 ordered hours with all six factor scores in 0–100, for today, the next 6
      days and past dates.
- [ ] `GET /api/v1/grid?date=` returns cells with unique stable `id`s, a non-empty `place`, five arrays of 24 scores,
      `safety` (number or `null`) and `green` (0–1), covering the Heilbronn box.
- [ ] `GET /api/v1/sensors` returns readable `latest` keys, a valid `kind` and ISO `updatedAt`.
- [ ] CORS allows the web origin (`GREENAIR_CORS_ORIGINS`) with simple `GET`s.
- [ ] Responses are gzip-compressed and carry sensible `Cache-Control`.
- [ ] Unknown or out-of-range dates return `404` / `422`, not a `200` with empty arrays.
- [ ] `source` is honest (`measured`, `forecast` or `mock`).
- [ ] Backend returns factor scores only, with no sport weighting and no combined index.
- [ ] *(Optional)* `/scores`, `/tiles/segments/…`, `/score` follow section 6, with matching `profile`/`t`, integer
      `segment_id`s and a stable `build_id`.

Quick manual check with the real client: set `NEXT_PUBLIC_API_URL=http://localhost:8000` in `.env.local`, run
`npm run dev`, open the app and watch the browser's Network tab: you should see `/api/v1/day`, `/api/v1/grid` and
`/api/v1/sensors` going to your base URL and no calls to `open-meteo.com`. (The status pill on the map reflects the `source`
field of `/day`: "Live data" for `measured`, "Live forecast" for `forecast`, "Simulated day" for `mock`. Demo mode also
says "Live forecast", so the pill alone does not prove the backend is in use.)

### 11. Open questions and assumptions

- **Forecast horizon.** The UI offers any date in the date picker and a 7-day outlook. Please state the real horizon;
  until then the client treats a `404` as "no data" and shows its retry state.
- **Wind scoring** uses speed only (no direction or gusts).
- **Rain** is not scored yet. The Coach says so when asked. If added, it would be a new factor, which is a change to
  `Factor`, `WEIGHTS` and the grid properties (additive but needs a coordinated release).
- **`rush` and `exposure`** are placeholders in the demo (a fixed commuter prior). Measured bike counts and NO₂ should
  replace them, and the choice of data source should be documented next to the endpoint.
- **Grid regularity.** Cells no longer need to tile exactly (the colour surface was removed). If a smooth overlay returns,
  a regular lng/lat grid will be required again.
- **Street scores (section 6)** come from a proposed contract. The shapes are validated by the client but have never been
  run against a real service. Treat section 6 as a proposal to agree on, not a finished interface.

## Admin frontend

A second frontend for the people who run the platform: it monitors the data endpoints, shows incoming client data and
reviews system health. It shares the web client's visual identity (palette, Inter, logo) but is a **separate app**, so its
code and endpoint settings never ship inside the public phone app.

- **Where it lives:** the `admin/` app in the frontend workspace (Next.js, `npm run dev` serves it on port 3200). It is
  **not in this repository yet**; its intended place is `apps/admin`.
- **Source of truth (in that app):** `src/lib/types.ts` (shapes), `src/lib/defaults.ts` (the endpoint catalogue),
  `src/lib/health.ts` (status rules), `src/lib/validate.ts` (input rules) and `src/lib/sim.ts` (the shape of the simulated
  client data).
- **Works without the backend today.** It checks real endpoints from the browser and labels everything else as simulated.
  This section describes what it needs from the backend to make the simulated parts real.

### Contents

- [A1. What the admin does today](#a1-what-the-admin-does-today)
- [A2. Backend status at a glance](#a2-backend-status-at-a-glance)
- [A3. How endpoint checks work (what the backend must allow)](#a3-how-endpoint-checks-work-what-the-backend-must-allow)
- [A4. Proposed admin API](#a4-proposed-admin-api)
- [A5. Access control and security expectations](#a5-access-control-and-security-expectations)
- [A6. Conventions for the admin API](#a6-conventions-for-the-admin-api)
- [A7. Failure behaviour in the admin](#a7-failure-behaviour-in-the-admin)
- [A8. Acceptance checklist](#a8-acceptance-checklist)
- [A9. Open questions](#a9-open-questions)

### A1. What the admin does today

| Section | What it shows or does |
|---|---|
| **Overview** | Counts of healthy and degraded endpoints, total requests, client data received (each with a trend), the endpoint health table, the selected endpoint's details (URL, status, last check, average latency, uptime, edit, redirect), the aggregated client-data chart (records and unique clients over time) and the breakdown by data type. On a window of at least 1360×720 it is one screen with no page scroll. |
| **Endpoints** | Every endpoint the web client uses or expects. Search, filter by status and source, sort, add, edit, remove, check now, redirect configuration and a latency history per endpoint. |
| **Client data** | Records, unique clients and requests for a date range (7, 14, 30 or 90 days) with trends against the previous period, a chart, the breakdown by type, recent uploads with filters and CSV export. |
| **Settings** | Backend URL, check interval, timeout and "slow" threshold, default date range, export and import of the configuration, restore defaults, clear history. |

**Real or simulated**

| Part | Source today |
|---|---|
| Endpoint status, latency, last check, uptime, recent checks, healthy and degraded counts | **Real.** A timed `GET` from the admin's browser to each URL. |
| Total requests, client data received, unique clients, data types, recent uploads | **Simulated sample**, labelled "Simulated" everywhere, including exports. Nothing produces this data yet. |
| Add, edit, remove endpoint and redirect settings | **Saved in the admin's browser only** (local storage). They change what the admin checks, not what the web client calls. |
| Sign-in | **None.** Anyone who can open the admin can use it. See A5. |

### A2. Backend status at a glance

| Capability | Used by the admin today | In `services/backend` |
|---|---|---|
| `GET /health` and the three web client endpoints (`/api/v1/day`, `/grid`, `/sensors`) are checked | **Yes**, from the browser | `/health` only |
| Server-side registry of endpoints and their health history | No (the browser keeps its own) | No |
| Create, update, delete endpoints and set redirects | No (local only) | No |
| Request totals per day | No (simulated) | No |
| Client-data summary, time series, recent uploads | No (simulated) | No |
| Client-data ingestion (clients send data to the platform) | No | No |
| Authentication and roles for admin routes | No | No |

The first row is the only one that works end to end. Everything else is a proposal in A4 for the team to agree on.

### A3. How endpoint checks work (what the backend must allow)

Each check is a plain request from the admin's browser. For an endpoint to be reported accurately:

| Rule | Detail |
|---|---|
| Method and headers | `GET` with only `Accept: application/json`; no cookies, no credentials, no custom headers (so no CORS preflight). Checked endpoints therefore must be readable without authentication. |
| Success | Any `2xx`. Redirects are followed by the browser. |
| Latency | Time until the **response headers** arrive. The body is never downloaded, so large responses such as `/api/v1/grid` (about 600 KB) cost nothing. |
| Timeout | 8 seconds by default (1–30 s in Settings). A timeout counts as offline. |
| Frequency | Every 60 seconds by default (off, 30 s, 1 min or 5 min), only while an admin tab is open: about ten small requests a minute per open admin. |
| Placeholders | `{base}` is the backend URL from Settings and `{today}` is today's date (`YYYY-MM-DD`). The default catalogue checks `{base}/api/v1/day?date={today}` and `{base}/api/v1/grid?date={today}`. |
| **CORS** | **The admin's origin must be in `GREENAIR_CORS_ORIGINS`.** Without it the browser hides the response: the admin can still tell the server is reachable, but it cannot read the status code or tell success from an error, and says so ("status hidden by CORS"). |

**Status rules** (`src/lib/health.ts`). The admin shows one of four states, and a server-side implementation should use the
same rules so both views agree:

| Status | Rule |
|---|---|
| `unconfigured` | No URL, or a `{base}` URL with no backend URL set. Not counted as healthy or degraded. |
| `offline` | The latest check failed: non-2xx, timeout or unreachable. |
| `degraded` | The latest check passed but took longer than **1,000 ms** (configurable), or one of the previous four checks failed. |
| `healthy` | Everything else. |

**Uptime** is successful checks divided by all checks in the window. **Average latency** is taken over the successful
checks. In the browser both only cover checks made in that browser since its first one; a server-side check history
would replace this.

**Default catalogue** (all `GET`): backend health `/health`, day forecast `/api/v1/day`, place grid `/api/v1/grid`,
sensors `/api/v1/sensors`, Open-Meteo weather and air quality, atrai.bike cycling data, Photon address search, the
OpenFreeMap base map style, and a planned wearable sync `/api/wearables` (no URL: no such endpoint exists).

### A4. Proposed admin API

> **Status: proposal, not implemented, not called by the admin yet.** Today the admin uses the simulated figures in A1.
> These endpoints would make them real. All admin routes live under `/api/v1/admin` and require authentication (A5).

#### A4.1 `GET /api/v1/admin/endpoints` — registry with server-side health

Replaces the browser-only history. Response `200`:

```json
{
  "generatedAt": "2026-10-28T21:54:00Z",
  "endpoints": [
    {
      "id": "backend-day",
      "name": "Day forecast",
      "path": "/api/v1/day",
      "url": "https://api.example.org/api/v1/day?date={today}",
      "category": "environment",
      "origin": "backend",
      "note": "City-wide hourly conditions.",
      "redirect": { "mode": "off", "target": "" },
      "health": {
        "status": "healthy",
        "checkedAt": "2026-10-28T21:53:30Z",
        "latencyMs": 184,
        "avgLatencyMs": 210,
        "p95LatencyMs": 380,
        "uptimePct": 99.8,
        "checks": 4320,
        "windowDays": 30,
        "lastError": null
      }
    }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | Stable, URL-safe slug. |
| `name` | 2–40 characters, unique (case-insensitive). |
| `path` | Optional label, starts with `/`, at most 80 characters. Derived from the URL's path when empty. |
| `url` | `http(s)` URL; may contain `{today}`. Empty means unconfigured. |
| `category` | `backend`, `environment`, `weather`, `air`, `wearable`, `geo`, `map`, `bike` or `other`. |
| `origin` | `backend`, `third-party`, `planned` or `custom`. |
| `note` | At most 200 characters. |
| `redirect` | `mode` is `off`, `on-failure` or `always`; `target` is an `http(s)` URL (required unless `off`). |
| `health.status` | `healthy`, `degraded`, `offline` or `unconfigured` (rules in A3). `latencyMs` and `lastError` are `null` when the last check failed or none exists. |

#### A4.2 Managing endpoints

| Method and path | Purpose | Success |
|---|---|---|
| `POST /api/v1/admin/endpoints` | Create an endpoint. Body: `name`, `path` (optional), `url`, `category`, `note` (optional). | `201` and the endpoint |
| `PUT /api/v1/admin/endpoints/{id}` | Update the same fields. If `url` changes, the health history resets. | `200` and the endpoint |
| `DELETE /api/v1/admin/endpoints/{id}` | Remove it and its history. | `204` |
| `PUT /api/v1/admin/endpoints/{id}/redirect` | Set `{ "mode", "target" }`. | `200` and the endpoint |
| `POST /api/v1/admin/endpoints/{id}/check` | Optional: run a check now and return the result. | `200` with a `health` object |

Validation errors return `422` with one message per field, using the form's field names, so the admin can show them
next to the input:

```json
{ "errors": { "name": "Another endpoint already has this name.", "url": "Remove \"api_key\" from the URL." } }
```

The rules the admin already enforces (`src/lib/validate.ts`), and the backend should enforce again:

- **URL:** valid `http` or `https`; **no username or password**; **no secret-looking query keys** (`api_key`, `key`, `token`,
  `access_token`, `auth`, `authorization`, `secret`, `password`, `passwd`, `pwd`, `signature`, `sig`); not already used by
  another endpoint. Credentials must never be stored in an endpoint URL.
- **Redirect target:** valid `http(s)` URL under the same secret rules, different from the endpoint's own URL, required
  unless the mode is `off`; `https` is recommended.
- **Redirect meaning (to decide, see A9):** `off` does nothing; `on-failure` sends requests for the endpoint to the target
  while its status is `offline`; `always` sends every request to the target, for example during a migration.

#### A4.3 `GET /api/v1/admin/summary` — the four overview cards

| Param | Format |
|---|---|
| `from`, `to` | `YYYY-MM-DD`, inclusive, Europe/Berlin days. The admin asks for the last 7, 14, 30 or 90 days ending today. |

Response `200`. `previous` is the period of the same length directly before `current` (used for "vs. previous 30
days"); it is `null` if there is not enough history.

```json
{
  "timezone": "Europe/Berlin",
  "from": "2026-09-29", "to": "2026-10-28",
  "current": {
    "requests": 12480,
    "records": 2847,
    "uniqueClients": 1180,
    "types": { "activity": 1420, "environment": 855, "wearable": 572 }
  },
  "previous": { "requests": 10065, "records": 2410, "uniqueClients": 1012, "types": { "activity": 1190, "environment": 730, "wearable": 490 } }
}
```

- `requests`: all requests to the public API in the period, excluding health checks and admin traffic so the number
  reflects real use.
- `uniqueClients`: **distinct** opaque client ids in the period, not the sum of daily counts.
- `types` always sums to `records`.

#### A4.4 `GET /api/v1/admin/client-data/timeseries` — the chart

Same `from` and `to`. Response `200`: one entry per day, **continuous** (days with no data are present with zeros).

```json
{
  "timezone": "Europe/Berlin",
  "days": [
    { "date": "2026-10-27", "records": 96, "clients": 60, "requests": 410,
      "types": { "activity": 48, "environment": 29, "wearable": 19 } }
  ]
}
```

Rules: `types.activity + types.environment + types.wearable === records`; `clients <= records`; at most 180 days.

#### A4.5 `GET /api/v1/admin/client-data/uploads` — recent uploads

| Param | Meaning |
|---|---|
| `limit` | Default 20, maximum 100. |
| `type` | Optional: `activity`, `environment` or `wearable`. |
| `status` | Optional: `accepted`, `partial` or `rejected`. |
| `before` | Opaque cursor from the previous page's `nextCursor`. |

```json
{
  "uploads": [
    { "id": "u_8f2c", "receivedAt": "2026-10-28T21:40:12Z", "source": "Environmental data",
      "type": "environment", "records": 34, "clients": 21, "status": "accepted" }
  ],
  "nextCursor": null
}
```

`status`: `accepted` (all records stored), `partial` (some rejected) or `rejected` (none stored). Newest first. Aggregates
only: no per-person rows, no client ids.

#### A4.6 Client-data ingestion (clients to backend) — needs a team decision first

Nothing sends client data to a server today: the web client keeps wearable and location data on the device, and its
privacy notes say so. The three data types in the admin (`activity`, `environment`, `wearable`) are a design assumption.
A possible shape, **proposal only**:

`POST /api/v1/client-data` — a batch of one type, answered with `202` and `{ "accepted": 34, "rejected": 0 }`.

```json
{ "schemaVersion": 1, "clientId": "7b1f…", "type": "wearable", "sentAt": "2026-10-28T21:40:00Z",
  "records": [ { "at": "2026-10-28T21:39:00Z", "metric": "heart_rate", "value": 128, "unit": "bpm" } ] }
```

If this is built, it must come with: an explicit opt-in in the web client and an updated privacy notice; an **opaque,
rotating client id** (no accounts, no device identifiers); no names and no precise location; size and rate limits; a
validation schema per type; a retention period; and a way for a client to delete its data. Please do not build it before
the team agrees on these.

### A5. Access control and security expectations

**The admin is not access-protected today.** There is no sign-in, no roles and no server-side check, and the app says so in
its sidebar, on the Overview and in Settings. Until the backend enforces access, it must be kept on a private network or
behind an authenticating proxy. For the admin API (A4) we expect:

- **Authentication on every `/api/v1/admin/*` route.** Public routes (`/api/v1/day`, `/grid`, `/sensors`, `/health`) stay
  open. Suggested: OpenID Connect (authorization code with PKCE) or a short-lived signed token; `401` when not signed in.
  The admin currently sends no credentials and has no login screen; one has to be added when this exists.
- **Roles.** At least `viewer` (read-only: summary, series, uploads, registry) and `admin` (create, update, delete, redirect).
  `403` when the role is not enough.
- **CORS** for admin routes limited to the admin's own origin, never `*`.
- **Audit log** of every change to endpoints and redirects: who, when, what changed.
- **No secrets in responses**, and none accepted in endpoint URLs (rules in A4.2).
- **Aggregate data only** on client-data routes. Hide or merge groups too small to be anonymous if a breakdown could single
  someone out.
- HTTPS only; rate limits on the admin routes; `Cache-Control: private, no-store` on admin responses.

### A6. Conventions for the admin API

| Topic | Rule |
|---|---|
| Format | JSON, UTF-8. |
| Days | `YYYY-MM-DD`, Europe/Berlin day boundaries. Ranges are inclusive and at most 180 days. |
| Instants | ISO 8601 UTC with `Z`. |
| Errors | Standard status codes. `422` carries `{ "errors": { "<field>": "<message>" } }`; other errors carry `{ "detail": "…" }`. |
| Compression | gzip or brotli. |
| Versioning | Under `/api/v1/admin`. A breaking change needs `/api/v2`; additive fields are safe, the admin ignores unknown fields. |

### A7. Failure behaviour in the admin

| Situation | Admin result |
|---|---|
| A checked endpoint is down, slow or times out | That row shows Offline or Degraded with the reason; counts and trends update. |
| Backend URL not set | The greenAir endpoints show Not configured instead of failing. |
| Admin API unreachable (when it exists) | Keep showing the browser's own endpoint checks and label the rest as unavailable. Never show old numbers as live. |
| Admin API missing | Today's behaviour: simulated figures, labelled as such. |

### A8. Acceptance checklist

- [ ] The admin's origin is in `GREENAIR_CORS_ORIGINS`, so checks can read status codes.
- [ ] `/health` and the three web client endpoints answer `GET` with `2xx` and no authentication, and respond within a second
      in normal conditions.
- [ ] *(Admin API)* every `/api/v1/admin/*` route requires authentication and enforces roles.
- [ ] *(Admin API)* `endpoints`, `summary`, `client-data/timeseries` and `client-data/uploads` return the shapes in A4, with
      continuous day series, `types` summing to `records`, and `uniqueClients` counted as distinct clients.
- [ ] *(Admin API)* endpoint changes validate with the same rules as A4.2 and are written to an audit log.
- [ ] *(Ingestion)* not started before the privacy points in A4.6 are agreed.

### A9. Open questions

- **Who checks the endpoints?** Browser checks only measure what that admin can reach. A server-side scheduler (and where it
  runs) would give real uptime history; the registry in A4.1 assumes one.
- **What does a redirect do?** An HTTP 307 to the target, or a proxy on the backend? And who is allowed to switch it on?
- **Does client-data ingestion exist at all,** and with which data types and consent flow? Until then the Client data page
  stays simulated.
- **What counts as a request** for "Total requests": public API calls only, per endpoint, per client?
- **Who signs in to the admin** and with which identity provider?
- **Where is the admin hosted,** and is it reachable from the public internet?
