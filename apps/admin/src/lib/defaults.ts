import type { Endpoint, Settings } from "./types";

const off = { mode: "off", target: "" } as const;

/**
 * The interfaces the EcoMAB web client uses or expects (see apps/web README, "Expected API endpoints").
 * `{base}` is the greenAir backend URL from Settings, `{today}` is today's date.
 */
export const DEFAULT_ENDPOINTS: Endpoint[] = [
  {
    id: "backend-health",
    name: "Backend health",
    path: "/health",
    url: "{base}/health",
    category: "backend",
    origin: "backend",
    note: "greenAir API liveness. Exists today in services/backend.",
    redirect: { ...off },
  },
  {
    id: "backend-day",
    name: "Day forecast",
    path: "/api/v1/day",
    url: "{base}/api/v1/day?date={today}",
    category: "environment",
    origin: "backend",
    note: "City-wide hourly conditions. Required by the web client; not implemented in the backend yet.",
    redirect: { ...off },
  },
  {
    id: "backend-grid",
    name: "Place grid",
    path: "/api/v1/grid",
    url: "{base}/api/v1/grid?date={today}",
    category: "environment",
    origin: "backend",
    note: "Per-cell hourly factor scores (about 600 KB). Required by the web client; not implemented yet.",
    redirect: { ...off },
  },
  {
    id: "backend-sensors",
    name: "Sensors",
    path: "/api/v1/sensors",
    url: "{base}/api/v1/sensors",
    category: "air",
    origin: "backend",
    note: "Real sensor markers and their latest readings. Optional for the web client; not implemented yet.",
    redirect: { ...off },
  },
  {
    id: "open-meteo-weather",
    name: "Weather",
    path: "/v1/forecast",
    url: "https://api.open-meteo.com/v1/forecast?latitude=49.1427&longitude=9.2185&hourly=temperature_2m&forecast_days=1",
    category: "weather",
    origin: "third-party",
    note: "Open-Meteo forecast. The web client uses it in demo mode for real temperature, humidity and wind.",
    redirect: { ...off },
  },
  {
    id: "open-meteo-air",
    name: "Air quality",
    path: "/v1/air-quality",
    url: "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=49.1427&longitude=9.2185&hourly=pm2_5&forecast_days=1",
    category: "air",
    origin: "third-party",
    note: "Open-Meteo air quality (PM2.5, NO₂). Used in demo mode.",
    redirect: { ...off },
  },
  {
    id: "atrai-bike",
    name: "Cycling data",
    path: "/collections/bumpy_roads_heilbronn",
    url: "https://api.atrai.bike/collections/bumpy_roads_heilbronn/items?f=json&limit=1",
    category: "bike",
    origin: "third-party",
    note: "senseBox:bike road-surface layer from atrai.bike. Loaded directly by the web client in ride mode.",
    redirect: { ...off },
  },
  {
    id: "photon-geocode",
    name: "Address search",
    path: "/api",
    url: "https://photon.komoot.io/api/?q=Heilbronn&limit=1",
    category: "geo",
    origin: "third-party",
    note: "Photon geocoder (OpenStreetMap). Powers location search in the web client.",
    redirect: { ...off },
  },
  {
    id: "openfreemap-style",
    name: "Base map style",
    path: "/styles/positron",
    url: "https://tiles.openfreemap.org/styles/positron",
    category: "map",
    origin: "third-party",
    note: "OpenFreeMap map style used by every map screen.",
    redirect: { ...off },
  },
  {
    id: "wearable-sync",
    name: "Wearable sync",
    path: "/api/wearables",
    url: "",
    category: "wearable",
    origin: "planned",
    note: "Planned. The web client keeps wearable data on the device and has no upload endpoint.",
    redirect: { ...off },
  },
];

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, ""),
  intervalSec: 60,
  timeoutMs: 8000,
  degradedMs: 1000,
  defaultRange: 30,
};
