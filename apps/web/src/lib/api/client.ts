/**
 * The ONLY place the UI gets data from.
 * - NEXT_PUBLIC_API_URL set   → calls the team backend (see the README (Expected API endpoints))
 * - NEXT_PUBLIC_API_URL unset → demo data (Open-Meteo + local model)
 */
import type { DayForecast, GridResponse, Sensor } from "./types";
import { demoDay, demoGrid, demoSensors } from "./demo";

const BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

export const usingBackend = Boolean(BASE);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json() as Promise<T>;
}

export async function getDay(date: string): Promise<DayForecast> {
  return BASE ? get<DayForecast>(`/api/v1/day?date=${date}`) : demoDay(date);
}

export async function getGrid(date: string, day: DayForecast): Promise<GridResponse> {
  return BASE ? get<GridResponse>(`/api/v1/grid?date=${date}`) : demoGrid(day);
}

// The backend's sensor list does not depend on the hour, but the app asks again whenever the hour changes
// (the demo needs the hour). Reuse one answer for a minute so dragging the day dial does not hammer the API.
let sensorCache: { at: number; req: Promise<Sensor[]> } | null = null;

export async function getSensors(day: DayForecast, hour: number): Promise<Sensor[]> {
  if (!BASE) return demoSensors(day, hour);
  if (sensorCache && Date.now() - sensorCache.at < 60_000) return sensorCache.req;
  const req = get<Sensor[]>(`/api/v1/sensors`);
  sensorCache = { at: Date.now(), req };
  req.catch(() => {
    if (sensorCache?.req === req) sensorCache = null; // let the next call retry
  });
  return req;
}
