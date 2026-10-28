# EcoMAB

EcoMAB is a map-first sports suitability application. The Vite app contains a MapLibre map, illustrative environmental conditions, local wearable sample sessions, and an AI Companion. See [Interactive map](docs/INTERACTIVE_MAP.md) for map behavior, data provenance and integration limits.

## Development

Use Node 20.19+ or 22.12+ and npm:

```sh
npm ci
npm run dev
npm run build
npm run preview
npm test
npm run lint
```

MapLibre and OpenFreeMap require network access. For browser tests, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`.

## Configuration and privacy

Copy `.env.example` to `.env.local` and configure only the options you need. `VITE_ECOMAB_API_BASE_URL` points to the proposed public environmental backend; no live backend is included. The example scenario is illustrative, not a measurement or forecast. Sample wearable sessions stay in browser storage and are not uploaded. Browser storage is not presented as encrypted native storage.

Local AI requires Wllama assets. Run `npm install --no-save --package-lock=false @wllama/wllama@3.8.1` and `npm run setup:ai`, then select **Download & install model** in the Companion. Real model inference and GPU acceleration are not verified on all devices. The model is stored locally and can be removed in settings.

Optional OpenRouter cloud chat works only through the local Vite development proxy. Set `OPENROUTER_API_KEY` in `.env.local` and restart Vite; never use a `VITE_` prefix for the key. Cloud mode sends the user's question and environmental context to OpenRouter; wearable history is excluded. A production deployment needs a separately secured server.
