"use client";

import { useMemo } from "react";
import { ArrowRight, Crosshair } from "lucide-react";
import { distKm } from "@/lib/geo";
import { centroid } from "@/lib/rank";
import { directionsUrl } from "@/lib/reminders";
import { scoreColor } from "@/lib/score";
import { useApp } from "@/state/app";

const LEGEND = [
  { color: "#14966f", label: "Smooth" },
  { color: "#dbad36", label: "Rough" },
  { color: "#bb5250", label: "Bumpy" },
];

/** Ride mode: real measured road quality and close-pass spots inside your reach. */
export default function RideCard() {
  const { ride, grid, day, home, prefs, windows, bestSpot, focusMap, showToast } = useApp();

  // Average road-safety score of the places inside your reach.
  const safe = useMemo(() => {
    if (!grid) return null;
    const vals = grid.cells.features
      .filter((f) => !home || prefs.radiusKm == null || distKm(home, centroid(f)) <= prefs.radiusKm)
      .map((f) => f.properties.safety)
      .filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [grid, home, prefs.radiusKm]);

  const best = windows[0];
  const street = ride?.smoothest[0];

  const start = () => {
    if (!bestSpot) return showToast("Nothing within reach yet — try a bigger distance.");
    window.open(directionsUrl(bestSpot.lngLat, "ride"), "_blank", "noopener");
  };

  if (day?.source !== "mock") return (
    <section aria-label="Cycling near you" className="pointer-events-auto space-y-2 rounded-[28px] bg-white/97 p-4 text-sm shadow-lg">
      <h2 className="font-bold">{grid?.status === "unavailable" ? "Street data unavailable" : "Rider-derived street data"}</h2>
      <p>{grid?.coverage?.roughness?.toLocaleString() ?? "—"} roads with surface data · {grid?.coverage?.overtaking_share?.toLocaleString() ?? "—"} with close-pass histograms.</p>
      <p className="text-xs text-mute">Use the map layers to inspect historical attributes. Survey age is unknown; missing areas stay blank. No verified street PM coverage or place recommendation.</p>
      <p className="text-xs text-mute">ATRAI / senseBox:bike · OpenStreetMap contributors</p>
    </section>
  );

  return (
    <>
      <div className="pointer-events-auto flex w-fit gap-3 rounded-[14px] bg-white/96 px-3 py-2 text-[11px] font-extrabold shadow-[0_4px_12px_rgb(22_44_41/0.16)]">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span aria-hidden className="h-1 w-3.5 rounded-sm" style={{ backgroundColor: l.color }} />
            {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-[9px] rounded-full bg-[#b8321f]" />
          Close pass
        </span>
      </div>

      <section aria-label="Cycling near you" className="pointer-events-auto flex flex-col gap-3 rounded-[28px] bg-white/97 p-3.5 shadow-[0_10px_40px_rgb(22_44_41/0.22)]">
        <div className="flex items-center gap-3">
          <div
            className="flex size-[54px] shrink-0 flex-col items-center justify-center rounded-[17px]"
            style={{ backgroundColor: safe != null ? scoreColor(safe) : "#e1eae6", color: safe != null && safe >= 60 ? "#162c29" : "#fff" }}
          >
            <span className="font-display text-xl font-extrabold leading-none">{safe ?? "–"}</span>
            <span className="text-[8px] font-extrabold tracking-wide">SAFE</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-brand">SMOOTHEST NEAR YOU</span>
            <span className="truncate text-base font-extrabold">
              {!ride ? "Reading road measurements…" : ride.smoothest.length ? ride.smoothest.slice(0, 2).map((s) => s.name).join(" · ") : "No measurements here yet"}
            </span>
            <span className="text-xs font-semibold text-mute">{ride ? `${ride.segments.toLocaleString()} measured road segments in reach` : "from senseBox:bike riders"}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <div className="flex flex-col rounded-[14px] bg-great-soft px-2.5 py-2 text-[#14653e]">
            <span className="font-display text-base font-extrabold leading-tight">{ride ? `${ride.smoothPct}%` : "–"}</span>
            <span className="text-[11px] font-bold leading-tight">smooth road</span>
          </div>
          <div className={`flex flex-col rounded-[14px] px-2.5 py-2 ${ride && ride.overtakingSegments > 0 && ride.tightPct >= 50 ? "bg-bad-soft text-[#9a3a12]" : "bg-great-soft text-[#14653e]"}`}>
            <span className="font-display text-base font-extrabold leading-tight">{ride && ride.overtakingSegments > 0 ? `${ride.tightPct}%` : "–"}</span>
            <span className="text-[11px] font-bold leading-tight">passed &lt; 1.5 m</span>
          </div>
          <div className="flex flex-col rounded-[14px] bg-wash px-2.5 py-2">
            <span className="font-display text-base font-extrabold leading-tight">{best ? `${String(best.start).padStart(2, "0")}–${String(best.end).padStart(2, "0")}` : "–"}</span>
            <span className="text-[11px] font-bold leading-tight text-mute">best time</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={start} className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-extrabold text-lime">
            Start ride
            <ArrowRight className="size-[17px]" aria-hidden />
          </button>
          <button
            type="button"
            disabled={!street}
            onClick={() => street && focusMap(street.at, 16)}
            className="flex h-[50px] items-center gap-1.5 rounded-2xl bg-wash px-4 text-sm font-bold disabled:opacity-50"
          >
            <Crosshair className="size-4" aria-hidden />
            Show street
          </button>
        </div>
        <p className="-mt-1 text-[10px] font-semibold text-mute">Measured by local riders · senseBox:bike (atrai.bike)</p>
      </section>
    </>
  );
}
