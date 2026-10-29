"use client";

import Sheet from "@/components/ui/Sheet";
import type { SensorKind } from "@/lib/api/types";
import { useApp } from "@/state/app";

const KIND: Record<SensorKind, string> = {
  sensebox_home: "senseBox:home · citizen weather and air station",
  lubw: "LUBW · state air-quality station",
  bike_counter: "Bike counter",
};

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", timeZoneName: "short" }).format(new Date(iso)) : "time unavailable";

/** What one real sensor reported, with its source and time, so the numbers can be checked. */
export default function SensorSheet() {
  const { sheet, closeSheet, inspected, day } = useApp();
  const open = sheet === "sensor" && inspected != null;
  if (!inspected) return null;
  const readings = Object.entries(inspected.latest);
  const mock = inspected.source === "mock" || (!inspected.source && day?.source === "mock");
  return (
    <Sheet open={open} onClose={closeSheet} title={inspected.name}>
      <p className="text-xs font-semibold text-mute">{mock ? "Simulated sensor · demo readings" : KIND[inspected.kind]}</p>
      {!mock && <p className="mt-1 text-xs text-mute">{inspected.exposure === "indoor" ? "Indoor · excluded from outdoor city levels" : inspected.exposure === "outdoor" ? "Outdoor" : "Exposure unknown"}{inspected.stale ? " · some channels are stale" : ""}</p>}
      {!mock && inspected.kind === "lubw" && <p className="mt-1 text-[10px] text-mute">Source: Umweltbundesamt mit Daten der Messnetze der Länder und des Bundes · dl-de/by-2-0.</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {readings.length === 0 && <p className="col-span-2 rounded-2xl bg-wash p-3.5 text-sm">No readings supplied by this sensor right now.</p>}
        {readings.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-wash p-3">
            <span className="block text-[11px] font-extrabold tracking-wide text-mute">{k.toUpperCase()}</span>
            <span className="font-display text-[22px] font-extrabold leading-tight text-brand">{v == null ? "—" : Math.round(v * 10) / 10}</span>
            {inspected.channelProvenance?.[k] && <p className="mt-1 text-[10px] text-mute">{inspected.channelProvenance[k].unit} · measured {when(inspected.channelProvenance[k].observedAt[0] ?? null)}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-mute">{mock ? <>Generated {when(inspected.updatedAt)}. These synthetic readings demonstrate the app and are not measurements from this station.</> : <>Last reading {when(inspected.updatedAt)}. This is a measurement at the sensor&apos;s own spot, not a street-by-street value. Check the source and time before relying on it.</>}</p>
    </Sheet>
  );
}
