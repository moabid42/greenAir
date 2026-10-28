import type { Activity, Factor, HourConditions } from "./api/types";
import { DEALBREAKER, WEIGHTS } from "./score";

export type Tone = "good" | "warn" | "bad";

export interface Reason {
  factor: Factor;
  tone: Tone;
  text: string;
}

const tone = (v: number): Tone => (v >= 75 ? "good" : v >= DEALBREAKER ? "warn" : "bad");

/** One short, plain-language sentence per factor — no units jargon unless it helps. */
function reasonFor(f: Factor, v: number, h: HourConditions, activity: Activity): string {
  const t = Math.round(h.tempC);
  switch (f) {
    case "heat":
      if (h.tempC < 5) return v >= 75 ? `Fresh, ${t} °C` : `Cold, ${t} °C — dress warm`;
      return v >= 75 ? `Pleasant, ${t} °C` : v >= DEALBREAKER ? `Warm, ${t} °C — bring water` : `Too hot, ${t} °C`;
    case "air":
      return v >= 75 ? "Clean air" : v >= DEALBREAKER ? "Air is okay" : "Polluted air — traffic fumes & dust";
    case "wind":
      return v >= 75 ? "Calm wind" : `Windy, ${Math.round(h.windKmh)} km/h`;
    case "traffic":
      return v >= 75 ? "Quiet roads" : v >= DEALBREAKER ? "Some traffic" : "Rush-hour traffic";
    case "light":
      if (v >= 75) return "Daylight";
      if (v >= DEALBREAKER) return "Twilight — be visible";
      return activity === "ride" ? "Dark — use bike lights" : "Dark — wear something reflective";
    case "safety":
      return v >= 75 ? "Smooth roads, safe passing" : v >= DEALBREAKER ? "Some bumpy roads" : "Bumpy roads & close passes";
  }
}

/** Reasons for the current hour, worst first so problems are seen first. */
export function reasons(factors: Record<Factor, number | null>, h: HourConditions, activity: Activity): Reason[] {
  const order: Record<Tone, number> = { bad: 0, warn: 1, good: 2 };
  return (Object.keys(WEIGHTS[activity]) as Factor[])
    .filter((f) => WEIGHTS[activity][f] > 0 && factors[f] != null)
    .map((f) => {
      const v = factors[f] ?? 0;
      return { factor: f, tone: tone(v), text: reasonFor(f, v, h, activity) };
    })
    .sort((a, b) => order[a.tone] - order[b.tone]);
}
