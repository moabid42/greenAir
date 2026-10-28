"use client";

import { Wordmark } from "@/components/ui/Logo";
import { useState } from "react";
import { ArrowRight, Car, Leaf, Sun, Thermometer, Wind } from "lucide-react";
import { ActivityCards } from "@/components/ui/ActivityPicker";
import DayDial from "@/components/ui/DayDial";
import Toggle from "@/components/ui/Toggle";
import { LocationPanel } from "@/components/sheets/LocationSheet";
import { cn } from "@/lib/cn";
import { askNotifications } from "@/lib/reminders";
import { useApp } from "@/state/app";

const STEPS = ["sport", "where", "you"] as const;
const range = (s: number, e: number) => `${String(s).padStart(2, "0")}–${String(e).padStart(2, "0")}`;

/** First run: three quick questions so the very first screen is already personal. */
export default function Onboarding() {
  const { prefs, update, setActivity, activity, day, focusScores, windows, hour, nowHour, showToast } = useApp();
  const [step, setStep] = useState(0);
  const [notify, setNotify] = useState(false);
  const best = windows[0];
  const last = step === STEPS.length - 1;

  const finish = () => update({ onboarded: true });

  const toggleNotify = async (on: boolean) => {
    if (!on) return setNotify(false);
    const st = await askNotifications();
    if (st === "granted") setNotify(true);
    else showToast(st === "denied" ? "Notifications are blocked in your browser settings." : "This browser can't show notifications.");
  };

  return (
    <div className="absolute inset-0 z-[70] flex flex-col bg-ground" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-[320px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgb(165_230_200/0.7),transparent)]" />

      <div className="relative flex items-center justify-between px-5">
        <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-8 bg-ink" : i < step ? "w-4 bg-ink" : "w-4 bg-line")} />
          ))}
        </div>
        <button type="button" onClick={finish} className="h-10 rounded-full px-3 text-[13px] font-bold text-mute">
          Skip
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-3 pt-3">
        <Wordmark size={34} />
        <div className="flex items-center gap-4">
          {day ? (
            <DayDial scores={focusScores} size={96} hour={nowHour ?? hour} window={best} label="Today at a glance">
              <span className="font-display text-xl font-extrabold leading-none">{focusScores[nowHour ?? hour]}</span>
              <span className="mt-0.5 text-[8px] font-extrabold tracking-wider text-mute">NOW</span>
            </DayDial>
          ) : (
            <div className="size-24 animate-pulse rounded-full bg-wash" />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-extrabold leading-[1.1] tracking-tight">
              {step === 0 && "Move when Heilbronn breathes."}
              {step === 1 && "Where do you start?"}
              {step === 2 && "What matters to you?"}
            </h1>
            {best && step === 0 && <p className="mt-1.5 text-xs font-bold text-brand">Today’s best window: {range(best.start, best.end)}</p>}
          </div>
        </div>

        {step === 0 && (
          <>
            <p className="text-[15px] leading-snug text-mute">Heat, air quality, wind and rush hour in one score, so you know when and where to run, ride or walk.</p>
            <ActivityCards value={activity} onChange={setActivity} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-mute">WHAT SHOULD WE CALL YOU? (OPTIONAL)</span>
              <input
                value={prefs.name}
                onChange={(e) => update({ name: e.target.value.slice(0, 24) })}
                placeholder="Your name"
                className="h-[52px] rounded-2xl border-2 border-line bg-white px-4 text-base font-semibold outline-none focus:border-ink"
              />
            </label>
            <div>
              <p className="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-mute">ONE SCORE FROM</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { icon: Thermometer, label: "Heat" },
                  { icon: Leaf, label: "Air quality" },
                  { icon: Wind, label: "Wind" },
                  { icon: Car, label: "Rush hour" },
                  { icon: Sun, label: "Daylight" },
                ].map(({ icon: Icon, label }) => (
                  <span key={label} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold shadow-sm">
                    <Icon className="size-3.5 text-brand" aria-hidden />
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold text-mute">From real sensors across Heilbronn: weather stations, the city air station and cyclists&apos; measurements.</p>
            </div>
          </>
        )}

        {step === 1 && <LocationPanel />}

        {step === 2 && (
          <>
            <p className="text-[15px] leading-snug text-mute">These change how every score is calculated. You can change them any time under Me.</p>
            <div className="divide-y divide-wash overflow-hidden rounded-[20px] bg-white shadow-sm">
              <Toggle checked={prefs.airSensitive} onChange={(v) => update({ airSensitive: v })} title="I'm sensitive to air quality" hint="e.g. asthma or allergies. Air counts more." />
              <Toggle checked={prefs.heatSensitive} onChange={(v) => update({ heatSensitive: v })} title="I'm sensitive to heat" hint="Heat counts more in every score." />
              <Toggle checked={notify} onChange={toggleNotify} title="Notify me before good windows" hint="Shows up on your watch too." />
            </div>
          </>
        )}
      </div>

      <div className="relative flex gap-2 px-5 pt-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep((s) => s - 1)} className="h-14 rounded-2xl bg-white px-5 text-[15px] font-bold shadow-sm">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (last) {
              update({ onboarded: true, watchNudge: notify });
            } else setStep((s) => s + 1);
          }}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink text-base font-extrabold text-lime"
        >
          {last ? "Show me my day" : step === 1 && !prefs.home ? "Skip for now" : "Continue"}
          <ArrowRight className="size-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}
