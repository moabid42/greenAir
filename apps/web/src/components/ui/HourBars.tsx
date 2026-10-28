"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { fmtHour, scoreColor } from "@/lib/score";

interface HourBarsProps {
  values: number[];
  /** Hours with a commuter peak get a striped background. */
  rush?: number[];
  hour: number;
  nowHour: number | null;
  onPick: (h: number) => void;
  height?: number;
}

/** 24 bars, one per hour. Tap or drag to scrub; arrow keys step. */
export default function HourBars({ values, rush, hour, nowHour, onPick, height = 40 }: HourBarsProps) {
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onPick(Math.max(0, Math.min(23, Math.floor(((e.clientX - rect.left) / rect.width) * 24))));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") onPick(Math.min(23, hour + 1));
    if (e.key === "ArrowLeft") onPick(Math.max(0, hour - 1));
  };
  return (
    <div className="flex flex-col gap-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Hour of day"
        aria-valuemin={0}
        aria-valuemax={23}
        aria-valuenow={hour}
        aria-valuetext={`${fmtHour(hour)}, ${values[hour]}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
        className="relative flex cursor-pointer touch-none items-end gap-[2px] rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-brand"
        style={{ height }}
      >
        {values.map((v, h) => (
          <div key={h} className="relative flex h-full flex-1 flex-col justify-end rounded-[3px]">
            {rush && rush[h] > 0.45 && <div aria-hidden className="absolute inset-0 rounded-[3px] bg-[repeating-linear-gradient(135deg,#e6e9e2_0_3px,transparent_3px_6px)]" />}
            <div
              className={cn("relative rounded-[3px] transition-[height] duration-300", h === hour && "outline-2 outline-offset-1 outline-ink")}
              style={{ height: `${Math.max(12, v * 0.95)}%`, backgroundColor: scoreColor(v) }}
            />
          </div>
        ))}
        {nowHour != null && (
          <span aria-hidden className="pointer-events-none absolute -bottom-1 top-0 w-px bg-ink/50" style={{ left: `${((nowHour + 0.5) / 24) * 100}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[10px] font-bold text-mute">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
