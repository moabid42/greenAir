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
        {day.status === "stale" ? " · stale stored data" : day.status === "partial" ? " · partial coverage" : ""}
      </summary>
      <p className="mt-1 leading-relaxed">
        {day.source === "mock" ? "Synthetic development data." : "Weather and air are model outputs. Station measurements are shown separately on the map. Missing traffic and safety inputs are excluded from the index."}
      </p>
      {day.retrievedAt && <p className="mt-1">Sources retrieved {when(day.retrievedAt)} Berlin time. Build {when(day.generatedAt)}.</p>}
      <p className="mt-1">{grid?.status === "unavailable" ? "Street grid and place rankings unavailable; no street-level pollution differences are inferred." : grid?.source === "mock" ? "Spatial grid: simulated." : "Spatial coverage: see map layers."}</p>
      {day.attribution?.length ? <p className="mt-1">Sources: {day.attribution.join(" · ")}</p> : null}
    </details>
  );
}
