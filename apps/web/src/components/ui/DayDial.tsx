"use client";

import { displayNumber } from "@/lib/format";

import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { TimeWindow } from "@/lib/api/types";
import { hourFromPointer, ringGradient, windowGradient } from "@/lib/dial";
import { fmtHour } from "@/lib/score";

interface DayDialProps {
  /** 24 hourly scores, drawn as the coloured ring. */
  scores: number[];
  size: number;
  /** Selected hour (dark dot). */
  hour: number;
  /** The current hour when looking at today (small white dot). */
  nowHour?: number | null;
  /** Best window, drawn as a dark arc around the outside. */
  window?: TimeWindow;
  /** When given, the dial is a control: tap or drag around the ring to choose the hour. */
  onPick?: (hour: number) => void;
  label: string;
  children?: ReactNode;
}

/** The signature visual: your whole day as a ring. Green hours are good hours. */
export default function DayDial({ scores, size, hour, nowHour, window: best, onPick, label, children }: DayDialProps) {
  const ring = Math.round(size * 0.06);
  const arc = Math.round(size * 0.036);
  const hole = Math.round(size * 0.25);
  const dot = Math.max(10, Math.round(size * 0.14));

  const pick = (e: PointerEvent<HTMLDivElement>) => onPick?.(hourFromPointer(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent) => {
    if (!onPick) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onPick((hour + 1) % 24);
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") onPick((hour + 23) % 24);
  };

  const interactive = Boolean(onPick);
  return (
    <div
      role={interactive ? "slider" : "img"}
      aria-label={label}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 23 : undefined}
      aria-valuenow={interactive ? hour : undefined}
      aria-valuetext={interactive ? `${fmtHour(hour)}, score ${displayNumber(scores[hour])}` : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (interactive && e.buttons) pick(e);
      }}
      className="relative shrink-0 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
      style={{ width: size, height: size, touchAction: interactive ? "none" : undefined, cursor: interactive ? "pointer" : undefined }}
    >
      {best && <div aria-hidden className="absolute inset-0 rounded-full" style={{ background: windowGradient(best.start, best.end) }} />}
      <div aria-hidden className="absolute rounded-full bg-white" style={{ inset: arc }} />
      <div aria-hidden className="absolute rounded-full" style={{ inset: ring, background: ringGradient(scores) }} />
      <div aria-hidden className="absolute rounded-full bg-white" style={{ inset: hole }} />
      <div aria-hidden className="absolute inset-0 transition-transform duration-200" style={{ transform: `rotate(${hour * 15 + 7.5}deg)` }}>
        <span
          className="absolute rounded-full border-[2.5px] border-white bg-ink"
          style={{ width: dot, height: dot, left: size / 2 - dot / 2, top: ring / 2 - dot / 2 + 1, boxShadow: "0 1px 4px rgb(0 0 0 / .3)" }}
        />
      </div>
      {nowHour != null && nowHour !== hour && (
        <div aria-hidden className="absolute inset-0" style={{ transform: `rotate(${nowHour * 15 + 7.5}deg)` }}>
          <span
            className="absolute rounded-full border-2 border-ink bg-white"
            style={{ width: dot * 0.6, height: dot * 0.6, left: size / 2 - (dot * 0.6) / 2, top: ring / 2 - (dot * 0.6) / 2 + 1 }}
          />
        </div>
      )}
      <div className="absolute flex flex-col items-center justify-center text-center" style={{ inset: hole }}>
        {children}
      </div>
    </div>
  );
}
