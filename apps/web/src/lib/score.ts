import type { Activity, CellProperties, Factor, Hour, HourConditions, TimeWindow } from "./api/types";

/**
 * How much each factor matters per activity. Each row sums to 1.
 * The backend sends factor scores; the index itself is computed here so
 * weights can change in the UI instantly without a round-trip.
 */
export const WEIGHTS: Record<Activity, Record<Factor, number>> = {
  run: { heat: 0.3, air: 0.3, wind: 0.1, traffic: 0.2, light: 0.1, safety: 0 },
  ride: { heat: 0.2, air: 0.2, wind: 0.15, traffic: 0.15, light: 0.1, safety: 0.2 },
  walk: { heat: 0.3, air: 0.35, wind: 0.05, traffic: 0.2, light: 0.1, safety: 0 },
};

export const FACTOR_META: Record<Factor, { label: string; question: string }> = {
  heat: { label: "Heat", question: "How hot is this street?" },
  air: { label: "Air quality", question: "How clean is the air here?" },
  wind: { label: "Wind", question: "Is it calm enough?" },
  traffic: { label: "Rush hour", question: "Is the commute peak on?" },
  light: { label: "Daylight", question: "Can you see and be seen?" },
  safety: { label: "Surface & safety", question: "Smooth road, safe overtaking?" },
};

export const ACTIVITY_META: Record<Activity, { label: string; verb: string }> = {
  run: { label: "Run", verb: "run" },
  ride: { label: "Ride", verb: "ride" },
  walk: { label: "Walk", verb: "walk" },
};

/** Factor score under which a factor counts as a dealbreaker (red in the UI). */
export const DEALBREAKER = 40;

/** Personal sensitivities from the user's preferences. They re-weight, never change the data. */
export interface Tune {
  airSensitive?: boolean;
  heatSensitive?: boolean;
}

export function weightsFor(activity: Activity, tune?: Tune): Record<Factor, number> {
  const w = { ...WEIGHTS[activity] };
  if (tune?.airSensitive) w.air *= 1.7;
  if (tune?.heatSensitive) w.heat *= 1.7;
  return w;
}

/**
 * Weighted mean of factors, then pulled down by the weakest factor:
 * a perfect-air hour at 34 °C (or a cool hour in the dark) should never look "great".
 */
export function combine(factors: Partial<Record<Factor, number | null>>, activity: Activity, tune?: Tune): number {
  const w = weightsFor(activity, tune);
  let sum = 0;
  let wsum = 0;
  let worst = 100;
  (Object.keys(w) as Factor[]).forEach((f) => {
    const v = factors[f];
    if (w[f] === 0 || v == null || !Number.isFinite(v)) return;
    sum += v * w[f];
    wsum += w[f];
    worst = Math.min(worst, v);
  });
  if (wsum === 0) return Number.NaN;
  const mean = sum / wsum;
  const penalty = Math.max(0, 45 - worst) * 0.9;
  let score = Math.max(0, Math.min(100, mean - penalty));
  // A dealbreaker (any factor below DEALBREAKER) can never be "good".
  if (worst < DEALBREAKER) score = Math.min(score, 59);
  return Math.round(score);
}

export function cellFactors(c: CellProperties, hour: Hour): Record<Factor, number | null> {
  return {
    heat: c.heat[hour],
    air: c.air[hour],
    wind: c.wind[hour],
    traffic: c.traffic[hour],
    light: c.light[hour],
    safety: c.safety,
  };
}

export function cellScore(c: CellProperties, hour: Hour, activity: Activity, tune?: Tune): number {
  const factors = cellFactors(c, hour);
  if ([factors.heat, factors.air, factors.wind].some((v) => v == null)) return Number.NaN;
  return combine(factors, activity, tune);
}

export function hourScore(h: HourConditions, activity: Activity, tune?: Tune): number {
  // No index/recommendation without the core weather and air channels.
  if ([h.factors.heat, h.factors.air, h.factors.wind].some((v) => v == null)) return Number.NaN;
  return combine(h.factors, activity, tune);
}

/** Hours we are willing to recommend (no 3 AM runs). */
const WAKING = { from: 5, to: 23 };

/** Today only: hours that are already over can't be recommended, so they score 0. */
export function maskPast(scores: number[], nowHour: Hour | null): number[] {
  return nowHour == null ? scores : scores.map((s, h) => (h < nowHour ? 0 : s));
}

/** Contiguous runs of waking hours scoring >= threshold, best first. Empty when nothing is left to recommend. */
export function bestWindows(scores: number[], threshold = 70, max = 3): TimeWindow[] {
  const out: TimeWindow[] = [];
  let start = -1;
  for (let h = 0; h <= scores.length; h++) {
    const ok = h < scores.length && h >= WAKING.from && h < WAKING.to && scores[h] >= threshold;
    if (ok && start < 0) start = h;
    if (!ok && start >= 0) {
      const slice = scores.slice(start, h);
      out.push({ start, end: h, score: Math.round(slice.reduce((a, b) => a + b, 0) / slice.length) });
      start = -1;
    }
  }
  if (out.length === 0) {
    // Nothing clears the bar: suggest the single best hour instead.
    const waking = scores.slice(WAKING.from, WAKING.to).map((v) => Number.isFinite(v) ? v : -Infinity);
    if (waking.length === 0 || Math.max(...waking) <= 0) return [];
    const best = WAKING.from + waking.indexOf(Math.max(...waking));
    return [{ start: best, end: best + 1, score: scores[best] }];
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

export type Verdict = "great" | "good" | "meh" | "poor" | "unknown";

export function verdict(score: number): Verdict {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 75) return "great";
  if (score >= 60) return "good";
  if (score >= 40) return "meh";
  return "poor";
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  unknown: "Data unavailable",
  great: "Go now",
  good: "Good to go",
  meh: "Could be better",
  poor: "Better wait",
};

/** One-word versions for tight spaces (watch faces, badges). */
export const SHORT_VERDICT: Record<Verdict, string> = {
  unknown: "NO DATA",
  great: "GO NOW",
  good: "GOOD",
  meh: "OK",
  poor: "WAIT",
};

/** Score → colour. Same stops are used in the MapLibre expression (see SCORE_STOPS). */
export const SCORE_STOPS: [number, string][] = [
  [0, "#bb5250"],
  [30, "#e47152"],
  [55, "#dbad36"],
  [72, "#74b68c"],
  [100, "#14966f"],
];

export function scoreColor(score: number): string {
  if (!Number.isFinite(score)) return "#a8b4b0";
  for (let i = 1; i < SCORE_STOPS.length; i++) {
    const [s1, c1] = SCORE_STOPS[i - 1];
    const [s2, c2] = SCORE_STOPS[i];
    if (score <= s2) return mix(c1, c2, (score - s1) / (s2 - s1));
  }
  return SCORE_STOPS[SCORE_STOPS.length - 1][1];
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export const fmtHour = (h: Hour) => `${String(h % 24).padStart(2, "0")}:00`;
