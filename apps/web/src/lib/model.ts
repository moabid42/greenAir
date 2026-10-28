/**
 * Raw measurement → factor score (0–100, 100 = best for sport).
 * Used by the demo/mock data layer. The real backend should implement the
 * same curves (documented in README.md (Expected API endpoints)) so numbers match.
 */

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Comfortable band 5–18 °C perceived. Humid heat counts extra. */
export function heatScore(tempC: number, humidity: number): number {
  const perceived = tempC + (tempC > 20 && humidity > 60 ? (humidity - 60) * 0.1 : 0);
  if (perceived > 18) return clamp(100 - (perceived - 18) * 6.5);
  if (perceived < 5) return clamp(100 - (5 - perceived) * 5);
  return 100;
}

/** PM2.5 (WHO 24h guideline 15) + NO2 (traffic tracer). */
export function airScore(pm25: number, no2: number): number {
  return clamp(100 - (pm25 / 25) * 55 - (no2 / 100) * 45);
}

export function windScore(windKmh: number): number {
  return windKmh <= 15 ? 100 : clamp(100 - (windKmh - 15) * 3);
}

/** `exposure` 0–1: how much this place is on a commuter road. */
export function trafficScore(rush: number, exposure = 0.5): number {
  return clamp(100 - rush * (15 + exposure * 85));
}

/** Street lighting helps, but a lit street at night never scores better than 35. */
export function lightScore(daylight: number, streetLit = 0.2): number {
  return clamp(Math.max(daylight * 100, Math.min(35, streetLit * 40 + 5)));
}

/**
 * Commuter fingerprint: German urban peaks roughly 7–9 and 16–18
 * (approximate prior — the backend replaces this with bike counts + NO2).
 */
export function rushCurve(hour: number, weekend: boolean): number {
  const g = (mu: number, sigma: number) => Math.exp(-((hour + 0.5 - mu) ** 2) / (2 * sigma ** 2));
  if (weekend) return 0.35 * g(14, 3);
  return Math.min(1, g(8, 0.9) + 0.9 * g(17.2, 1.2) + 0.25 * g(12.5, 1.5));
}

/** Approximate daylight (0–1) for Heilbronn from day of year, in local time. */
export function daylightCurve(date: Date, hour: number): number {
  const doy = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const lat = (49.14 * Math.PI) / 180;
  const decl = 0.409 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const dayLen = (24 / Math.PI) * Math.acos(-Math.tan(lat) * Math.tan(decl));
  const noon = 12.4 + (isSummerTime(date) ? 1 : 0);
  const t = hour + 0.5;
  const sunrise = noon - dayLen / 2;
  const sunset = noon + dayLen / 2;
  // 45 min twilight ramp on both sides
  const up = clamp((t - (sunrise - 0.5)) / 1.0, 0, 1);
  const down = clamp((sunset + 0.5 - t) / 1.0, 0, 1);
  return Math.min(up, down);
}

function isSummerTime(d: Date): boolean {
  const y = d.getFullYear();
  const lastSunday = (m: number) => {
    const x = new Date(y, m + 1, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
  };
  return d >= lastSunday(2) && d < lastSunday(9);
}
