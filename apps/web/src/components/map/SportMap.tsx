"use client";

import { SegmentOverlay, SEGMENT_LAYER } from "./segmentOverlay";
import type { SegmentSnapshot } from "@/lib/api/consumer";
import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GridResponse, Sensor } from "@/lib/api/types";
import { getBikeLayer, type BikeLayer } from "@/lib/api/atrai";
import { circle } from "@/lib/circle";
import { HEILBRONN_CENTER } from "@/lib/geo";
import type { LngLat, Spot } from "@/lib/rank";
import { scoreColor } from "@/lib/score";

export type ViewMode = "2d" | "3d";

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A move the map should make. A new `key` = a new move. */
export interface Camera {
  key: string;
  center?: LngLat;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  bounds?: [LngLat, LngLat];
  padding?: Padding;
  duration?: number;
}

export interface PlacePin {
  lngLat: LngLat;
  label: string;
  score: number;
}

interface SportMapProps {
  mode: ViewMode;
  grid: GridResponse | null;
  /** cell id → value 0–100 for the active layer + hour */
  values: Record<string, number>;
  bikeLayers: BikeLayer[];
  sensors: Sensor[];
  onSensorTap?: (s: Sensor) => void;
  /** Optional backend street scores, drawn only when provided. */
  segments?: SegmentSnapshot | null;
  segmentsVisible?: boolean;
  segmentTileUrl?: (build: string) => string;
  onSegmentTap?: (lng: number, lat: number) => void;
  home: LngLat | null;
  /** Reach around `home`; null = no circle. */
  radiusKm: number | null;
  pin: PlacePin | null;
  spots: Spot[];
  camera: Camera;
  onTapCell: (cellId: string) => void;
  onBikeLayerError?: (layer: BikeLayer) => void;
}

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

const BIKE_PAINT: Record<BikeLayer, { type: "line" | "circle"; paint: Record<string, unknown> }> = {
  surface: {
    type: "line",
    paint: {
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 5],
      // Normalized Roughness 0–100: low = smooth (green), high = bumpy (red)
      "line-color": ["interpolate", ["linear"], ["get", "Normalized Roughness"], 0, "#14966f", 12, "#74b68c", 25, "#dbad36", 45, "#bb5250"],
      "line-opacity": 0.92,
    },
  },
  overtaking: {
    type: "line",
    paint: {
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 6],
      // 150 cm is the German legal minimum inside town
      "line-color": ["interpolate", ["linear"], ["get", "Average Overtaking Distance cm"], 80, "#bb5250", 120, "#dbad36", 150, "#74b68c", 200, "#14966f"],
      "line-dasharray": [2, 1],
    },
  },
  danger: {
    type: "circle",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 5],
      "circle-color": "#b8321f",
      "circle-opacity": ["interpolate", ["linear"], ["get", "Risk Index Overtaking"], 0, 0.15, 1, 0.85],
    },
  },
};

const SENSOR_COLOR: Record<Sensor["kind"], string> = {
  sensebox_home: "#2563eb",
  lubw: "#7c3aed",
  bike_counter: "#0d9488",
};

