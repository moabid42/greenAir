"use client";

import { Logo } from "@/components/ui/Logo";
import { lensesFor } from "@/lib/lens";
import { cn } from "@/lib/cn";
import { useApp } from "@/state/app";

/** Where you start + how far you will go. Opens the location sheet. */
export function LocationPill() {
  const { prefs, openSheet } = useApp();
  const label = prefs.home?.label === "My location" ? "Near you" : (prefs.home?.label ?? "Set your start");
  return (
    <button
      type="button"
      onClick={() => openSheet("location")}
      className="pointer-events-auto flex h-11 min-w-0 items-center gap-2 rounded-full bg-white/96 pl-2 pr-4 text-sm font-extrabold shadow-[0_4px_16px_rgb(22_44_41/0.16)]"
    >
      <Logo size={28} />
      <span className="truncate">{label}</span>
      {prefs.home && <span className="shrink-0 font-semibold text-mute">{prefs.radiusKm ? `${prefs.radiusKm} km` : "any"}</span>}
    </button>
  );
}

/** What the map colours show. */
export function LensChips({ tone = "ink" }: { tone?: "ink" | "heat" }) {
  const { lens, setLens, activity } = useApp();
  return (
    <div role="radiogroup" aria-label="What the colours show" className="no-scrollbar pointer-events-auto flex gap-1.5 overflow-x-auto">
      {lensesFor(activity).map((l) => {
        const on = lens === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={l.hint}
            onClick={() => setLens(l.value)}
            className={cn(
              "h-[34px] shrink-0 rounded-full px-3.5 text-xs transition-colors",
              on
                ? cn("font-extrabold text-white", tone === "heat" && l.value === "heat" ? "bg-bad" : "bg-ink")
                : "bg-white/96 font-bold shadow-[0_2px_8px_rgb(22_44_41/0.12)]",
            )}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small tinted tile: icon, big value, short label. */
export function Stat({ icon, value, label, className }: { icon: React.ReactNode; value: string; label: string; className: string }) {
  return (
    <div className={cn("flex h-11 items-center gap-1.5 rounded-[14px] px-2.5", className)}>
      {icon}
      <span className="flex min-w-0 flex-col leading-[1.15]">
        <span className="truncate font-display text-[13px] font-bold">{value}</span>
        <span className="truncate text-[10px] font-bold opacity-80">{label}</span>
      </span>
    </div>
  );
}

/** The measured cycling layers you can switch on. */
export function BikeChips() {
  const { bikeLayers, toggleBike } = useApp();
  const items = [
    { id: "surface", label: "Road surface" },
    { id: "danger", label: "Close passes" },
    { id: "overtaking", label: "Overtaking" },
  ] as const;
  return (
    <div className="no-scrollbar pointer-events-auto flex gap-1.5 overflow-x-auto" role="group" aria-label="Cycling layers">
      {items.map((i) => {
        const on = bikeLayers.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggleBike(i.id)}
            className={cn("h-[34px] shrink-0 rounded-full px-3.5 text-xs", on ? "bg-ink font-extrabold text-white" : "bg-white/96 font-bold shadow-[0_2px_8px_rgb(22_44_41/0.12)]")}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}
