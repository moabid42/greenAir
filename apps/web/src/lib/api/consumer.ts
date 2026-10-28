/**
 * Optional client for the proposed EcoMAB street-score backend: per-street scores as vector tiles plus a detail endpoint.
 * Off unless NEXT_PUBLIC_ECOMAB_API_BASE_URL is set. Nothing here has been verified against a deployed service.
 * Responses are checked before use; anything that does not match is rejected and the app keeps its normal map.
 */
import type { Activity } from "./types";

export const CONSUMER_BASE = (process.env.NEXT_PUBLIC_ECOMAB_API_BASE_URL ?? "").replace(/\/$/, "");

export type Profile = "running" | "cycling" | "walking";
export const PROFILE: Record<Activity, Profile> = { run: "running", ride: "cycling", walk: "walking" };

const HOUR = /^\d{4}-\d\d-\d\dT\d\d:00:00Z$/;

/** [score 0–100, confidence 0–1, flag bits] for one street segment, keyed by its integer segment id. */
export type SegmentTuple = [number, number, number];

export interface SegmentSnapshot {
  profile: Profile;
  t: string;
  kind: "observed" | "forecast";
  version: string;
  build_id: string;
  scores: Record<string, SegmentTuple>;
}

export interface SegmentDetail {
  segment_id: number;
  name?: string;
  t: string;
  kind: "observed" | "forecast";
  score: number;
  confidence: number;
  components: { key: string; label: string; value: number | string | null; unit: string; weight: number; source: string }[];
  gates: string[];
  missing: string[];
}

const isNum = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export function validateSnapshot(x: unknown): SegmentSnapshot {
  if (!isObj(x) || !isObj(x.scores) || typeof x.build_id !== "string" || !x.build_id || typeof x.version !== "string") throw new Error("Unsupported snapshot");
  if (!["running", "cycling", "walking"].includes(String(x.profile)) || typeof x.t !== "string" || !HOUR.test(x.t) || !["observed", "forecast"].includes(String(x.kind))) throw new Error("Unsupported snapshot");
  for (const [id, v] of Object.entries(x.scores)) {
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || !Array.isArray(v) || v.length !== 3 || !isNum(v[0], 0, 100) || !isNum(v[1], 0, 1) || !Number.isInteger(v[2]) || v[2] < 0) throw new Error("Invalid score entry");
  }
  return x as unknown as SegmentSnapshot;
}

export function validateDetail(x: unknown): SegmentDetail {
  if (!isObj(x) || !Number.isInteger(x.segment_id) || !isNum(x.score, 0, 100) || !isNum(x.confidence, 0, 1) || !Array.isArray(x.components) || !Array.isArray(x.gates) || !Array.isArray(x.missing)) throw new Error("Unsupported detail");
  return x as unknown as SegmentDetail;
}

/** "2026-10-29T13:00:00Z" for the hour containing `time`. */
export function utcHour(time: Date): string {
  const d = new Date(time);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
}

/** The UTC instant of a wall-clock hour in Europe/Berlin (handles summer and winter time). */
export function berlinHourToUtc(date: string, hour: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const offset = (ts: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ts)).map((q) => [q.type, q.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
  };
  const guess = Date.UTC(y, m - 1, d, hour);
  return new Date(guess - offset(guess - offset(guess)));
}

export class ConsumerClient {
  get configured() {
    return CONSUMER_BASE !== "";
  }

  tileUrl(build: string) {
    return `${CONSUMER_BASE}/tiles/segments/{z}/{x}/{y}.pbf?v=${encodeURIComponent(build)}`;
  }

  private async get(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(CONSUMER_BASE + path, window.location.href);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const timeout = AbortSignal.timeout(8000);
    const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!r.ok) throw new Error(`Backend HTTP ${r.status}`);
    return r.json();
  }

  async scores(profile: Profile, t: string, signal?: AbortSignal) {
    const snap = validateSnapshot(await this.get("/scores", { profile, t }, signal));
    if (snap.profile !== profile || snap.t !== t) throw new Error("Snapshot does not match the selection");
    return snap;
  }

  async score(lat: number, lon: number, profile: Profile, t: string) {
    return validateDetail(await this.get("/score", { lat, lon, profile, t }));
  }

  async status(): Promise<{ build_id: string }> {
    const x = await this.get("/status", {});
    if (!isObj(x) || typeof x.build_id !== "string" || !x.build_id) throw new Error("Unsupported status");
    return { build_id: x.build_id };
  }
}
