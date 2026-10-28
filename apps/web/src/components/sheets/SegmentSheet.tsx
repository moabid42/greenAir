"use client";

import { Loader2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import { useApp } from "@/state/app";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", timeZoneName: "short" }).format(new Date(iso));

/** What the backend knows about one street segment: score, confidence, each component with its source, and what is missing. */
export default function SegmentSheet() {
  const { sheet, closeSheet, segmentView } = useApp();
  const open = sheet === "segment" && segmentView != null;
  if (!segmentView) return null;
  return (
    <Sheet open={open} onClose={closeSheet} title={segmentView.state === "ready" ? segmentView.detail.name || "Street conditions" : "Street conditions"}>
      {segmentView.state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-mute">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Asking for this street…
        </p>
      )}
      {segmentView.state === "none" && <p className="rounded-2xl bg-wash p-3.5 text-sm">No street data is available here. The colours on the map describe the whole city, not this street.</p>}
      {segmentView.state === "ready" && (
        <>
          <p className="text-sm">
            <b className="font-display text-2xl text-brand">{segmentView.detail.score}</b>/100 · {segmentView.detail.source === "mock" ? "Simulated" : segmentView.detail.kind === "forecast" ? "Forecast" : "Observed"} · {when(segmentView.detail.t)} ·{" "}
            {segmentView.detail.confidence < 0.3 ? "little data" : `confidence ${Math.round(segmentView.detail.confidence * 100)}%`}
          </p>
          {segmentView.detail.gates.length > 0 && <p className="mt-2 rounded-2xl bg-ok-soft p-3 text-[13px] font-semibold text-[#7a5200]">Conditions: {segmentView.detail.gates.join(", ")}</p>}
          <div className="mt-3 flex flex-col gap-1.5">
            {segmentView.detail.components.map((c) => (
              <p key={c.key} className="rounded-2xl bg-wash p-3 text-[13px]">
                <b>{c.label}</b>: {c.value ?? "Unavailable"} {c.unit} <span className="text-mute">· {c.source} · weight {c.weight}</span>
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-mute">Not available: {segmentView.detail.missing.join(", ") || "none reported"}.</p>
        </>
      )}
    </Sheet>
  );
}
