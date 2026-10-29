import type { Activity, CellProperties, Hour } from "./api/types";
import { cellScore, type Tune } from "./score";

/** What the map colours show. */
export type Lens = "index" | "heat" | "air" | "traffic" | "wind" | "safety" | "surface";

export const LENSES: { value: Lens; label: string; hint: string; rideOnly?: boolean }[] = [
  { value: "index", label: "Overall", hint: "Everything combined" },
  { value: "heat", label: "Heat", hint: "Green = pleasant · red = too hot" },
  { value: "air", label: "Air", hint: "Green = clean air · red = polluted" },
  { value: "traffic", label: "Street flow", hint: "Historical speed proxy · survey age unknown" },
  { value: "wind", label: "Wind", hint: "Green = calm · red = strong wind" },
  { value: "safety", label: "Close passes", hint: "Historical distances below 1.5 m", rideOnly: true },
  { value: "surface", label: "Road surface", hint: "Historical roughness · green = smoother", rideOnly: true },
];

export function lensesFor(activity: Activity) {
  return LENSES.filter((l) => !l.rideOnly || activity === "ride");
}

/** The 0–100 value a lens paints for one cell at one hour. */
export function lensValue(c: CellProperties, hour: Hour, lens: Lens, activity: Activity, tune: Tune): number {
  if (lens === "index") return cellScore(c, hour, activity, tune);
  if (lens === "safety") return c.safety ?? Number.NaN;
  if (lens === "surface") return c.surface ?? Number.NaN;
  return c[lens][hour] ?? Number.NaN;
}
