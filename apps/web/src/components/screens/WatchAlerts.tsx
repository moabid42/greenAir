"use client";

import { useState, type ReactNode } from "react";
import { BellRing, Check } from "lucide-react";
import DayDial from "@/components/ui/DayDial";
import Toggle from "@/components/ui/Toggle";
import { cn } from "@/lib/cn";
import type { WatchSource } from "@/lib/prefs";
import { askNotifications, notifyNow } from "@/lib/reminders";
import { fmtHour, SHORT_VERDICT, verdict } from "@/lib/score";
import { useApp } from "@/state/app";

const SOURCES: { value: WatchSource; label: string }[] = [
  { value: "apple", label: "Apple Health" },
  { value: "healthconnect", label: "Health Connect" },
  { value: "garmin", label: "Garmin" },
  { value: "strava", label: "Strava" },
];

const range = (s: number, e: number) => `${String(s).padStart(2, "0")}–${String(e).padStart(2, "0")}`;

function Watch({ children, caption, sub, glow }: { children: ReactNode; caption: string; sub: string; glow?: boolean }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className={cn("h-[148px] w-[108px] rounded-[34px] bg-[#dde3da] p-[7px] shadow-[inset_0_0_0_1px_rgb(22_44_41/0.06)]", glow && "shadow-[0_0_24px_rgb(238_122_53/0.35),inset_0_0_0_1px_rgb(22_44_41/0.06)]")}>
        <div className="relative grid h-full w-full place-items-center overflow-hidden rounded-[28px] bg-white">{children}</div>
      </div>
      <figcaption className="flex flex-col items-center leading-tight">
        <span className="text-[13px] font-extrabold">{caption}</span>
        <span className="text-[11px] font-semibold text-mute">{sub}</span>
      </figcaption>
    </figure>
  );
}