export default function SportMap(props: SportMapProps) {
  const { mode, grid, values, bikeLayers, sensors, home, radiusKm, pin, spots, camera, onTapCell, onBikeLayerError, onSensorTap, segments, segmentsVisible = true, segmentTileUrl, onSegmentTap } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const homeMarker = useRef<maplibregl.Marker | null>(null);
  const pinMarker = useRef<maplibregl.Marker | null>(null);
  const sensorMarkers = useRef<maplibregl.Marker[]>([]);
  const spotMarkers = useRef<maplibregl.Marker[]>([]);
  // Keep the latest callbacks without re-binding map events.
  const onTapRef = useRef(onTapCell);
  const onErrRef = useRef(onBikeLayerError);
  const onSegRef = useRef(onSegmentTap);
  const overlay = useRef<SegmentOverlay | null>(null);
  useEffect(() => {
    onTapRef.current = onTapCell;
    onErrRef.current = onBikeLayerError;
    onSegRef.current = onSegmentTap;
  }, [onTapCell, onBikeLayerError, onSegmentTap]);

  // --- init once ---
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: HEILBRONN_CENTER,
      zoom: 12.4,
      maxPitch: 75,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

      map.addSource("dem", { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 14 });
      map.addLayer(
        {
          id: "hillshade",
          type: "hillshade",
          source: "dem",
          layout: { visibility: "none" },
          paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#78716c" },
        },
        firstSymbol,
      );

      // "How far will you go" ring around the user's location.
      map.addSource("reach", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "reach-fill", type: "fill", source: "reach", paint: { "fill-color": "#059669", "fill-opacity": 0.05 } }, firstSymbol);
      map.addLayer(
        { id: "reach-line", type: "line", source: "reach", paint: { "line-color": "#047857", "line-width": 2, "line-dasharray": [3, 2] } },
        firstSymbol,
      );

      // Stored grids show bounded road-cell summaries; hit cells also support inspection.
      map.addSource("grid", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
      map.addLayer({ id: "grid-data", type: "fill", source: "grid", paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["case", ["==", ["get", "visible"], true], 0.30, 0],
      } }, firstSymbol);
      map.addLayer({ id: "grid-hit", type: "fill", source: "grid", paint: { "fill-opacity": 0 } });

      map.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#e7e5e4",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.9,
        },
      });

      readyRef.current = true;
      map.fire("app:ready");
    });

    // A tap on a backend street segment opens its details instead of selecting the map cell under it.
    const segmentAt = (point: maplibregl.PointLike) => map.getLayer(SEGMENT_LAYER) && map.getLayoutProperty(SEGMENT_LAYER, "visibility") !== "none" && map.queryRenderedFeatures(point, { layers: [SEGMENT_LAYER] }).length > 0;
    map.on("click", (e) => {
      if (segmentAt(e.point)) onSegRef.current?.(e.lngLat.lng, e.lngLat.lat);
    });
    map.on("click", "grid-hit", (e) => {
      if (segmentAt(e.point)) return;
      const id = e.features?.[0]?.properties.id as string | undefined;
      if (id) onTapRef.current(id);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Run fn now if the style is loaded, otherwise once it is. */
  const whenReady = (fn: (map: MLMap) => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (readyRef.current) fn(map);
    else map.once("app:ready", () => fn(map));
  };

  // --- stored grid summaries and tap targets; missing values remain transparent ---
  useEffect(() => {
    whenReady((map) => {
      if (!grid) return;
      (map.getSource("grid") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: grid.cells.features.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: { id: f.properties.id, color: scoreColor(values[f.properties.id]),
            visible: grid.source === "mixed" && Number.isFinite(values[f.properties.id]) },
        })),
      });
    });
  }, [grid, values]);

  // --- 2D / 3D: real terrain, hill shading, buildings, sky ---
  useEffect(() => {
    whenReady((map) => {
      const is3d = mode === "3d";
      map.setLayoutProperty("buildings-3d", "visibility", is3d ? "visible" : "none");
      map.setLayoutProperty("hillshade", "visibility", is3d ? "visible" : "none");
      map.setTerrain(is3d ? { source: "dem", exaggeration: 2 } : null);
      try {
        map.setSky(is3d ? { "sky-color": "#cfe3f5", "horizon-color": "#f5f5f4", "sky-horizon-blend": 0.6 } : {});
      } catch {
        /* sky is optional eye candy */
      }
    });
  }, [mode]);

  // --- real senseBox:bike layers ---
  useEffect(() => {
    whenReady((map) => {
      (Object.keys(BIKE_PAINT) as BikeLayer[]).forEach((layer) => {
        const id = `bike-${layer}`;
        const on = bikeLayers.includes(layer);
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
          return;
        }
        if (!on) return;
        getBikeLayer(layer)
          .then((fc) => {
            if (map.getLayer(id) || !mapRef.current) return;
            map.addSource(id, { type: "geojson", data: fc });
            const { type, paint } = BIKE_PAINT[layer];
            map.addLayer({ id, type, source: id, paint } as maplibregl.LayerSpecification, "buildings-3d");
          })
          .catch(() => onErrRef.current?.(layer));
      });
    });
  }, [bikeLayers, grid]);

  // --- sensor markers ---
  useEffect(() => {
    whenReady((map) => {
      sensorMarkers.current.forEach((m) => m.remove());
      sensorMarkers.current = sensors.map((s) => {
        const el = document.createElement("div");
        el.className = "sensor-pin";
        el.style.setProperty("--pin", SENSOR_COLOR[s.kind]);
        el.setAttribute("aria-label", `${s.name}, tap for details`);
        el.setAttribute("role", "button");
        el.addEventListener("click", (e) => {
          e.stopPropagation(); // do not also select the map cell under the pin
          onSensorTap?.(s);
        });
        return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
      });
    });
  }, [sensors, onSensorTap]);

  // --- optional backend street scores ---
  useEffect(() => {
    whenReady((map) => {
      try {
        if (!segments || !segmentTileUrl) return overlay.current?.hide();
        overlay.current ??= new SegmentOverlay(map, segmentTileUrl);
        overlay.current.apply(segments, segmentsVisible);
      } catch (err) {
        console.warn("Street scores unavailable", err);
        overlay.current?.hide();
      }
    });
  }, [segments, segmentsVisible, segmentTileUrl]);

  // --- "reset north" button (MapTools) ---
  useEffect(() => {
    const reset = () => whenReady((map) => map.easeTo({ bearing: 0, pitch: mode === "3d" ? map.getPitch() : 0, duration: 500 }));
    window.addEventListener("ecomab:reset-north", reset);
    return () => window.removeEventListener("ecomab:reset-north", reset);
  }, [mode]);

  // --- best-spot bubbles ---
  useEffect(() => {
    whenReady((map) => {
      spotMarkers.current.forEach((m) => m.remove());
      spotMarkers.current = spots.map((s) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "spot-pin";
        el.setAttribute("aria-label", `${s.place}, score ${s.score}`);
        el.innerHTML = `<span class="score" style="background:${scoreColor(s.score)}">${s.score}</span><span>${s.place}</span>`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onTapRef.current(s.cellId);
        });
        return new maplibregl.Marker({ element: el }).setLngLat(s.lngLat).addTo(map);
      });
    });
  }, [spots]);

  // --- the user's location + reach circle ---
  useEffect(() => {
    whenReady((map) => {
      const src = map.getSource("reach") as GeoJSONSource;
      if (!home) {
        homeMarker.current?.remove();
        homeMarker.current = null;
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      if (!homeMarker.current) {
        const el = document.createElement("div");
        el.className = "home-pin";
        el.textContent = "You";
        homeMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom" });
      }
      homeMarker.current.setLngLat(home).addTo(map);
      src.setData(radiusKm ? { type: "Feature", properties: {}, geometry: circle(home, radiusKm) } : { type: "FeatureCollection", features: [] });
    });
  }, [home, radiusKm]);

  // --- the opened place ---
  useEffect(() => {
    whenReady((map) => {
      pinMarker.current?.remove();
      pinMarker.current = null;
      if (!pin) return;
      const el = document.createElement("div");
      el.className = "place-pin";
      el.innerHTML = `<div class="label"><span class="score">${pin.score}</span><span></span></div><span class="stem"></span><span class="dot"></span>`;
      (el.querySelector(".label span:last-child") as HTMLElement).textContent = pin.label;
      pinMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, 9] }).setLngLat(pin.lngLat).addTo(map);
    });
  }, [pin]);

  // --- camera moves requested by the screens ---
  useEffect(() => {
    whenReady((map) => {
      const { bounds, center, zoom, pitch, bearing, padding, duration = 1100 } = camera;
      map.stop();
      if (bounds) {
        map.fitBounds(bounds, { padding: padding ?? 40, pitch: pitch ?? 0, bearing: bearing ?? 0, duration, maxZoom: 15 });
      } else {
        map.flyTo({ center, zoom, pitch, bearing, padding, duration, essential: true });
      }
    });
    // Only a new key means a new move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.key]);

  // MapLibre's own CSS sets `position: relative` on its container, so the container needs a real size.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
