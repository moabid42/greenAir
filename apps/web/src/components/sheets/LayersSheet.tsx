"use client";

import { Car, CircleDot, Cloud, ShieldCheck, Sun, Wind, type LucideIcon } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Toggle from "@/components/ui/Toggle";
import { cn } from "@/lib/cn";
import { type Lens, lensesFor } from "@/lib/lens";
import { useApp } from "@/state/app";

const ICON: Record<Lens, LucideIcon> = { index: CircleDot, heat: Sun, air: Wind, traffic: Car, wind: Cloud, safety: ShieldCheck };

/** Choose what the map colours show, switch sensor markers on or off, and read the legend. */
export default function LayersSheet() {
  const { sheet, closeSheet, lens, setLens, activity, showSensors, setShowSensors, sensors, grid, day } = useApp();
  const open = sheet === "layers";

  return (
    <Sheet open={open} onClose={closeSheet} title="Map layers">
      <p className="mb-3 text-xs leading-relaxed text-mute">{grid?.status === "unavailable" ? "Verified street layers are not connected. City-wide model conditions and measured sensor markers are separate layers." : grid?.source === "mock" || day?.source === "mock" ? "Spatial grid and place rankings are simulated." : "Select a layer and inspect its coverage and provenance."}</p>
      <div className="flex flex-col gap-1.5">
        {lensesFor(activity).map((l) => {
          const Icon = ICON[l.value];
          const on = lens === l.value;
          return (
            <button
              key={l.value}
              type="button"
              disabled={grid?.status === "unavailable"} onClick={() => setLens(l.value)}
              aria-pressed={on}
              className={cn("flex min-h-[52px] items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-sm", on ? "bg-great-soft font-extrabold text-brand" : "bg-wash font-semibold")}
            >
              <Icon className="size-[19px] shrink-0" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                {l.label}
                <span className="text-[11px] font-medium text-mute">{l.hint}</span>
              </span>
              <span className="text-xs font-semibold text-mute">{on ? "Selected" : "View"}</span>
            </button>
          );
        })}
        <div className="mt-1 overflow-hidden rounded-[14px] bg-wash">
          <Toggle checked={showSensors} onChange={setShowSensors} title="Sensor markers" hint={`${sensors.length} ${day?.source === "mock" ? "simulated" : "measured"} station markers · tap for channel times and units`} />
        </div>
      </div>

    </Sheet>
  );
}
