import type { LngLat } from "./rank";

/** Circle polygon with radius in km (good enough at city scale). */
export function circle([lng, lat]: LngLat, km: number): GeoJSON.Polygon {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return { type: "Polygon", coordinates: [ring] };
}

export function circleBounds(center: LngLat, km: number): [LngLat, LngLat] {
  const ring = circle(center, km).coordinates[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}
