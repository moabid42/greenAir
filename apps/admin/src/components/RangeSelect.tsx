"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RangeDays } from "@/lib/types";

export const RANGES: RangeDays[] = [7, 14, 30, 90];

/** A pill-shaped native select, so it is fully accessible and works well on phones. */
export function RangeSelect({ value, onChange, label, compact, className }: { value: RangeDays; onChange: (r: RangeDays) => void; label: string; compact?: boolean; className?: string }) {
  return (
    <label className={cn("relative inline-flex items-center rounded-xl border border-line bg-white shadow-sm", className)}>
      <span className="sr-only">{label}</span>
      <CalendarDays className="pointer-events-none absolute left-3 size-4 text-ink" aria-hidden />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as RangeDays)}
        className={cn("w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-9 pr-9 font-bold text-ink", compact ? "h-9 text-[13px]" : "h-11 text-sm")}
      >
        {RANGES.map((r) => (
          <option key={r} value={r}>
            Last {r} days
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-mute" aria-hidden />
    </label>
  );
}
