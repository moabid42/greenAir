"use client";

import { displayNumber, finiteValues } from "@/lib/format";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import DayDial from "@/components/ui/DayDial";
import { getDay } from "@/lib/api/client";
import type { DayForecast } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { shortDate } from "@/lib/format";
import { bestWindows, hourScore, maskPast, scoreColor } from "@/lib/score";
import { shiftDate, useApp } from "@/state/app";

/** A real hot summer day from the project's data, handy for showing how the app reacts to heat. */
const HOT_DAY = "2026-06-20";

/** Pick a day: quick choices plus a 7-day outlook with the best window of each day. */
export default function WeekSheet() {
  const { sheet, closeSheet, today, date, setDate, activity, tune } = useApp();
  const [days, setDays] = useState<DayForecast[] | null>(null);
  const open = sheet === "week";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all(Array.from({ length: 7 }, (_, i) => getDay(shiftDate(today, i)).catch(() => null))).then((r) => {
      if (!cancelled) setDays(r.filter((d): d is DayForecast => d != null));
    });
    return () => {
      cancelled = true;
    };
  }, [open, today]);

  const rows = useMemo(
    () =>
      (days ?? []).map((d) => {
        const scores = d.hours.map((h) => hourScore(h, activity, tune));
        const upcoming = bestWindows(maskPast(scores, d.date === today ? new Date().getHours() : null))[0];
        const best = upcoming ?? bestWindows(scores)[0];
        const temps = finiteValues(d.hours.map((h) => h.tempC));
        return { date: d.date, scores, best, max: temps.length ? displayNumber(Math.max(...temps)) : "—", min: temps.length ? displayNumber(Math.min(...temps)) : "—" };
      }),
    [days, activity, tune, today],
  );
  const topScore = rows.length ? Math.max(...rows.map((r) => (r.best?.score ?? Number.NaN))) : 0;

  const pick = (d: string) => {
    setDate(d);
    closeSheet();
  };

  return (
    <Sheet open={open} onClose={closeSheet} title="Pick a day">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {[
            { d: today, label: "Today" },
            { d: shiftDate(today, 1), label: "Tomorrow" },
            { d: HOT_DAY, label: "Hot day · 20 Jun" },
          ].map((o) => (
            <button
              key={o.d}
              type="button"
              aria-pressed={date === o.d}
              onClick={() => pick(o.d)}
              className={cn("h-10 rounded-full border px-4 text-[13px] font-bold", date === o.d ? "border-ink bg-ink text-white" : "border-line")}
            >
              {o.label}
            </button>
          ))}
          <input
            type="date"
            aria-label="Pick another date"
            value={date}
            onChange={(e) => e.target.value && pick(e.target.value)}
            className="h-10 rounded-full border border-line px-3 text-[13px] font-semibold"
          />
        </div>

        <div>
          <p className="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-mute">THE NEXT 7 DAYS · BEST WINDOW FOR YOUR SPORT</p>
          {!days ? (
            <p className="flex items-center gap-2 py-6 text-sm text-mute">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the forecast…
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map((r) => {
                const on = r.date === date;
                const star = (r.best?.score ?? Number.NaN) === topScore && rows.length > 1;
                return (
                  <li key={r.date}>
                    <button
                      type="button"
                      onClick={() => pick(r.date)}
                      aria-current={on ? "date" : undefined}
                      className={cn("flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left", on ? "border-ink bg-wash" : "border-line")}
                    >
                      <DayDial scores={r.scores} size={46} hour={r.best?.start ?? 0} window={r.best} label={`${shortDate(r.date)} overview`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-extrabold">
                          {r.date === today ? "Today" : shortDate(r.date)}
                          {star && <span className="ml-1.5 rounded-full bg-lime px-2 py-0.5 text-[10px] font-extrabold">BEST DAY</span>}
                        </span>
                        <span className="block text-xs font-semibold text-mute">
                          {r.best ? `${String(r.best.start).padStart(2,"0")}–${String(r.best.end).padStart(2,"0")}` : "No recommendation"} · {r.min}° to {r.max}°
                        </span>
                      </span>
                      <span className="grid size-11 place-items-center rounded-xl font-display text-sm font-extrabold" style={{ backgroundColor: scoreColor((r.best?.score ?? Number.NaN)), color: (r.best?.score ?? Number.NaN) >= 60 ? "#162c29" : "#fff" }}>
                        {displayNumber(r.best?.score)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
