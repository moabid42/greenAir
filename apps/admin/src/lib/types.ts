export type Category = "backend" | "environment" | "weather" | "air" | "wearable" | "geo" | "map" | "bike" | "other";
export type Origin = "backend" | "third-party" | "planned" | "custom";

export type RedirectMode = "off" | "on-failure" | "always";
export interface Redirect {
  mode: RedirectMode;
  target: string;
}

export interface Endpoint {
  id: string;
  name: string;
  /** Short label shown under the name, e.g. "/api/v1/day". */
  path: string;
  /** Full URL. May contain {base} (the backend URL from Settings) and {today} (YYYY-MM-DD). Empty = not configured. */
  url: string;
  category: Category;
  origin: Origin;
  /** What this endpoint is for and who owns it. */
  note: string;
  redirect: Redirect;
}

/** One health check, taken from this browser. */
export interface Probe {
  at: number;
  ok: boolean;
  /** Time until the response headers arrived; null when the request failed. */
  ms: number | null;
  status: number | null;
  /** The browser could reach the server but CORS hides the status code. */
  opaque?: boolean;
  error?: string;
}

export type Health = "healthy" | "degraded" | "offline" | "unconfigured" | "checking";

export type RangeDays = 7 | 14 | 30 | 90;

export interface Settings {
  /** greenAir backend base URL, no trailing slash. Empty = backend endpoints are "not configured". */
  backendUrl: string;
  /** Seconds between automatic checks; 0 = manual only. */
  intervalSec: 0 | 30 | 60 | 300;
  timeoutMs: number;
  /** A reachable endpoint slower than this counts as degraded. */
  degradedMs: number;
  defaultRange: RangeDays;
}

export interface SimDay {
  date: string; // YYYY-MM-DD
  records: number;
  clients: number;
  requests: number;
  types: Record<DataType, number>;
}

export type DataType = "activity" | "environment" | "wearable";
