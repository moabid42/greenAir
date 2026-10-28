import type { Health, Probe, Settings } from "./types";

/** Status of one endpoint from its recent checks. */
export function deriveHealth(probes: Probe[], settings: Pick<Settings, "degradedMs">, configured: boolean): Health {
  if (!configured) return "unconfigured";
  const last = probes.at(-1);
  if (!last) return "checking";
  if (!last.ok) return "offline";
  const slow = last.ms != null && last.ms > settings.degradedMs;
  // One failure among the previous four checks means the endpoint is flaky even though the latest check passed.
  const flaky = probes.slice(-5, -1).some((p) => !p.ok);
  if (slow || flaky) return "degraded";
  return "healthy";
}

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
  unconfigured: "Not configured",
  checking: "Checking…",
};

export const HEALTH_DETAIL: Record<Health, string> = {
  healthy: "All checks passing",
  degraded: "Slow or intermittent",
  offline: "Last check failed",
  unconfigured: "Nothing to check yet",
  checking: "Waiting for the first check",
};

export interface EndpointStats {
  checks: number;
  uptimePct: number | null;
  avgMs: number | null;
  since: number | null;
}

/** Uptime and average latency over the checks this browser has made since `from` (ms epoch). */
export function endpointStats(probes: Probe[], from = 0): EndpointStats {
  const p = probes.filter((x) => x.at >= from);
  if (p.length === 0) return { checks: 0, uptimePct: null, avgMs: null, since: null };
  const ok = p.filter((x) => x.ok);
  const timed = ok.filter((x) => x.ms != null);
  return {
    checks: p.length,
    uptimePct: Math.round((ok.length / p.length) * 1000) / 10,
    avgMs: timed.length ? Math.round(timed.reduce((s, x) => s + (x.ms ?? 0), 0) / timed.length) : null,
    since: p[0].at,
  };
}
