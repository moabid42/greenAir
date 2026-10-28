import type { DataType, SimDay } from "./types";

export interface Period {
  days: SimDay[];
  records: number;
  requests: number;
  /** Approximate distinct clients over the period (simulated: a client is seen on several days). */
  clients: number;
  types: Record<DataType, number>;
}

export function summarize(days: SimDay[]): Period {
  const types: Record<DataType, number> = { activity: 0, environment: 0, wearable: 0 };
  let records = 0;
  let requests = 0;
  let clients = 0;
  for (const d of days) {
    records += d.records;
    requests += d.requests;
    clients += d.clients;
    for (const k of Object.keys(types) as DataType[]) types[k] += d.types[k];
  }
  return { days, records, requests, clients: Math.round(clients * 0.42), types };
}

/** The last `n` days and the `n` days before them, for "vs. previous period" comparisons. */
export function periods(all: SimDay[], n: number): { current: Period; previous: Period | null } {
  const cur = all.slice(-n);
  const prev = all.slice(-2 * n, -n);
  return { current: summarize(cur), previous: prev.length === n ? summarize(prev) : null };
}

/** Percent change from previous to current, rounded; null if it cannot be computed. */
export function trend(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function breakdown(types: Record<DataType, number>) {
  const total = (Object.values(types) as number[]).reduce((s, v) => s + v, 0);
  const rows = (Object.keys(types) as DataType[]).map((id) => ({ id, value: types[id], pct: total ? Math.round((types[id] / total) * 100) : 0 }));
  // Rounded percentages can add to 99 or 101; give the remainder to the largest row so they always total 100.
  const diff = total ? 100 - rows.reduce((s, r) => s + r.pct, 0) : 0;
  if (diff) rows.sort((a, b) => b.value - a.value)[0].pct += diff;
  return { total, rows: rows.sort((a, b) => b.value - a.value) };
}
