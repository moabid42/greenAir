"use client";

import { displayNumber, finiteValues } from "@/lib/format";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Pause, Play, TriangleAlert } from "lucide-react";
import HourBars from "@/components/ui/HourBars";
import { LENSES } from "@/lib/lens";
import { shortDate, tempWord } from "@/lib/format";
import { fmtKm } from "@/lib/rank";
import { fmtHour, hourScore, scoreColor, VERDICT_TEXT, verdict } from "@/lib/score";
import { useApp } from "@/state/app";
import SourceNotice from "./SourceNotice";
import { LensChips } from "./parts";

/** Explore the city on a flat map. Scrub or play through the day and see the best places for the chosen layer. */
export default function ExploreScreen() {
  const { grid, day, hour, setHour, nowHour, lens, activity, tune, openSheet, openPlace, spots, date } = useApp();
  const [playing, setPlaying] = useState(false);

  // Play steps through the day, one hour every 0.7 s.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setHour((hour + 1) % 24), 700);
    return () => clearInterval(t);
  }, [playing, hour, setHour]);

  // The city-wide value of the active layer for every hour.
  const series = useMemo(() => {
    if (!day) return Array<number>(24).fill(Number.NaN);
    return day.hours.map((h) => {
      if (lens === "index") return hourScore(h, activity, tune);
      if ((lens === "safety" || lens === "surface")) return h.factors.safety ?? Number.NaN;
      return h.factors[lens] ?? Number.NaN;
    });
  }, [day, lens, activity, tune]);

  const hot = useMemo(() => {
    if (!day) return null;
    const max = Math.max(...finiteValues(day.hours.map((h) => h.tempC)));
    return max >= 28 ? { max: Math.round(max), at: day.hours.findIndex((h) => h.tempC === max) } : null;
  }, [day]);

  const cond = day?.hours[hour];
  const subtitle = !cond
    ? ""
    : lens === "heat"
      ? `${displayNumber(cond.tempC)} °C · ${tempWord(cond.tempC)}`
      : lens === "air"
        ? `PM2.5 ${displayNumber(cond.pm25)} · NO₂ ${displayNumber(cond.no2)} µg/m³`
        : lens === "traffic"
          ? cond.rush == null ? "No traffic data" : cond.rush > 0.45
            ? "Commuter peak"
            : "Quiet roads"
          : lens === "wind"
            ? `${displayNumber(cond.windKmh)} km/h wind`
            : (lens === "safety" || lens === "surface")
              ? "Surface & overtaking safety"
              : VERDICT_TEXT[verdict(series[hour])];

  const top = spots(3);
  const lensInfo = LENSES.find((l) => l.value === lens);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <header className="top-safe absolute inset-x-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="pointer-events-auto flex h-11 items-center rounded-full bg-white/96 px-4 font-display text-[15px] font-extrabold shadow-[0_4px_16px_rgb(22_44_41/0.16)]">Explore</span>
          <button
            type="button"
            onClick={() => openSheet("week")}
            className="pointer-events-auto flex h-11 items-center gap-2 rounded-full bg-white/96 px-4 text-[13px] font-extrabold shadow-[0_4px_16px_rgb(22_44_41/0.16)]"
          >
            <CalendarDays className="size-4" aria-hidden />
            {shortDate(date)}
          </button>
        </div>
        <LensChips tone="heat" />
        {hot && lens === "heat" && (
          <span className="flex w-fit items-center gap-2 rounded-full bg-bad px-3.5 py-2 text-xs font-extrabold text-white shadow-[0_6px_18px_rgb(217_68_46/0.4)]">
            <TriangleAlert className="size-3.5" aria-hidden />
            Heat alert · up to {hot.max}° at {fmtHour(hot.at)}
          </span>
        )}
      </header>

      <div className="pointer-events-auto absolute inset-x-3 top-[calc(env(safe-area-inset-top)+6.5rem)]"><SourceNotice /></div>
      <section aria-label={`${lensInfo?.label ?? "Layer"} through the day`} className="above-nav pointer-events-auto absolute inset-x-3 flex flex-col gap-2.5 rounded-[28px] bg-white/97 p-3.5 shadow-[0_10px_40px_rgb(22_44_41/0.22)]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play through the day"} className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-lime">
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </button>
          <span className="flex min-w-0 flex-1 flex-col leading-[1.1]">
            <span className="font-display text-[26px] font-extrabold">{fmtHour(hour)}</span>
            <span className="truncate text-xs font-bold text-mute">{subtitle}</span>
          </span>
          <span className="rounded-xl px-2.5 py-1.5 font-display text-sm font-extrabold" style={{ backgroundColor: scoreColor(series[hour]), color: series[hour] >= 60 ? "#162c29" : "#fff" }}>
            {displayNumber(series[hour])}
          </span>
        </div>

        <HourBars values={series} rush={day?.hours.map((h) => h.rush)} hour={hour} nowHour={nowHour} onPick={(h) => { setPlaying(false); setHour(h); }} />

        <div>
          <p className="mb-1.5 text-[10px] font-extrabold tracking-[0.12em] text-mute">BEST FOR {lensInfo?.label.toUpperCase()} AT {fmtHour(hour)}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {top.length === 0 && <p className="col-span-3 py-2 text-xs text-mute">{grid?.status === "unavailable" ? "Verified street rankings are unavailable. The chart shows city-wide conditions." : grid?.source === "mixed" ? "Place rankings require verified spatial confidence. Historical street attributes remain inspectable on the map." : "No places within reach. Try a bigger distance."}</p>}
            {top.map((s) => (
              <button key={s.cellId} type="button" onClick={() => openPlace(s.cellId)} className="flex min-w-0 flex-col rounded-[14px] bg-wash px-2.5 py-2 text-left leading-tight">
                <span className="font-display text-sm font-extrabold" style={{ color: s.score >= 60 ? "#14653e" : "#9a3a12" }}>
                  {s.score}
                </span>
                <span className="truncate text-[11px] font-extrabold">{s.place}</span>
                {s.distanceKm != null && <span className="text-[10px] font-semibold text-mute">{fmtKm(s.distanceKm)}</span>}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
