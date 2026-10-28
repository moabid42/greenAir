import type { DataType, SimDay } from "./types";

/**
 * SIMULATED client data. The web client uploads nothing and no backend ingests client data yet, so this is a
 * deterministic sample (same numbers every time for the same date) used to show how the pages will look.
 * It is never presented as measured.
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MS_DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `count` consecutive days ending on `endIso` (inclusive). */
export function simDays(endIso: string, count = 180): SimDay[] {
  const end = Date.parse(`${endIso}T12:00:00Z`);
  const out: SimDay[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = iso(new Date(end - i * MS_DAY));
    const rnd = mulberry32(Number(date.replaceAll("-", "")));
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const trend = 58 + ((count - 1 - i) / (count - 1)) * 44; // grows from ~58 to ~102 records per day
    const weekend = dow === 0 || dow === 6 ? 1.18 : 1; // people move more on weekends
    const records = Math.max(10, Math.round(trend * weekend * (0.85 + rnd() * 0.3)));
    const clients = Math.max(3, Math.round(records * (0.55 + rnd() * 0.15)));
    const requests = Math.round(records * (4.1 + rnd() * 0.5));
    const a = 0.5 + (rnd() - 0.5) * 0.06;
    const e = 0.3 + (rnd() - 0.5) * 0.05;
    const activity = Math.round(records * a);
    const environment = Math.round(records * e);
    out.push({ date, records, clients, requests, types: { activity, environment, wearable: Math.max(0, records - activity - environment) } });
  }
  return out;
}

export interface Batch {
  id: string;
  at: number;
  source: string;
  type: DataType;
  records: number;
  clients: number;
  status: "accepted" | "partial" | "rejected";
}

const SOURCES: [string, DataType][] = [
  ["Environmental data", "environment"],
  ["Activity upload", "activity"],
  ["Wearable sync", "wearable"],
  ["Air quality", "environment"],
];

/** Recent simulated ingestion batches, newest first. */
export function simBatches(now: number, count = 14): Batch[] {
  const rnd = mulberry32(Math.floor(now / MS_DAY));
  let t = now;
  return Array.from({ length: count }, (_, i) => {
    t -= Math.round((4 + rnd() * 70) * 60000);
    const [source, type] = SOURCES[Math.floor(rnd() * SOURCES.length)];
    const r = rnd();
    const records = Math.round(8 + rnd() * 60);
    return { id: `b${Math.floor(now / MS_DAY)}-${i}`, at: t, source, type, records, clients: Math.max(1, Math.round(records * (0.4 + rnd() * 0.3))), status: r > 0.93 ? "rejected" : r > 0.82 ? "partial" : "accepted" };
  });
}

export const DATA_TYPES: { id: DataType; label: string }[] = [
  { id: "activity", label: "Activity data" },
  { id: "environment", label: "Environment data" },
  { id: "wearable", label: "Wearable data" },
];
