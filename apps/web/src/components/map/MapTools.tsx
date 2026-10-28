"use client";

import { useState } from "react";
import { Compass, Layers2, Navigation } from "lucide-react";
import { useApp } from "@/state/app";

/** Floating map controls and a data-status pill, in the EcoMAB layout: locate, layers, reset north. */
export default function MapTools() {
  const { day, error, focusMap, openSheet, showToast, segments } = useApp();
  const [locating, setLocating] = useState(false);

  const status = segments?.source === "mock" ? { text: "Street scores · simulated", dot: "bg-ok" } : segments ? { text: segments.kind === "forecast" ? "Street scores · forecast" : "Street scores · observed", dot: "bg-great" } : error ? { text: "Data unavailable · map only", dot: "bg-bad" } : !day ? { text: "Loading data", dot: "bg-ok" } : day.source === "mock" ? { text: "Simulated day", dot: "bg-ok" } : day.source === "forecast" ? { text: "Live forecast", dot: "bg-great" } : { text: "Live data", dot: "bg-great" };

  const locate = () => {
    if (!navigator.geolocation) return showToast("Your browser can't find your location. You can still explore Heilbronn.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        focusMap([p.coords.longitude, p.coords.latitude], 14.5);
      },
      () => {
        setLocating(false);
        showToast("Location is off or blocked. The map stays on Heilbronn.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const btn = "pointer-events-auto grid size-12 place-items-center rounded-2xl bg-white/97 text-ink shadow-[0_4px_20px_rgb(22_44_41/0.2)] active:scale-95";
  return (
    <div className="pointer-events-none absolute inset-x-3 z-20 flex items-start justify-between" style={{ top: "calc(env(safe-area-inset-top) + 7.1rem)" }}>
      <div role="status" className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/97 px-3 py-2 text-xs font-bold shadow-[0_3px_12px_rgb(22_44_41/0.14)]">
        <span aria-hidden className={`size-[7px] rounded-full ${status.dot}`} />
        {status.text}
      </div>
      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={locate} disabled={locating} aria-label="Use my location" title="Use my location" className={btn}>
          <Navigation className={`size-5 ${locating ? "animate-pulse text-brand" : ""}`} aria-hidden />
        </button>
        <button type="button" onClick={() => openSheet("layers")} aria-label="Map layers" title="Map layers" className={btn}>
          <Layers2 className="size-5" aria-hidden />
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new Event("ecomab:reset-north"))} aria-label="Reset map bearing" title="Reset map bearing" className={btn}>
          <Compass className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
