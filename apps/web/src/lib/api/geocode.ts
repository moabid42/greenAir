/**
 * Address search + reverse lookup via Photon (OpenStreetMap, free, CORS-open).
 * Results are limited to the Heilbronn area.
 */
export interface GeoPlace {
  label: string;
  sub: string;
  lngLat: [number, number];
}

const BBOX = "9.10,49.08,9.32,49.20";
const BIAS = "lat=49.142&lon=9.219";

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Partial<Record<"name" | "street" | "housenumber" | "district" | "locality" | "city" | "postcode", string>>;
}

function toPlace(f: PhotonFeature): GeoPlace {
  const p = f.properties;
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : "";
  const label = p.name ?? (street || "Selected place");
  const sub = [p.name && street ? street : "", p.district ?? p.locality, p.city].filter(Boolean).join(", ");
  return { label, sub, lngLat: f.geometry.coordinates };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const q = encodeURIComponent(query.trim());
  const res = await fetch(`https://photon.komoot.io/api/?q=${q}&${BIAS}&bbox=${BBOX}&limit=6&lang=de`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data: { features: PhotonFeature[] } = await res.json();
  // Photon sometimes returns the same street several times (one per OSM way).
  const seen = new Set<string>();
  return data.features.map(toPlace).filter((p) => {
    const key = `${p.label}|${p.sub}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function reverseGeocode([lng, lat]: [number, number]): Promise<GeoPlace | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1&lang=de`);
    if (!res.ok) return null;
    const data: { features: PhotonFeature[] } = await res.json();
    return data.features[0] ? { ...toPlace(data.features[0]), lngLat: [lng, lat] } : null;
  } catch {
    return null;
  }
}
