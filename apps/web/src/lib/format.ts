import type { DayForecast, Factor, Hour } from "./api/types";
import { DEALBREAKER } from "./score";

export type Tone = "good" | "ok" | "bad" | "unknown";

/** Tailwind classes for a chip tinted by tone. */
export const TONE_CLASS: Record<Tone, string> = {
  unknown: "bg-wash text-mute",
  good: "bg-great-soft text-[#14653e]",
  ok: "bg-ok-soft text-[#7a5200]",
  bad: "bg-bad-soft text-[#9a3a12]",
};

export const toneOf = (v: number | null): Tone => (v == null || !Number.isFinite(v) ? "unknown" : v >= 75 ? "good" : v >= DEALBREAKER ? "ok" : "bad");

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "today", "tomorrow" or "on 20 Jun". */
export function dayWord(date: string, today: string): string {
  if (date === today) return "today";
  const t = parse(today);
  t.setDate(t.getDate() + 1);
  if (date === `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`) return "tomorrow";
  return `on ${parse(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** "Sat 20 Jun" */
export const shortDate = (date: string) => parse(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export const weekday = (date: string) => parse(date).toLocaleDateString("en-GB", { weekday: "short" });

export function tempWord(tempC: number | null): string {
  if (tempC == null) return "No data";
  if (tempC < 5) return "Cold";
  if (tempC < 12) return "Fresh";
  if (tempC < 19) return "Pleasant";
  if (tempC < 26) return "Warm";
  return "Hot";
}

export function airWord(score: number | null): string {
  if (score == null) return "No data";
  return score >= 75 ? "Clean" : score >= DEALBREAKER ? "Okay" : "Poor";
}

/** "Rush till 09:00" when the commute peak is on at this hour, otherwise quiet. */
export function trafficInfo(day: DayForecast, hour: Hour): { title: string; sub: string; tone: Tone } {
  if (day.hours[hour].rush == null) return { title: "No data", sub: "traffic", tone: "unknown" };
  if (day.hours[hour].rush! <= 0.45) return { title: "Quiet", sub: "roads", tone: "good" };
  let end = hour;
  while (end < 23 && (day.hours[end].rush ?? -1) > 0.45) end++;
  return { title: "Rush", sub: `till ${String(end).padStart(2, "0")}:00`, tone: "bad" };
}

export const FACTOR_NAME: Record<Factor, string> = {
  heat: "Heat",
  air: "Air",
  wind: "Wind",
  traffic: "Traffic",
  light: "Daylight",
  safety: "Surface",
};

/** Missing values remain visibly absent, including internal unavailable scores. */
export const displayNumber = (value: number | null | undefined, digits = 0): string =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export const finiteValues = (values: (number | null)[]): number[] =>
  values.filter((v): v is number => v != null && Number.isFinite(v));
export function rangeText(values: (number | null)[]): string {
  const known = finiteValues(values);
  return known.length ? `${displayNumber(Math.min(...known))}° to ${displayNumber(Math.max(...known))}°` : "No temperature data";
}
