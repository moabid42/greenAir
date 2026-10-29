import { DEFAULT_ENDPOINTS, DEFAULT_SETTINGS } from "./defaults";
import type { Endpoint, Probe, RangeDays, Settings } from "./types";
import { CATEGORIES, REDIRECT_MODES } from "./validate";

/** Everything is kept in this browser only. Not shared between admins and not encrypted. */
const KEY = "ecomab-admin:v1";
export const MAX_PROBES = 200;

export interface Persisted {
  settings: Settings;
  endpoints: Endpoint[];
  probes: Record<string, Probe[]>;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number, fallback = "") => (typeof x === "string" ? x.slice(0, max) : fallback);

export function sanitizeEndpoint(x: unknown): Endpoint | null {
  if (!isObj(x) || typeof x.id !== "string" || typeof x.name !== "string") return null;
  const r = isObj(x.redirect) ? x.redirect : {};
  const mode = REDIRECT_MODES.find((m) => m === r.mode) ?? "off";
  const origin = x.origin === "backend" || x.origin === "third-party" || x.origin === "planned" || x.origin === "custom" ? x.origin : "custom";
  return {
    id: str(x.id, 60),
    name: str(x.name, 40),
    path: str(x.path, 80),
    url: str(x.url, 500),
    category: CATEGORIES.find((c) => c === x.category) ?? "other",
    origin,
    note: str(x.note, 200),
    redirect: { mode, target: str(r.target, 500) },
  };
}

function sanitizeProbe(x: unknown): Probe | null {
  if (!isObj(x) || typeof x.at !== "number" || typeof x.ok !== "boolean") return null;
  return { at: x.at, ok: x.ok, ms: typeof x.ms === "number" ? x.ms : null, status: typeof x.status === "number" ? x.status : null, opaque: x.opaque === true || undefined, error: typeof x.error === "string" ? x.error.slice(0, 80) : undefined };
}

const RANGES: RangeDays[] = [7, 14, 30, 90];

export function sanitizeSettings(x: unknown): Settings {
  const s = isObj(x) ? x : {};
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const interval = [0, 30, 60, 300].includes(s.intervalSec as number) ? (s.intervalSec as Settings["intervalSec"]) : DEFAULT_SETTINGS.intervalSec;
  return {
    backendUrl: typeof s.backendUrl === "string" ? s.backendUrl.trim().replace(/\/$/, "").slice(0, 300) : DEFAULT_SETTINGS.backendUrl,
    intervalSec: interval,
    timeoutMs: num(s.timeoutMs, DEFAULT_SETTINGS.timeoutMs),
    degradedMs: num(s.degradedMs, DEFAULT_SETTINGS.degradedMs),
    defaultRange: RANGES.find((r) => r === s.defaultRange) ?? DEFAULT_SETTINGS.defaultRange,
  };
}

export function load(): Persisted {
  const fresh: Persisted = { settings: { ...DEFAULT_SETTINGS }, endpoints: DEFAULT_ENDPOINTS, probes: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!isObj(raw)) return fresh;
    const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints.map(sanitizeEndpoint).filter((e): e is Endpoint => e != null) : DEFAULT_ENDPOINTS;
    const probes: Record<string, Probe[]> = {};
    if (isObj(raw.probes)) for (const [id, list] of Object.entries(raw.probes)) if (Array.isArray(list)) probes[id] = list.map(sanitizeProbe).filter((p): p is Probe => p != null).slice(-MAX_PROBES);
    return { settings: sanitizeSettings(raw.settings), endpoints: endpoints.length ? endpoints : DEFAULT_ENDPOINTS, probes };
  } catch {
    return fresh;
  }
}

export function save(p: Persisted): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false; // storage full or blocked: the admin keeps working for this session
  }
}

export function clearAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Parse an exported configuration file. Throws a readable error if it is not one. */
export function parseConfig(text: string): { settings: Settings; endpoints: Endpoint[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isObj(raw) || raw.kind !== "ecomab-admin-config" || !Array.isArray(raw.endpoints)) throw new Error("This is not an EcoMAB admin configuration file.");
  const endpoints = raw.endpoints.map(sanitizeEndpoint).filter((e): e is Endpoint => e != null);
  if (!endpoints.length) throw new Error("The file contains no usable endpoints.");
  return { settings: sanitizeSettings(raw.settings), endpoints };
}
