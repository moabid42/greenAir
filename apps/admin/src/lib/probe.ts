import type { Endpoint, Probe, Settings } from "./types";

export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The URL to check, or null (with a reason) when the endpoint cannot be checked yet. */
export function resolveUrl(ep: Pick<Endpoint, "url">, settings: Pick<Settings, "backendUrl">, now = new Date()): { url: string } | { url: null; reason: string } {
  const raw = ep.url.trim();
  if (!raw) return { url: null, reason: "No URL set" };
  if (raw.includes("{base}") && !settings.backendUrl) return { url: null, reason: "Set the backend URL in Settings" };
  return { url: raw.replaceAll("{base}", settings.backendUrl).replaceAll("{today}", todayIso(now)) };
}

type Fetcher = typeof fetch;

/**
 * One health check from this browser: time until the response headers arrive (the body is never downloaded, so large
 * endpoints cost nothing). If CORS hides the response we retry in "no-cors" mode: that proves the server is reachable but
 * the status code cannot be read, which is reported honestly as `opaque`.
 */
export async function probeUrl(url: string, timeoutMs: number, fetcher: Fetcher = fetch, now: () => number = () => performance.now()): Promise<Probe> {
  const at = Date.now();
  const attempt = async (mode: RequestMode): Promise<{ status: number; ms: number }> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = now();
    try {
      const res = await fetcher(url, { method: "GET", mode, cache: "no-store", credentials: "omit", signal: ac.signal, headers: mode === "cors" ? { Accept: "application/json" } : undefined });
      const ms = Math.round(now() - t0);
      void res.body?.cancel().catch(() => undefined);
      return { status: res.status, ms };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const { status, ms } = await attempt("cors");
    const ok = status >= 200 && status < 300;
    return ok ? { at, ok, ms, status } : { at, ok: false, ms, status, error: `HTTP ${status}` };
  } catch (first) {
    if (first instanceof DOMException && first.name === "AbortError") return { at, ok: false, ms: null, status: null, error: "Timed out" };
    try {
      const { ms } = await attempt("no-cors");
      return { at, ok: true, ms, status: null, opaque: true };
    } catch (second) {
      if (second instanceof DOMException && second.name === "AbortError") return { at, ok: false, ms: null, status: null, error: "Timed out" };
      return { at, ok: false, ms: null, status: null, error: "Unreachable" };
    }
  }
}
