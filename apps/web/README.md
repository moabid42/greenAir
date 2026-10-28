# Web client

The MapLibre web client for greenAir (EcoMAB Heilbronn): the best time and place to
**run, ride or walk**, from heat, air quality (PM2.5 + NO₂), wind, rush hour and daylight
in one 0–100 score. It consumes the backend's REST API, then vector tiles and score update
SSE once those interfaces exist. Until the backend serves data it runs in demo mode.

The endpoints it expects, with schemas and failure behaviour, are documented in
[API_ENDPOINTS.md](API_ENDPOINTS.md).

See the [architecture mapping](../../docs/architecture.md).

Built for the Green City Hackathon Heilbronn, Oct 2026. **Mobile first**: it is a phone app (installable PWA). On a big screen it shows as a phone-sized column.

## Run it

In the `greenAir` repository this app lives in `apps/web`; run the commands below from that folder.

```bash
npm install
npm run dev -- -p 3100     # http://localhost:3100  (port 3000 works too if it is free)
```

Open it on a phone-sized window (or your phone, same Wi-Fi: `http://<laptop-ip>:3100`). Install and GPS need HTTPS (e.g. a Vercel deploy).

No backend yet? It runs in **demo mode**: real Open-Meteo weather and air quality for Heilbronn, spread over the city with a local model. Real senseBox:bike cycling data loads from atrai.bike. When the backend exists: copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` (shapes in **API_ENDPOINTS.md**).

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
    score.ts  lens.ts  rank.ts  ride.ts  dial.ts  field.ts  reminders.ts  prefs.ts
    coach/engine.ts          the Coach's analyst
```

Preferences, saved places and reminders live only in the phone's `localStorage`.