/** What your watch does: faces, alerts and workout sources. The faces show your real data right now. Lives on the Devices page. */
export default function WatchAlerts() {
  const { day, hour, nowHour, focusScores, windows, bestSpot, prefs, update, addReminder, showToast, today, date } = useApp();
  const [buzzing, setBuzzing] = useState(false);
  const best = windows[0];
  const h = nowHour ?? hour;
  const score = focusScores[h] ?? 0;
  const place = bestSpot?.place ?? "Heilbronn";

  const buzz = async () => {
    setBuzzing(true);
    const st = await askNotifications();
    if (st !== "granted") {
      setBuzzing(false);
      return showToast(st === "denied" ? "Notifications are blocked. Allow them in your browser settings." : "This browser can't show notifications.");
    }
    const ok = await notifyNow(best ? "Good window now" : "EcoMAB", best ? `${place} · ${range(best.start, best.end)} · score ${best.score}` : "Test notification");
    setBuzzing(false);
    showToast(ok ? "Sent! It should appear on your watch too." : "Couldn't show the notification.");
  };

  const toggleNudge = async (on: boolean) => {
    update({ watchNudge: on });
    if (!on || !best || date !== today) return;
    const at = new Date();
    at.setHours(best.start, 0, 0, 0);
    at.setMinutes(at.getMinutes() - 15);
    if (at.getTime() > Date.now()) await addReminder(at, "Your window opens in 15 min", `${place} · ${range(best.start, best.end)} · score ${best.score}`);
  };

  return (
    <>
      <section aria-label="What your watch shows" className="mx-3 grid grid-cols-3 gap-1 rounded-[28px] bg-white px-2 pb-3 pt-3.5 shadow-sm">
        <Watch caption="Glance" sub="your day, live">
          {day ? (
            <DayDial scores={focusScores} size={78} hour={h} window={best} label="Watch face preview">
              <span className="font-display text-[19px] font-extrabold leading-none">{score}</span>
              <span className="text-[7px] font-extrabold tracking-wider text-brand">{SHORT_VERDICT[verdict(score)]}</span>
            </DayDial>
          ) : (
            <span className="text-xs text-mute">…</span>
          )}
        </Watch>
        <Watch caption="Nudge" sub="15 min before">
          <div className="flex h-full w-full flex-col gap-1 px-3 pb-3 pt-4">
            <span className="text-[7px] font-extrabold tracking-widest text-brand">IN 15 MIN</span>
            <span className="font-display text-[11px] font-extrabold leading-tight">Window opens</span>
            <span className="font-display text-[15px] font-extrabold leading-none">{best ? range(best.start, best.end) : "–"}</span>
            <span className="mt-auto grid h-6 place-items-center rounded-full bg-lime text-[10px] font-extrabold">Start</span>
          </div>
        </Watch>
        <Watch caption="Mid-run" sub="example" glow>
          <div className="flex h-full w-full flex-col gap-1.5 px-3 pb-3 pt-4">
            <div className="flex justify-between font-display text-[9px] font-bold">
              <span>2.4 km</span>
              <span className="text-mute">5:42</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-xl bg-bad-soft px-2 py-1.5">
              <span className="text-[6.5px] font-extrabold tracking-widest text-[#9a3a12]">AIR AHEAD</span>
              <span className="text-[9px] font-extrabold leading-tight">Rush hour ahead</span>
            </div>
            <span className="mt-auto text-center font-display text-sm font-extrabold">♥ 152</span>
          </div>
        </Watch>
      </section>

      <section aria-labelledby="alerts" className="mx-3 mt-4">
        <h2 id="alerts" className="mb-1.5 px-1 text-[11px] font-extrabold tracking-[0.12em] text-mute">YOUR WATCH WILL</h2>
        <div className="divide-y divide-wash overflow-hidden rounded-[20px] bg-white shadow-sm">
          <Toggle checked={prefs.watchNudge} onChange={toggleNudge} title="Nudge me 15 min before a good window" hint="Sends a notification for today's best time" />
          <Toggle checked={prefs.watchAirBuzz} onChange={(v) => update({ watchAirBuzz: v })} title="Buzz if the air ahead gets bad" hint="Needs the native app while you run" />
          <Toggle checked={prefs.watchFace} onChange={(v) => update({ watchFace: v })} title="Show today's score on my watch face" hint="Needs the native app" />
        </div>
        <button type="button" onClick={buzz} disabled={buzzing} className="mt-2.5 flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-extrabold text-lime disabled:opacity-60">
          <BellRing className="size-[18px]" aria-hidden />
          {buzzing ? "Sending…" : "Send a test buzz to my watch"}
        </button>
        <p className="mt-1.5 px-1 text-[11px] font-semibold text-mute">Phones mirror notifications to a paired watch, so reminders already arrive on your wrist.</p>
      </section>

      <section aria-labelledby="sync" className="mx-3 mt-4">
        <h2 id="sync" className="mb-1.5 px-1 text-[11px] font-extrabold tracking-[0.12em] text-mute">SYNC WORKOUTS FROM</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {SOURCES.map((s) => {
            const on = prefs.watchSource === s.value;
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  update({ watchSource: on ? null : s.value });
                  if (!on) showToast(`${s.label} saved. Syncing workouts arrives with the native app.`);
                }}
                className={cn("flex h-11 items-center justify-center gap-1.5 rounded-[14px] text-[13px]", on ? "bg-ink font-extrabold text-white" : "border border-line bg-white font-bold")}
              >
                {on && <Check className="size-3.5 text-lime" aria-hidden />}
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 rounded-[18px] border border-dashed border-line px-3.5 py-3 text-xs font-semibold text-mute">
          No workouts yet. Reading your watch’s workouts and heart rate needs the native app; once it’s connected, each run will show here with the conditions you had.
        </div>
        {day && <p className="mt-2 px-1 text-[11px] font-semibold text-mute">Faces above use today’s data for {prefs.home?.label ?? "Heilbronn"} at {fmtHour(h)}.</p>}
      </section>
    </>
  );
}
