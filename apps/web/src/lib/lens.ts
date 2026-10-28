import type { Activity, CellProperties, Hour } from "./api/types";
import { cellScore, type Tune } from "./score";

/** What the map colours show. */
export type Lens = "index" | "heat" | "air" | "traffic" | "wind" | "safety";

export const LENSES: { value: Lens; label: string; hint: string; rideOnly?: boolean }[] = [
  { value: "index", label: "Overall", hint: "Everything combined" },
  { value: "heat", label: "Heat", hint: "Green = pleasant · red = too hot" },
  { value: "air", label: "Air", hint: "Green = clean air · red = polluted" },
  { value: "traffic", label: "Traffic", hint: "Red = busy roads at this hour" },
  { value: "wind", label: "Wind", hint: "Green = calm · red = strong wind" },
  { value: "safety", label: "Safety", hint: "Road surface & overtaking", rideOnly: true },
];

export function lensesFor(activity: Activity) {
  return LENSES.filter((l) => !l.rideOnly || activity === "ride");
}

/** The 0–100 value a lens paints for one cell at one hour. */
export function lensValue(c: CellProperties, hour: Hour, lens: Lens, activity: Activity, tune: Tune): number {
  if (lens === "index") return cellScore(c, hour, activity, tune);
  if (lens === "safety") return c.safety ?? 0;
  return c[lens][hour];
}
