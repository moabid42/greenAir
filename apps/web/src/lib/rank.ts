import type { Activity, GridFeature, GridResponse, Hour } from "./api/types";
import { distKm } from "./geo";
import { cellScore, type Tune } from "./score";

export type LngLat = [number, number];

/** A place worth going to, ranked for one hour. */
export interface Spot {
  cellId: string;
  place: string;
  score: number;
  lngLat: LngLat;
  /** Distance from the user's location, when one is set. */
  distanceKm?: number;
}

/** Further than this from any grid cell = outside the area we cover. */
export const MAX_OUTSIDE_KM = 3;

export function centroid(f: GridFeature): LngLat {
  const ring = f.geometry.coordinates[0].slice(0, -1);
  return [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
}

export function nearestCell(grid: GridResponse, at: LngLat): { cell: GridFeature; km: number } | null {
  let best: GridFeature | null = null;
  let km = Infinity;
  for (const f of grid.cells.features) {
    const d = distKm(at, centroid(f));
    if (d < km) {
      km = d;
      best = f;
    }
  }
  return best ? { cell: best, km } : null;
}

/** Best places at an hour; with an origin, only those within radiusKm (null = anywhere). */
export function rankSpots(
  grid: GridResponse,
  hour: Hour,
  activity: Activity,
  tune: Tune,
  n: number,
  origin: LngLat | null,
  radiusKm: number | null,
  value?: (f: GridFeature) => number,
): Spot[] {
  const seen = new Set<string>();
  return grid.cells.features
    .filter((f) => f.properties.recommendable !== false)
    .map((f) => {
      const lngLat = centroid(f);
      return {
        cellId: f.properties.id,
        place: f.properties.place,
        score: value ? value(f) : cellScore(f.properties, hour, activity, tune),
        lngLat,
        distanceKm: origin ? distKm(origin, lngLat) : undefined,
      };
    })
    .filter((s) => Number.isFinite(s.score))
    .filter((s) => s.distanceKm == null || radiusKm == null || s.distanceKm <= radiusKm)
    // Same score → closer wins.
    .sort((a, b) => b.score - a.score || (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .filter((s) => (seen.has(s.place) ? false : (seen.add(s.place), true)))
    .slice(0, n);
}

export const fmtKm = (km: number) => (km < 0.95 ? `${Math.max(100, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`);
