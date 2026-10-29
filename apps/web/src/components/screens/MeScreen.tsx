"use client";

import { useState, type ReactNode } from "react";
import { Bell, Bookmark, ChevronRight, Trash2, X } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import { cn } from "@/lib/cn";
import { nearestCell } from "@/lib/rank";
import { askNotifications, notifyState } from "@/lib/reminders";
import { useApp } from "@/state/app";
import { ActivityPill } from "@/components/ui/ActivityPicker";

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mx-3 mt-4">
      <h2 id={id} className="mb-1.5 px-1 text-[11px] font-extrabold tracking-[0.12em] text-mute">
        {title}
      </h2>
      <div className="divide-y divide-wash overflow-hidden rounded-[20px] bg-white shadow-sm">{children}</div>
    </section>
  );
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** You: your preferences (which change the scores), saved places, reminders, data and privacy. */
export default function MeScreen() {
  const { prefs, update, activity, setActivity, openSheet, setTab, openPlace, grid, toggleSaved, removeReminder, resetAll, day, showToast } = useApp();
  const [notif, setNotif] = useState(() => notifyState());
  const [confirmReset, setConfirmReset] = useState(false);

  const open = (lngLat: [number, number]) => {
    const near = grid ? nearestCell(grid, lngLat) : null;
    if (!near) return showToast("Still loading the data. Try again in a moment.");
    setTab("today");
    openPlace(near.cell.properties.id);
  };

  const enableNotifications = async () => setNotif(await askNotifications());

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto overscroll-contain bg-ground pb-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.5rem)]" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <header className="flex items-center gap-3.5 px-4 pb-1">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-lime font-display text-lg font-extrabold">
          {(prefs.name.trim()[0] ?? "S").toUpperCase()}
        </span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Your name</span>
          <input
            value={prefs.name}
            onChange={(e) => update({ name: e.target.value.slice(0, 24) })}
            placeholder="Your name"
            className="w-full bg-transparent font-display text-xl font-extrabold outline-none placeholder:text-mute/60"
          />
          <span className="block text-[13px] font-semibold text-mute">{{ run: "Runner", ride: "Cyclist", walk: "Walker" }[activity]} · Heilbronn</span>
        </label>
      </header>

      <div className="mx-3 mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[20px] bg-lime px-4 py-3">
          <span className="font-display text-[26px] font-extrabold leading-none">{prefs.saved.length}</span>
          <span className="block text-xs font-bold">{prefs.saved.length === 1 ? "saved place" : "saved places"}</span>
        </div>
        <div className="rounded-[20px] bg-white px-4 py-3 shadow-sm">
          <span className="font-display text-[26px] font-extrabold leading-none">{prefs.reminders.length}</span>
          <span className="block text-xs font-bold text-mute">{prefs.reminders.length === 1 ? "reminder set" : "reminders set"}</span>
        </div>
      </div>

      <Group id="prefs" title="YOUR PREFERENCES">
        <div className="flex min-h-[54px] items-center gap-3 px-4 py-2">
          <span className="flex-1 text-[13px] font-bold">Main sport</span>
          <ActivityPill value={activity} onChange={setActivity} />
        </div>
        <button type="button" onClick={() => openSheet("location")} className="flex min-h-[54px] w-full items-center gap-3 px-4 py-2 text-left">
          <span className="flex-1 text-[13px] font-bold">Start point</span>
          <span className="max-w-[55%] truncate text-[13px] font-semibold text-mute">{prefs.home ? `${prefs.home.label} · ${prefs.radiusKm ? `${prefs.radiusKm} km` : "anywhere"}` : "Not set"}</span>
          <ChevronRight className="size-4 text-mute" aria-hidden />
        </button>
        <Toggle checked={prefs.airSensitive} onChange={(v) => update({ airSensitive: v })} title="Sensitive to air quality" hint="Counts air more in every score, e.g. for asthma" />
        <Toggle checked={prefs.heatSensitive} onChange={(v) => update({ heatSensitive: v })} title="Sensitive to heat" hint="Counts heat more in every score" />
      </Group>

      <Group id="saved" title="SAVED PLACES">
        {prefs.saved.length === 0 ? (
          <p className="flex items-center gap-2.5 px-4 py-3.5 text-[13px] font-semibold text-mute">
            <Bookmark className="size-4 shrink-0" aria-hidden /> Tap the bookmark on any place to keep it here.
          </p>
        ) : (
          prefs.saved.map((s) => (
            <div key={s.id} className="flex min-h-[54px] items-center">
              <button type="button" onClick={() => open(s.lngLat)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left">
                <Bookmark className="size-4 shrink-0 fill-ink" aria-hidden />
                <span className="truncate text-[13px] font-bold">{s.name}</span>
              </button>
              <button type="button" onClick={() => toggleSaved(s)} aria-label={`Remove ${s.name}`} className="grid size-12 place-items-center text-mute">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))
        )}
      </Group>

      <Group id="reminders" title="REMINDERS">
        {prefs.reminders.length === 0 ? (
          <p className="flex items-center gap-2.5 px-4 py-3.5 text-[13px] font-semibold text-mute">
            <Bell className="size-4 shrink-0" aria-hidden /> Set one from a place or from Coach.
          </p>
        ) : (
          prefs.reminders.map((r) => (
            <div key={r.id} className="flex min-h-[54px] items-center">
              <div className="min-w-0 flex-1 px-4 py-2">
                <span className="block text-[13px] font-extrabold">{fmtWhen(r.at)}</span>
                <span className="block truncate text-xs font-semibold text-mute">{r.body}</span>
              </div>
              <button type="button" onClick={() => removeReminder(r.id)} aria-label="Delete reminder" className="grid size-12 place-items-center text-mute">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))
        )}
        <div className="flex min-h-[54px] items-center gap-3 px-4 py-2">
          <span className="flex-1">
            <span className="block text-[13px] font-bold">Notifications</span>
            <span className="block text-xs text-mute">
              {notif === "granted" ? "On. Your watch mirrors them." : notif === "denied" ? "Blocked in your browser settings." : notif === "unsupported" ? "Not supported here." : "Off"}
            </span>
          </span>
          {notif === "default" && (
            <button type="button" onClick={enableNotifications} className="h-10 rounded-full bg-ink px-4 text-xs font-extrabold text-lime">
              Turn on
            </button>
          )}
        </div>
      </Group>

      <Group id="about" title="DATA & PRIVACY">
        <div className="px-4 py-3 text-xs font-semibold leading-relaxed text-mute">
          <p>
            Today’s data:{" "}
            <b className="text-ink">{day ? { mixed: "Mixed sources", unavailable: "Unavailable", forecast: "live forecast (Open-Meteo)", measured: "measured", mock: "simulated (explicit demo mode)" }[day.source] : "loading…"}</b>.
          </p>
          <p className="mt-1.5">Sources: senseBox:home &amp; senseBox:bike (atrai.bike) · LUBW NO₂ · Open-Meteo · OpenStreetMap, OpenFreeMap, Mapzen terrain · Green City Heilbronn.</p>
          <p className="mt-1.5">Rush hours 7–9 and 16–18 are an approximate German-city prior, not a Heilbronn measurement.</p>
        </div>
        <div className="flex items-start gap-3 bg-great-soft px-4 py-3">
          <span className="text-[13px] font-extrabold text-[#14653e]">Your location stays on your phone.</span>
          <span className="text-xs font-semibold text-[#2e5a43]">Only the street you type is sent to find the address.</span>
        </div>
        <button type="button" onClick={() => update({ onboarded: false })} className="flex min-h-[54px] w-full items-center px-4 text-left text-[13px] font-bold">
          Replay the intro
        </button>
        <button
          type="button"
          onClick={() => (confirmReset ? resetAll() : setConfirmReset(true))}
          className={cn("flex min-h-[54px] w-full items-center px-4 text-left text-[13px] font-extrabold", confirmReset ? "bg-bad-soft text-[#9a3a12]" : "text-[#9a3a12]")}
        >
          {confirmReset ? "Tap again to erase everything on this phone" : "Erase my data"}
        </button>
      </Group>
    </div>
  );
}
