"use client";

import { displayNumber } from "@/lib/format";

import { useMemo } from "react";
import { ArrowRight, ChevronRight, Leaf, Sparkles, Thermometer, Car, Watch } from "lucide-react";
import { ActivityPill } from "@/components/ui/ActivityPicker";
import DayDial from "@/components/ui/DayDial";
import { airWord, dayWord, tempWord, TONE_CLASS, toneOf, trafficInfo } from "@/lib/format";
import { fmtKm } from "@/lib/rank";
import { cellFactors, scoreColor, SHORT_VERDICT, verdict, fmtHour } from "@/lib/score";
import { shiftDate, useApp } from "@/state/app";
import { BikeChips, LensChips, LocationPill, Stat } from "./parts";
import SourceNotice from "./SourceNotice";
import RideCard from "./RideCard";

const range = (start: number, end: number) => `${String(start).padStart(2, "0")}–${String(end).padStart(2, "0")}`;

/** Home: the map comes first. A floating card answers "when, where, how good". */
export default function TodayScreen() {
  const app = useApp();
  const { error, day, hour, setHour, setDate, nowHour, focusScores, windows, bestSpot, activity, homeCell, date, today, setTab, openPlace, openSheet, showToast, setActivity } = app;
  const riding = activity === "ride";
  const best = windows[0];

  const factors = useMemo(() => {
    if (!day) return null;
    return homeCell ? cellFactors(homeCell.properties, hour) : day.hours[hour].factors;
  }, [day, homeCell, hour]);

  const takeMeThere = () => {
    if (!bestSpot || !best) {
      showToast("Nothing within reach yet — try a bigger distance.");
      openSheet("location");
      return;
    }
    setHour(best.start);
    openPlace(bestSpot.cellId);
  };

  const traffic = day ? trafficInfo(day, hour) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <header className="top-safe absolute inset-x-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <LocationPill />
          <div className="pointer-events-auto">
            <ActivityPill value={activity} onChange={setActivity} />
          </div>
        </div>
        {riding ? <BikeChips /> : (
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <LensChips />
            </div>
          </div>
        )}
      </header>

      <div className="above-nav absolute inset-x-3 flex flex-col gap-2">
        <SourceNotice />
        {!riding && (
          <button
            type="button"
            onClick={() => setTab("coach")}
            className="pointer-events-auto flex h-12 items-center gap-2 self-end rounded-full bg-white/97 pl-1.5 pr-4 text-[13px] font-extrabold shadow-[0_8px_24px_rgb(22_44_41/0.22)]"
          >
            <span aria-hidden className="grid size-[38px] place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e6fbf1,#a5e6c8_45%,#14966f)]">
              <Sparkles className="size-[17px]" />
            </span>
            Ask Coach
          </button>
        )}

        {riding ? (
          <RideCard />
        ) : (
          <section aria-label="Best window" className="pointer-events-auto flex flex-col gap-3 rounded-[28px] bg-white/97 p-3.5 shadow-[0_10px_40px_rgb(22_44_41/0.22)]">
            {error && !day ? (
              <div className="space-y-2 py-1">
                <p className="font-bold">No stored conditions for this date</p>
                <button type="button" onClick={() => openSheet("week")} className="rounded-xl bg-ink px-4 py-3 text-sm font-bold text-lime">Choose an available date</button>
              </div>
            ) : day && !best ? (
              <div className="flex flex-col gap-3 py-1">
                <div>
                  <p className="font-display text-lg font-extrabold">No recommendation available</p>
                  <p className="text-sm text-mute">Hours may have passed or required weather and air inputs may be missing.</p>
                </div>
                <button type="button" onClick={() => setDate(shiftDate(date, 1))} className="flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-extrabold text-lime">
                  {date === today ? "See tomorrow" : "Next day"}
                  <ArrowRight className="size-[17px]" aria-hidden />
                </button>
              </div>
            ) : !day || !best ? (
              <div className="flex animate-pulse items-center gap-3.5">
                <div className="size-[88px] rounded-full bg-wash" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 rounded bg-wash" />
                  <div className="h-7 w-32 rounded bg-wash" />
                  <div className="h-3 w-28 rounded bg-wash" />
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3.5">
                  <DayDial scores={focusScores} size={88} hour={hour} nowHour={nowHour} window={best} onPick={setHour} label="Your day. Drag around the ring to choose the hour.">
                    <span className="font-display text-base font-extrabold leading-none">{displayNumber(focusScores[hour])}</span>
                    <span className="mt-0.5 text-[8px] font-extrabold tracking-wider text-mute">{hour === nowHour ? "NOW" : fmtHour(hour)}</span>
                  </DayDial>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <button type="button" onClick={() => openSheet("week")} className="flex items-center gap-0.5 self-start text-[10px] font-extrabold tracking-[0.12em] text-brand">
                      BEST WINDOW {day.status === "stale" ? "FROM STORED DATA" : dayWord(date, today).toUpperCase()}
                      <ChevronRight className="size-3" aria-hidden />
                    </button>
                    <span className="font-display text-[30px] font-extrabold leading-none tracking-tight">{range(best.start, best.end)}</span>
                    <span className="truncate text-[13px] font-extrabold">
                      {bestSpot ? bestSpot.place : "Heilbronn"}
                      {bestSpot?.distanceKm != null && <span className="font-semibold text-mute"> · {fmtKm(bestSpot.distanceKm)}</span>}
                    </span>
                  </div>
                  <div className="flex size-[58px] shrink-0 flex-col items-center justify-center rounded-[18px] text-ink" style={{ backgroundColor: scoreColor(best.score), color: best.score >= 60 ? "#162c29" : "#fff" }}>
                    <span className="font-display text-[22px] font-extrabold leading-none">{best.score}</span>
                    <span className="text-[9px] font-extrabold tracking-wide">{day.status === "stale" ? "STORED" : SHORT_VERDICT[verdict(best.score)]}</span>
                  </div>
                </div>

                {factors && traffic && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <Stat icon={<Thermometer className="size-4" aria-hidden />} value={`${displayNumber(day.hours[hour].tempC)}°`} label={tempWord(day.hours[hour].tempC)} className={TONE_CLASS[toneOf(factors.heat)]} />
                    <Stat icon={<Leaf className="size-4" aria-hidden />} value={airWord(factors.air)} label="Air" className={TONE_CLASS[toneOf(factors.air)]} />
                    <Stat icon={<Car className="size-4" aria-hidden />} value={traffic.title} label={traffic.sub} className={TONE_CLASS[traffic.tone]} />
                  </div>
                )}

                <div className="flex gap-2">
                  <button type="button" onClick={takeMeThere} disabled={!bestSpot} className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-extrabold text-lime">
                    {bestSpot ? "Take me there" : "City-wide conditions only"}
                    <ArrowRight className="size-[17px]" aria-hidden />
                  </button>
                  <button type="button" onClick={() => setTab("devices")} aria-label="Send to my watch" className="grid size-[50px] place-items-center rounded-2xl bg-wash">
                    <Watch className="size-[21px]" aria-hidden />
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
