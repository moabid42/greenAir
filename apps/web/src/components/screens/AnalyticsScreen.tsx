"use client";

import SourceNotice from "./SourceNotice";

import { displayNumber } from "@/lib/format";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { getDay } from "@/lib/api/client";
import type { DayForecast, HourConditions } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { bestWindows, hourScore, scoreColor, fmtHour } from "@/lib/score";
import type { DemoSample } from "@/lib/wearables/devices";
import { useWearables } from "@/lib/wearables/useWearables";
import { shiftDate, useApp } from "@/state/app";

type Range = "today" | "7" | "30";
const card = "rounded-[20px] bg-white p-4 shadow-sm";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-wash px-3.5 text-[13px] font-bold";
const SOURCE = { measured: "measured", forecast: "modelled", mock: "simulated", mixed: "mixed sources", unavailable: "unavailable" } as const;

const berlin = (t: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", ...o }).format(new Date(t));
const clock = (t: string) => berlin(t, { hour: "2-digit", minute: "2-digit" });
const berlinDate = (t: string) => berlin(t, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
/** The hour of the day a sample falls in, rounded to the nearest hour like a "closest hour within 30 minutes" match. */
const nearestHour = (t: string) => Math.min(23, Math.round(Number(berlin(t, { hour: "2-digit", hourCycle: "h23" })) + Number(berlin(t, { minute: "2-digit" })) / 60));

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn(card, className)}>
      <h3 className="text-[15px] font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

/** Analytics: your environment, your wearable sessions, and what the weather and air were while you moved. */
export default function AnalyticsScreen() {
  const { day, hour, activity, tune, today, focusScores, setTab } = useApp();
  const w = useWearables();
  const [range, setRange] = useState<Range>("today");
  const [session, setSession] = useState("");
  const [week, setWeek] = useState<{ date: string; score: number }[] | null>(null);
  const [sessionDays, setSessionDays] = useState<Record<string, DayForecast>>({});

  const available = w.devices.filter((d) => d.samples.length);
  const picked = available.find((d) => d.id === session) ?? available[0];

  // Real hourly conditions for the day(s) the sample session happened on, to show what the weather and air were.
  const sampleDates = useMemo(() => [...new Set((picked?.samples ?? []).map((s) => berlinDate(s.timestamp)))], [picked]);
  useEffect(() => {
    let cancelled = false;
    for (const d of sampleDates) {
      if (sessionDays[d]) continue;
      getDay(d)
        .then((r) => !cancelled && setSessionDays((m) => ({ ...m, [d]: r })))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [sampleDates, sessionDays]);

  // The 7-day outlook, loaded only when asked for.
  useEffect(() => {
    if (range !== "7" || week) return;
    let cancelled = false;
    Promise.all(Array.from({ length: 7 }, (_, i) => getDay(shiftDate(today, i)).catch(() => null))).then((days) => {
      if (cancelled) return;
      setWeek(
        days
          .filter((d): d is DayForecast => d != null)
          .map((d) => ({ date: d.date, score: bestWindows(d.hours.map((h) => hourScore(h, activity, tune)))[0]?.score ?? Number.NaN })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [range, week, today, activity, tune]);

  const rows = useMemo(
    () => w.readings.filter((x) => (range === "today" ? new Date(x.timestamp_utc).toDateString() === new Date().toDateString() : Date.now() - Date.parse(x.timestamp_utc) < (range === "7" ? 7 : 30) * 86400000)),
    [w.readings, range],
  );
  const last = picked?.samples.at(-1);
  const conditions = day?.hours[hour];

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto overscroll-contain bg-ground pb-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.5rem)]" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <header className="flex items-center justify-between px-4 pb-3">
        <h1 className="font-display text-[22px] font-extrabold">Analytics</h1>
        <span className="rounded-full bg-ok-soft px-3 py-2 text-[11px] font-extrabold text-[#7a5200]">{day ? `${SOURCE[day.source]} conditions` : "Loading"}</span>
      </header>

      <div className="mx-3 flex flex-col gap-2">
        <SourceNotice />
        <div role="radiogroup" aria-label="Time range" className="flex gap-2">
          {(["today", "7", "30"] as Range[]).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={cn("min-h-11 flex-1 rounded-xl text-[13px]", range === r ? "bg-ink font-extrabold text-white" : "bg-white font-bold shadow-sm")}>
              {r === "today" ? "Today" : `${r} days`}
            </button>
          ))}
        </div>

        <Card title={`Environment · ${activity}`}>
          {range === "today" && day ? (
            <>
              <p className="mt-1 text-[13px]">
                Selected {fmtHour(hour)} · score <b>{displayNumber(focusScores[hour])}/100</b>
                {conditions && <span className="text-mute"> · {displayNumber(conditions.tempC)} °C · PM2.5 {displayNumber(conditions.pm25, 1)} µg/m³ · wind {displayNumber(conditions.windKmh)} km/h</span>}
              </p>
              <div className="mt-3 flex h-20 items-end gap-[3px]" role="img" aria-label="Score for each hour of today">
                {focusScores.map((s, h) => (
                  <span key={h} title={`${fmtHour(h)}: ${displayNumber(s)}`} className={cn("min-w-[2px] flex-1 rounded-t-[3px]", h === hour && "outline outline-2 outline-ink")} style={{ height: `${Number.isFinite(s) ? Math.max(3, s) : 3}%`, backgroundColor: scoreColor(s) }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] font-semibold text-mute">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>
              <p className="mt-2 text-[11px] font-semibold text-mute">{day?.source === "mock" ? "Synthetic city conditions" : "City-wide model weather and air; station measurements are separate"} · Europe/Berlin.</p>
            </>
          ) : range === "7" ? (
            week ? (
              <>
                <div className="mt-3 flex h-24 items-end gap-2">
                  {week.map((d) => (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] font-extrabold">{displayNumber(d.score)}</span>
                      <span className="w-full rounded-t-md" style={{ height: `${Number.isFinite(d.score) ? Math.max(4, d.score) : 4}%`, backgroundColor: scoreColor(d.score) }} />
                      <span className="text-[10px] font-semibold text-mute">{berlin(`${d.date}T12:00:00Z`, { weekday: "short" })}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] font-semibold text-mute">Best available window scores · {week.length} of 7 dates have coverage.</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-mute">Loading the week…</p>
            )
          ) : (
            <p className="mt-1 text-sm text-mute">No environmental history for this range.</p>
          )}
        </Card>

        <Card title="Sample sessions">
          {!available.length ? (
            <p className="mt-1 text-sm text-mute">No sample readings recorded yet. Play a simulated session under Devices.</p>
          ) : (
            picked && (
              <>
                <label className="mt-2 block text-xs font-bold text-mute" htmlFor="session">Wearable session</label>
                <select id="session" value={picked.id} onChange={(e) => setSession(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm">
                  {available.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-mute">{picked.connected ? "Simulated playback" : "Disconnected · previously recorded history"} · sample session · Europe/Berlin</p>
                <h4 className="mt-3 text-xs font-extrabold text-mute">HEART RATE · BPM</h4>
                <div className="mt-2 flex h-32 items-stretch gap-2" role="img" aria-label={`Simulated heart rate: ${picked.samples.map((s) => `${clock(s.timestamp)} ${s.heartRateBpm} bpm`).join(", ")}`}>
                  {picked.samples.map((s) => (
                    <div key={s.timestamp} className="flex flex-1 flex-col items-center justify-end gap-1 text-[11px] font-bold">
                      <span>{s.heartRateBpm}</span>
                      <i className="block w-full max-w-8 rounded-t-md bg-[#58b68f]" style={{ height: `${Math.max(2, Math.min(100, s.heartRateBpm / 2))}%` }} />
                      <small className="text-[10px] font-medium text-mute">{clock(s.timestamp)}</small>
                    </div>
                  ))}
                </div>
                {last && (
                  <div className="mt-2 text-[13px] leading-relaxed">
                    <p>Latest {last.heartRateBpm} bpm · {clock(last.timestamp)}</p>
                    {last.sessionStrainDemoIndex != null && <p>Sample strain index {last.sessionStrainDemoIndex}{picked.summary?.recoveryScoreDemo != null ? ` · sample recovery ${picked.summary.recoveryScoreDemo}/100` : " · recovery shows when playback completes"}</p>}
                    {last.cumulativeSteps != null && <p>Steps {last.cumulativeSteps} · distance {last.cumulativeDistanceKm} km</p>}
                  </div>
                )}
                <p className="mt-2 text-[11px] font-semibold text-mute">Simulated device metrics are not medical advice. Separate devices are not combined.</p>
              </>
            )
          )}
        </Card>

        {picked && (
          <Card title="Exercise & environmental context">
            <p className="mt-1 text-[11px] font-semibold text-mute">Real hourly conditions at the closest hour. Not street measurements, and not evidence of cause.</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {picked.samples.map((s: DemoSample) => {
                const h: HourConditions | undefined = sessionDays[berlinDate(s.timestamp)]?.hours[nearestHour(s.timestamp)];
                return (
                  <p key={s.timestamp} className="text-[13px] leading-snug">
                    <b>{clock(s.timestamp)}</b> · {s.heartRateBpm} bpm ·{" "}
                    {h ? <span>{displayNumber(h.tempC)} °C · PM2.5 {displayNumber(h.pm25, 1)} µg/m³ <span className="text-mute">({SOURCE[sessionDays[berlinDate(s.timestamp)].source]})</span></span> : <span className="text-mute">environment loading or unavailable</span>}
                  </p>
                );
              })}
            </div>
          </Card>
        )}

        <Card title="Personal readings · local only">
          {rows.length ? (
            <>
              <p className="mt-1 text-[13px]">{rows.length} recorded samples · Latest <b>{rows.at(-1)!.value} {rows.at(-1)!.unit}</b></p>
              <p className="mt-0.5 text-[11px] font-semibold text-mute">{new Date(rows.at(-1)!.timestamp_utc).toLocaleString()} · BLE observed. Environmental values and your readings are separate; comparing them does not imply cause.</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-mute">No recorded personal readings. Connect a compatible heart-rate sensor and start recording.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={secondary} onClick={() => setTab("devices")}>{rows.length ? "Open Devices" : "Connect a device"}</button>
            <button
              type="button"
              className={secondary}
              onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(w.readings, null, 2)], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = "ecomab-local-readings.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export local readings
            </button>
            <button type="button" className={secondary} onClick={w.clearReadings}>Delete local readings</button>
          </div>
        </Card>

        <Card title="Connected device">
          <p className="mt-1 text-[13px]">
            {w.ble?.connected ? "Connected" : "Not connected"}
            {w.ble?.last ? ` · last sample ${new Date(w.ble.last.timestamp_utc).toLocaleTimeString()}` : ""}
          </p>
          <p className="text-xs text-mute">Sync: local only</p>
          <button type="button" className={cn(secondary, "mt-2")} onClick={() => setTab("devices")}>Open Devices</button>
        </Card>
      </div>
    </div>
  );
}
