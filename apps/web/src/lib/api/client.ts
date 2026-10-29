/**
 * The ONLY place the UI gets data from.
 * - NEXT_PUBLIC_API_URL set   → calls the team backend (see the README (Expected API endpoints))
 * - NEXT_PUBLIC_API_URL unset → local backend; demo requires explicit opt-in
 */
import type { DayForecast, GridResponse, Sensor } from "./types";
import { demoDay, demoGrid, demoSensors } from "./demo";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export const usingBackend = !DEMO;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Data unavailable (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function getDay(date: string): Promise<DayForecast> {
  return !DEMO ? get<DayForecast>(`/api/v1/day?date=${date}`) : demoDay(date);
}

export async function getGrid(date: string, day: DayForecast): Promise<GridResponse> {
  return !DEMO ? get<GridResponse>(`/api/v1/grid?date=${date}`) : demoGrid(day);
}

// The backend's sensor list does not depend on the hour, but the app asks again whenever the hour changes
// (the demo needs the hour). Reuse one answer for a minute so dragging the day dial does not hammer the API.
let sensorCache: { at: number; req: Promise<Sensor[]> } | null = null;

export async function getSensors(day: DayForecast, hour: number): Promise<Sensor[]> {
  if (DEMO) return demoSensors(day, hour);
  if (sensorCache && Date.now() - sensorCache.at < 60_000) return sensorCache.req;
  const req = get<Sensor[]>(`/api/v1/sensors`);
  sensorCache = { at: Date.now(), req };
  req.catch(() => {
    if (sensorCache?.req === req) sensorCache = null; // let the next call retry
  });
  return req;
}
