/** Hand-picked Heilbronn geography used by the demo grid. [lng, lat] everywhere. */

export const HEILBRONN_CENTER: [number, number] = [9.2185, 49.1427];
export const GRID_BBOX = { west: 9.15, south: 49.105, east: 9.275, north: 49.178 };

export interface Place {
  name: string;
  at: [number, number];
}

export const PLACES: Place[] = [
  { name: "Innenstadt", at: [9.2185, 49.1427] },
  { name: "Pfühlpark", at: [9.2355, 49.1465] },
  { name: "Wertwiesenpark", at: [9.2125, 49.1285] },
  { name: "Neckarbogen", at: [9.205, 49.155] },
  { name: "Böckingen", at: [9.183, 49.136] },
  { name: "Sontheim", at: [9.2, 49.117] },
  { name: "Neckargartach", at: [9.188, 49.164] },
  { name: "Frankenbach", at: [9.16, 49.153] },
  { name: "Wartberg", at: [9.242, 49.164] },
  { name: "Südstadt", at: [9.228, 49.13] },
  { name: "Nordstadt", at: [9.225, 49.156] },
  { name: "Trappensee", at: [9.2565, 49.1393] },
  { name: "Stadtwald", at: [9.27, 49.13] },
];

/** Green & blue areas: centre, radius in km, strength 0–1. */
export const GREEN: { at: [number, number]; r: number; w: number }[] = [
  { at: [9.2355, 49.1465], r: 0.45, w: 1 },
  { at: [9.2125, 49.1285], r: 0.45, w: 0.9 },
  { at: [9.268, 49.136], r: 1.3, w: 1 },
  { at: [9.245, 49.164], r: 0.8, w: 0.8 },
  { at: [9.205, 49.155], r: 0.45, w: 0.7 },
  { at: [9.15, 49.15], r: 1.2, w: 0.7 },
  { at: [9.205, 49.114], r: 0.6, w: 0.7 },
];

export const NECKAR: [number, number][] = [
  [9.197, 49.178], [9.203, 49.163], [9.208, 49.152], [9.211, 49.143],
  [9.212, 49.133], [9.207, 49.122], [9.201, 49.105],
];

/** Main commuter roads. Weinsberger Straße hosts the LUBW NO2 station. */
export const MAIN_ROADS: [number, number][][] = [
  [[9.224, 49.146], [9.235, 49.15], [9.247, 49.155], [9.262, 49.159]], // Weinsberger Str.
  [[9.216, 49.15], [9.222, 49.143], [9.223, 49.137]], // Allee
  [[9.2, 49.175], [9.204, 49.158], [9.206, 49.148]], // Neckartalstr.
  [[9.222, 49.137], [9.205, 49.138], [9.185, 49.136], [9.155, 49.138]], // Südstr. / B39
  [[9.218, 49.135], [9.214, 49.122], [9.205, 49.106]], // Sontheimer axis
];

const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LNG = 111.32 * Math.cos((49.14 * Math.PI) / 180);

export function distKm(a: [number, number], b: [number, number]): number {
  const dx = (a[0] - b[0]) * KM_PER_DEG_LNG;
  const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

export function distToLineKm(p: [number, number], line: [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const ax = (p[0] - a[0]) * KM_PER_DEG_LNG, ay = (p[1] - a[1]) * KM_PER_DEG_LAT;
    const bx = (b[0] - a[0]) * KM_PER_DEG_LNG, by = (b[1] - a[1]) * KM_PER_DEG_LAT;
    const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by)));
    best = Math.min(best, Math.hypot(ax - t * bx, ay - t * by));
  }
  return best;
}

export function nearestPlace(p: [number, number]): string {
  let best = PLACES[0];
  let d = Infinity;
  for (const pl of PLACES) {
    const x = distKm(p, pl.at);
    if (x < d) { d = x; best = pl; }
  }
  return best.name;
}

/** Regular square grid covering the bbox. The map renders it as a smooth surface, not as tiles. */
export function squareGrid(sizeM: number): { id: string; center: [number, number]; ring: number[][] }[] {
  const dLng = sizeM / 1000 / KM_PER_DEG_LNG;
  const dLat = sizeM / 1000 / KM_PER_DEG_LAT;
  const out: { id: string; center: [number, number]; ring: number[][] }[] = [];
  for (let row = 0, lat = GRID_BBOX.south; lat < GRID_BBOX.north; lat += dLat, row++) {
    for (let col = 0, lng = GRID_BBOX.west; lng < GRID_BBOX.east; lng += dLng, col++) {
      const ring = [[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]];
      out.push({ id: `r${row}c${col}`, center: [lng + dLng / 2, lat + dLat / 2], ring });
    }
  }
  return out;
}
