/**
 * Real senseBox:bike layers for Heilbronn, straight from the atrai OGC API
 * (CORS-open). Loaded lazily, only when a cyclist turns the layer on.
 */
export type BikeLayer = "surface" | "overtaking" | "danger";

const COLLECTION: Record<BikeLayer, string> = {
  surface: "bumpy_roads_heilbronn",
  overtaking: "overtaking_distance_heilbronn",
  danger: "danger_zones_heilbronn",
};

const cache = new Map<BikeLayer, Promise<GeoJSON.FeatureCollection>>();

export function getBikeLayer(layer: BikeLayer): Promise<GeoJSON.FeatureCollection> {
  let p = cache.get(layer);
  if (!p) {
    p = fetch(`https://api.atrai.bike/collections/${COLLECTION[layer]}/items?f=json&limit=10000`)
      .then((r) => {
        if (!r.ok) throw new Error(`atrai ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        cache.delete(layer); // allow retry
        throw e;
      });
    cache.set(layer, p);
  }
  return p;
}
