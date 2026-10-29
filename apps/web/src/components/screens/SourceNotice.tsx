"use client";

import { useApp } from "@/state/app";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

/** Persistent explanation of the inputs used by the city recommendation. */
export default function SourceNotice() {
  const { day, grid } = useApp();
  if (!day) return null;
  return (
    <details className="pointer-events-auto rounded-2xl bg-white/97 px-3 py-2 text-[11px] shadow-sm">
      <summary className="cursor-pointer font-bold">
        {day.source === "mock" ? "Simulated conditions" : "Modelled city conditions"}
        {grid?.source === "mixed" ? " · historical street data" : ""}
        {day.status === "stale" ? " · stale stored data" : day.status === "partial" ? " · partial coverage" : ""}
      </summary>
      <p className="mt-1 leading-relaxed">
        {day.source === "mock" ? "Synthetic development data." : "Weather and air are model outputs. Station measurements are shown separately on the map. Missing traffic and safety inputs are excluded from the index."}
      </p>
      {day.retrievedAt && <p className="mt-1">Sources retrieved {when(day.retrievedAt)} Berlin time. Build {when(day.generatedAt)}.</p>}
      <p className="mt-1">{grid?.status === "unavailable" ? "Street grid and place rankings unavailable; no street-level pollution differences are inferred." : grid?.source === "mock" ? "Spatial grid: simulated." : "Street attributes: historical rider-derived data; survey age unknown. Air is modelled; where available, stationary-sensor interpolation is an estimate, not a street measurement. Place rankings withheld until spatial confidence is established."}</p>
      {grid?.source === "mixed" && <p className="mt-1">{grid.coverage?.roads?.toLocaleString()} roads · {grid.coverage?.roughness?.toLocaleString()} with surface · {grid.coverage?.overtaking_share?.toLocaleString()} with close-pass data. Flow is a speed proxy, not current traffic. {grid.capturedAt ? `Captured ${when(grid.capturedAt)}.` : ""}</p>}
      {grid?.attribution?.length ? <p className="mt-1">Street sources: {grid.attribution.join(" · ")}</p> : null}
      {day.attribution?.length ? <p className="mt-1">Sources: {day.attribution.join(" · ")}</p> : null}
    </details>
  );
}
