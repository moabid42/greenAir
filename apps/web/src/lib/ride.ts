import { getBikeLayer } from "./api/atrai";
import { distKm } from "./geo";
import type { LngLat } from "./rank";

export interface RideStats {
  /** Measured road segments inside your reach. */
  segments: number;
  /** Share of those segments that measured smooth. */
  smoothPct: number;
  /** Share of measured streets where cars pass closer than the legal 1.5 m (German town limit). */
  tightPct: number;
  /** How many streets had overtaking measurements inside your reach. */
  overtakingSegments: number;
  /** The smoothest streets with enough measurements. */
  smoothest: { name: string; roughness: number; at: LngLat }[];
}

const SMOOTH_BELOW = 12; // "Normalized Roughness" 0–100; most roads measure under 12
const LEGAL_PASS_CM = 150;

/** The API sometimes sends a list like "['Neckartalstraße', 'Neue Straße']". Take the first name. */
function streetName(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.match(/^\[?'?"?([^'"\],]+)/);
  return m ? m[1].trim() : raw;
}

export async function computeRideStats(center: LngLat | null, radiusKm: number | null): Promise<RideStats> {
  const [surface, overtaking] = await Promise.all([getBikeLayer("surface"), getBikeLayer("overtaking")]);
  const within = (p: LngLat) => !center || radiusKm == null || distKm(center, p) <= radiusKm;

  let segments = 0;
  let smooth = 0;
  const streets = new Map<string, { sum: number; n: number; at: LngLat }>();
  for (const f of surface.features) {
    if (f.geometry.type !== "LineString" || f.geometry.coordinates.length === 0) continue;
    const at = f.geometry.coordinates[0] as LngLat;
    if (!within(at)) continue;
    const rough = Number(f.properties?.["Normalized Roughness"]);
    if (Number.isNaN(rough)) continue;
    segments++;
    if (rough < SMOOTH_BELOW) smooth++;
    const name = streetName(f.properties?.name);
    if (name) {
      const s = streets.get(name) ?? { sum: 0, n: 0, at };
      s.sum += rough;
      s.n++;
      streets.set(name, s);
    }
  }

  let passSegments = 0;
  let tight = 0;
  for (const f of overtaking.features) {
    if (f.geometry.type !== "LineString" || f.geometry.coordinates.length === 0) continue;
    const cm = Number(f.properties?.["Average Overtaking Distance cm"]);
    if (Number.isNaN(cm) || !within(f.geometry.coordinates[0] as LngLat)) continue;
    passSegments++;
    if (cm < LEGAL_PASS_CM) tight++;
  }

  const smoothest = [...streets.entries()]
    .filter(([, s]) => s.n >= 4)
    .map(([name, s]) => ({ name, roughness: s.sum / s.n, at: s.at }))
    .sort((a, b) => a.roughness - b.roughness)
    .slice(0, 3);

  return {
    segments,
    smoothPct: segments ? Math.round((smooth / segments) * 100) : 0,
    tightPct: passSegments ? Math.round((tight / passSegments) * 100) : 0,
    overtakingSegments: passSegments,
    smoothest,
  };
}
