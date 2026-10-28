"use client";

import { useMemo } from "react";
import { ArrowRight, Bookmark, ChevronLeft, Watch } from "lucide-react";
import DayDial from "@/components/ui/DayDial";
import { FACTOR_NAME } from "@/lib/format";
import type { Factor } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { distKm } from "@/lib/geo";
import { centroid, fmtKm } from "@/lib/rank";
import { directionsUrl } from "@/lib/reminders";
import { bestWindows, cellFactors, cellScore, fmtHour, maskPast, scoreColor, VERDICT_TEXT, verdict } from "@/lib/score";
import { useApp } from "@/state/app";

const SPEED_KMH = { run: 10, ride: 16, walk: 5 } as const;
const VERB = { run: "jog", ride: "ride", walk: "walk" } as const;

const range = (s: number, e: number) => `${String(s).padStart(2, "0")}–${String(e).padStart(2, "0")}`;

/** A place, up close: how good it is hour by hour, why, and what to do about it. */
export default function PlaceScreen() {
  const { placeCell, closePlace, day, hour, setHour, nowHour, activity, tune, home, prefs, date, toggleSaved, addReminder, showToast } = useApp();

  const cell = placeCell;
  const scores = useMemo(() => (cell ? Array.from({ length: 24 }, (_, h) => cellScore(cell.properties, h, activity, tune)) : []), [cell, activity, tune]);
  const windows = useMemo(() => bestWindows(maskPast(scores, nowHour)), [scores, nowHour]);

  if (!cell || !day) return null;
  const p = cell.properties;
  const at = centroid(cell);
  const best = windows[0];
  const second = windows[1];
  const factors = cellFactors(p, hour);
  const city = day.hours[hour];
  const dist = home ? distKm(home, at) : null;
  const saved = prefs.saved.some((s) => s.id === p.id);

  const rows: { f: Factor | "green"; raw: string; v: number | null }[] = [
    { f: "heat", raw: `${Math.round(city.tempC)} °C`, v: factors.heat },
    { f: "air", raw: `PM2.5 ${Math.round(city.pm25)} · NO₂ ${Math.round(city.no2)}`, v: factors.air },
    { f: "wind", raw: `${Math.round(city.windKmh)} km/h`, v: factors.wind },
    { f: "traffic", raw: city.rush > 0.45 ? "Rush hour" : "Quiet", v: factors.traffic },
    activity === "ride" ? { f: "safety", raw: "measured", v: factors.safety } : { f: "light", raw: city.daylight > 0.9 ? "Daylight" : city.daylight > 0.1 ? "Twilight" : "Dark", v: factors.light },
    { f: "green", raw: `${Math.round(p.green * 100)}%`, v: Math.round(p.green * 100) },
  ];

  const remind = () => {
    if (!best) return showToast("Nothing good is left today. Try tomorrow.");
    if (nowHour != null && best.start <= nowHour) return showToast("Your window is open right now. Go and enjoy it!");
    const [y, m, d] = date.split("-").map(Number);
    const when = new Date(y, m - 1, d, best.start, 0);
    when.setMinutes(when.getMinutes() - 15);
    void addReminder(when, `Your window opens in 15 min`, `${p.place} · ${range(best.start, best.end)} · score ${best.score}`);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <header className="top-safe absolute inset-x-3 flex justify-between">
        <button type="button" onClick={closePlace} aria-label="Back" className="pointer-events-auto grid size-[46px] place-items-center rounded-full bg-white/97 shadow-[0_4px_16px_rgb(22_44_41/0.18)]">
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            toggleSaved({ id: p.id, name: p.place, lngLat: at });
            showToast(saved ? "Removed from saved places." : `${p.place} saved. Find it under Me.`);
          }}
          aria-label={saved ? "Remove from saved places" : "Save this place"}
          aria-pressed={saved}
          className="pointer-events-auto grid size-[46px] place-items-center rounded-full bg-white/97 shadow-[0_4px_16px_rgb(22_44_41/0.18)]"
        >
          <Bookmark className={cn("size-5", saved && "fill-ink")} aria-hidden />
        </button>
      </header>

      <section aria-label={p.place} className="above-nav pointer-events-auto absolute inset-x-3 flex flex-col gap-3 rounded-[28px] bg-white/97 p-3.5 shadow-[0_10px_40px_rgb(22_44_41/0.24)]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 break-words font-display text-lg font-extrabold leading-tight">{p.place}</h1>
            <p className="text-xs font-semibold text-mute">
              {dist != null ? `${fmtKm(dist)} from you · ${Math.max(1, Math.round((dist / SPEED_KMH[activity]) * 60))} min ${VERB[activity]}` : "Tap the ring to try any hour"}
            </p>
          </div>
          <span className="shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ backgroundColor: scoreColor(scores[hour]), color: scores[hour] >= 60 ? "#162c29" : "#fff" }}>
            {VERDICT_TEXT[verdict(scores[hour])]}
          </span>
        </div>

        <div className="flex items-center gap-3.5">
          <DayDial scores={scores} size={92} hour={hour} nowHour={nowHour} window={best} onPick={setHour} label={`${p.place}, your day. Drag around the ring to choose the hour.`}>
            <span className="font-display text-xl font-extrabold leading-none">{scores[hour]}</span>
            <span className="mt-0.5 text-[8px] font-extrabold tracking-wider text-mute">{hour === nowHour ? "NOW" : fmtHour(hour)}</span>
          </DayDial>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-brand">BEST HERE</span>
            <span className="font-display text-[32px] font-extrabold leading-none tracking-tight">{best ? range(best.start, best.end) : "–"}</span>
            <span className="text-xs font-bold text-mute">{second ? `also good ${range(second.start, second.end)}` : "Drag the ring to see any hour"}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
          {rows.map((r) => (
            <div key={r.f} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-extrabold">{r.f === "green" ? "Green" : FACTOR_NAME[r.f]}</span>
                <span className="text-[11px] font-bold text-mute">{r.raw}</span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-wash">
                <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${r.v ?? 0}%`, backgroundColor: scoreColor(r.v ?? 0) }} />
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <a
            href={directionsUrl(at, activity)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-extrabold text-lime"
          >
            Take me there
            <ArrowRight className="size-[17px]" aria-hidden />
          </a>
          <button type="button" onClick={remind} aria-label="Remind me before the best window, on my watch too" className="grid size-[50px] place-items-center rounded-2xl bg-wash">
            <Watch className="size-[21px]" aria-hidden />
          </button>
        </div>
      </section>
    </div>
  );
}
