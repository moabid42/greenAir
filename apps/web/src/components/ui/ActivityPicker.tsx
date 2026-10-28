"use client";

import { Bike, Footprints, PersonStanding, type LucideIcon } from "lucide-react";
import type { Activity } from "@/lib/api/types";
import { cn } from "@/lib/cn";

const ITEMS: { value: Activity; label: string; icon: LucideIcon }[] = [
  { value: "run", label: "Run", icon: PersonStanding },
  { value: "ride", label: "Ride", icon: Bike },
  { value: "walk", label: "Walk", icon: Footprints },
];

/** The three sports as a compact pill of icons (floats over the map). */
export function ActivityPill({ value, onChange }: { value: Activity; onChange: (a: Activity) => void }) {
  return (
    <div role="radiogroup" aria-label="Activity" className="flex gap-0.5 rounded-full bg-white/96 p-[3px] shadow-[0_4px_16px_rgb(22_44_41/0.16)]">
      {ITEMS.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={label}
          onClick={() => onChange(v)}
          className={cn("grid size-[38px] place-items-center rounded-full transition-colors", value === v ? "bg-ink text-lime" : "text-mute")}
        >
          <Icon className="size-[18px]" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** The three sports as big cards (onboarding). */
export function ActivityCards({ value, onChange }: { value: Activity; onChange: (a: Activity) => void }) {
  return (
    <div role="radiogroup" aria-label="Your sport" className="grid grid-cols-3 gap-2.5">
      {ITEMS.map(({ value: v, label, icon: Icon }) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={cn(
              "flex h-28 flex-col items-center justify-center gap-2.5 rounded-3xl border-2 bg-white text-sm font-extrabold transition-colors",
              on ? "border-ink" : "border-line text-mute",
            )}
          >
            <span className={cn("grid size-11 place-items-center rounded-full", on ? "bg-lime text-ink" : "bg-wash")}>
              <Icon className="size-6" aria-hidden />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
