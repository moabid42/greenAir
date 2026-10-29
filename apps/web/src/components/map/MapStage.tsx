"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";
import { circleBounds } from "@/lib/circle";
import { HEILBRONN_CENTER } from "@/lib/geo";
import { centroid, type LngLat } from "@/lib/rank";
import { cellScore } from "@/lib/score";
import { useApp } from "@/state/app";
import type { Camera, PlacePin, ViewMode } from "./SportMap";

// MapLibre touches `window`, so it only renders in the browser.
const SportMap = dynamic(() => import("./SportMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-[#e3eadf]" />,
});

/** The one map behind every screen. Screens float on top of it and steer its camera. */
export default function MapStage() {
  const { tab, placeId, placeCell, grid, values, bikeLayers, sensors, home, prefs, activity, hour, tune, spots, openPlace, showToast, day, error, retry, mapFocus, showSensors, inspectSensor, segments, segmentTileUrl, inspectSegment, lens } = useApp();

  const onMapTab = tab === "today" || tab === "explore";
  const riding = activity === "ride";

  // Only the close-up of a single place is 3D. Explore is a flat map like Today.
  const mode: ViewMode = placeCell ? "3d" : "2d";

  const base = useMemo<Camera>(() => {
    const placeKey = placeCell ? `place:${placeCell.properties.id}` : "";
    if (placeCell) {
      return {
        key: placeKey,
        center: centroid(placeCell),
        zoom: 15,
        pitch: 55,
        bearing: 20,
        padding: { top: 70, bottom: 460, left: 10, right: 10 },
      };
    }
    if (tab === "explore") {
      return {
        key: `explore:${home?.join() ?? ""}`,
        center: home ?? HEILBRONN_CENTER,
        zoom: 13,
        pitch: 0,
        bearing: 0,
        padding: { top: 170, bottom: 300, left: 10, right: 10 },
      };
    }
    const pad = { top: 130, bottom: riding ? 330 : 360, left: 24, right: 24 };
    if (home && prefs.radiusKm) {
      return { key: `flat:${home.join()}:${prefs.radiusKm}:${riding}`, bounds: circleBounds(home, prefs.radiusKm), padding: pad, pitch: 0, bearing: 0 };
    }
    return { key: `flat:city:${home?.join() ?? ""}:${riding}`, center: home ?? HEILBRONN_CENTER, zoom: 12.6, pitch: 0, bearing: 0, padding: pad };
    // The camera should move when the screen, place, location or sport changes, not on every data refresh.
  }, [tab, placeCell, home, prefs.radiusKm, riding]);

  // A "look here" request (e.g. from Coach or the ride card) wins until the user moves on.
  const camera = useMemo<Camera>(
    () => (mapFocus ? { key: mapFocus.key, center: mapFocus.center, zoom: mapFocus.zoom, pitch: 0, bearing: 0, padding: base.padding } : base),
    [mapFocus, base],
  );

  const pin = useMemo<PlacePin | null>(() => {
    if (!placeCell) return null;
    return { lngLat: centroid(placeCell), label: placeCell.properties.place, score: cellScore(placeCell.properties, hour, activity, tune) };
  }, [placeCell, hour, activity, tune]);

  // Best-spot bubbles; the one right on top of you would hide your own pin.
  const bubbles = useMemo(
    () => (onMapTab && !placeId && !riding && grid ? spots(4).filter((s) => s.distanceKm == null || s.distanceKm > 0.35).slice(0, 3) : []),
    [onMapTab, placeId, riding, grid, spots],
  );

  const onBikeError = useCallback(() => showToast("Couldn't load the cycling data. Check your connection."), [showToast]);

  const edge = "top-[calc(env(safe-area-inset-top)+2px)]";
  return (
    <div className={`absolute inset-0 ${onMapTab ? "" : "invisible"}`} aria-hidden={!onMapTab}>
      <SportMap
        mode={mode}
        grid={grid}
        values={values}
        bikeLayers={day?.source === "mock" ? bikeLayers : []}
        sensors={onMapTab && showSensors ? sensors : []}
        onSensorTap={inspectSensor}
        segments={onMapTab ? segments : null}
        segmentsVisible={lens === "index"}
        segmentTileUrl={segmentTileUrl ?? undefined}
        onSegmentTap={inspectSegment}
        home={home as LngLat | null}
        radiusKm={prefs.radiusKm}
        pin={pin}
        spots={bubbles}
        camera={camera}
        onTapCell={openPlace}
        onBikeLayerError={onBikeError}
      />
      <span className={`pointer-events-none absolute left-0 right-0 ${edge} text-center text-[9px] font-semibold text-ink/55`}>
        © OpenStreetMap · OpenFreeMap · Mapzen terrain
      </span>
      {!day && !error && (
        <div role="status" className="absolute inset-x-0 top-[40%] mx-auto w-fit rounded-full bg-white px-4 py-2 text-xs font-bold shadow-lg">
          Loading Heilbronn…
        </div>
      )}
      {error && (
        <div role="alert" className="absolute inset-x-6 top-[38%] rounded-3xl bg-white p-5 text-center shadow-xl">
          <p className="text-sm font-bold">We couldn&apos;t load the data.</p>
          <p className="mt-1 text-xs text-mute">{error}</p>
          <button type="button" onClick={retry} className="mt-3 h-11 rounded-2xl bg-ink px-6 text-sm font-extrabold text-lime">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
