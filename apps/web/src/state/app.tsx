"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Activity, DayForecast, GridFeature, GridResponse, Hour, Sensor, TimeWindow } from "@/lib/api/types";
import { getDay, getGrid, getSensors } from "@/lib/api/client";
import type { BikeLayer } from "@/lib/api/atrai";
import { type Lens, lensValue } from "@/lib/lens";
import { clearPrefs, DEFAULT_PREFS, loadPrefs, type Prefs, type Reminder, type SavedPlace, savePrefs } from "@/lib/prefs";
import { MAX_OUTSIDE_KM, type LngLat, nearestCell, rankSpots, type Spot } from "@/lib/rank";
import { berlinHourToUtc, ConsumerClient, PROFILE, type SegmentDetail, type SegmentSnapshot, utcHour } from "@/lib/api/consumer";
import { askNotifications, cancelReminder, scheduleReminder } from "@/lib/reminders";
import { computeRideStats, type RideStats } from "@/lib/ride";
import { bestWindows, cellScore, hourScore, maskPast, type Tune } from "@/lib/score";

export type Tab = "today" | "explore" | "coach" | "analytics" | "devices" | "me";
export type SheetName = "location" | "week" | "ai" | "layers" | "sensor" | "segment" | null;

const consumer = new ConsumerClient();
export type SegmentView = { state: "loading" } | { state: "none" } | { state: "ready"; detail: SegmentDetail };

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

interface AppValue {
  /** Preferences have been read from the phone. Until then we show the splash. */
  ready: boolean;
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
  resetAll: () => void;
  activity: Activity;
  setActivity: (a: Activity) => void;
  tune: Tune;

  tab: Tab;
  setTab: (t: Tab) => void;
  placeId: string | null;
  openPlace: (cellId: string) => void;
  closePlace: () => void;
  sheet: SheetName;
  openSheet: (s: Exclude<SheetName, null>) => void;
  /** Sensor markers on the map can be hidden from the layers sheet. */
  showSensors: boolean;
  setShowSensors: (v: boolean) => void;
  /** The sensor the user tapped on the map, shown in the details sheet. */
  inspected: Sensor | null;
  inspectSensor: (s: Sensor) => void;
  /** Optional backend street scores for the selected sport and hour (off unless a backend URL is configured). */
  segments: SegmentSnapshot | null;
  segmentTileUrl: ((build: string) => string) | null;
  segmentView: SegmentView | null;
  inspectSegment: (lng: number, lat: number) => void;
  closeSheet: () => void;

  today: string;
  date: string;
  setDate: (d: string) => void;
  hour: Hour;
  setHour: (h: Hour) => void;
  /** Current hour when looking at today, otherwise null. */
  nowHour: Hour | null;
  lens: Lens;
  setLens: (l: Lens) => void;
  bikeLayers: BikeLayer[];
  toggleBike: (l: BikeLayer) => void;

  day: DayForecast | null;
  grid: GridResponse | null;
  sensors: Sensor[];
  error: string | null;
  retry: () => void;

  /** The user's start point if it lies inside the area we cover. */
  home: LngLat | null;
  homeCell: GridFeature | null;
  /** Hourly scores for the user's own cell (or the whole city without a location). */
  focusScores: number[];
  windows: TimeWindow[];
  bestSpot: Spot | null;
  /** Value painted on the map per cell for the active lens + hour. */
  values: Record<string, number>;
  cellsById: Map<string, GridFeature>;
  placeCell: GridFeature | null;
  spots: (n: number, hour?: Hour, lens?: Lens) => Spot[];

  /** A one-off "look here" request for the map. Cleared when the screen, place or sport changes. */
  mapFocus: { key: string; center: LngLat; zoom: number } | null;
  focusMap: (center: LngLat, zoom?: number) => void;
  /** Real measured cycling stats inside the user's reach (ride mode only). */
  ride: RideStats | null;

  /** Saves or un-saves a place. */
  toggleSaved: (p: SavedPlace) => void;
  /** Sets a notification for a moment (asks permission the first time). Returns whether it was set. */
  addReminder: (at: Date, title: string, body: string) => Promise<boolean>;
  removeReminder: (id: string) => void;

  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <AppProvider>");
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  const today = useMemo(() => isoDate(new Date()), []);
  const [tab, setTab] = useState<Tab>("today");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [showSensors, setShowSensors] = useState(true);
  const [inspected, setInspected] = useState<Sensor | null>(null);
  const [segments, setSegments] = useState<SegmentSnapshot | null>(null);
  const [segmentView, setSegmentView] = useState<SegmentView | null>(null);
  const [date, setDate] = useState(today);
  const [hour, setHour] = useState<Hour>(() => new Date().getHours());
  const [lens, setLensState] = useState<Lens>("index");
  const [bikeLayers, setBikeLayers] = useState<BikeLayer[]>([]);

  const [day, setDay] = useState<DayForecast | null>(null);
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [mapFocus, setMapFocus] = useState<AppValue["mapFocus"]>(null);
  const [ride, setRide] = useState<RideStats | null>(null);

  // --- preferences: read once on the phone, save on every change ---
  useEffect(() => {
    const p = loadPrefs();
    setPrefs(p);
    p.reminders.forEach(scheduleReminder);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) savePrefs(prefs);
  }, [prefs, ready]);

  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);

  const resetAll = useCallback(() => {
    clearPrefs();
    setPrefs(DEFAULT_PREFS);
    setTab("today");
    setPlaceId(null);
  }, []);

  const activity = prefs.activity;
  const tune = useMemo<Tune>(() => ({ airSensitive: prefs.airSensitive, heatSensitive: prefs.heatSensitive }), [prefs.airSensitive, prefs.heatSensitive]);

  // Riding turns on the measured cycling layers; leaving it turns them off.
  const setActivity = useCallback(
    (a: Activity) => {
      update({ activity: a });
      setBikeLayers(a === "ride" ? ["surface", "danger"] : []);
      setLensState((l) => (a !== "ride" && l === "safety" ? "index" : l));
    },
    [update],
  );

  // Restore the riding layers after a reload while in ride mode.
  useEffect(() => {
    if (ready && prefs.activity === "ride") setBikeLayers((cur) => (cur.length ? cur : ["surface", "danger"]));
  }, [ready, prefs.activity]);

  // --- data: the day's conditions and the grid, whenever the date changes ---
  useEffect(() => {
    let cancelled = false;
    setDay(null);
    setError(null);
    (async () => {
      try {
        const d = await getDay(date);
        const g = await getGrid(date, d);
        if (cancelled) return;
        setDay(d);
        setGrid(g);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  useEffect(() => {
    if (!day) return;
    getSensors(day, hour).then(setSensors).catch(() => setSensors([]));
  }, [day, hour]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // A "look here" request only lasts until the user goes somewhere else.
  useEffect(() => {
    setMapFocus(null);
  }, [tab, placeId, prefs.home, prefs.radiusKm, prefs.activity]);

  const focusMap = useCallback((center: LngLat, zoom = 15.2) => setMapFocus({ key: `focus:${Date.now()}`, center, zoom }), []);

  // --- location ---
  const homeCellInfo = useMemo(() => (grid && prefs.home ? nearestCell(grid, prefs.home.lngLat) : null), [grid, prefs.home]);
  const homeInArea = homeCellInfo != null && homeCellInfo.km <= MAX_OUTSIDE_KM;
  const home: LngLat | null = homeInArea && prefs.home ? prefs.home.lngLat : null;
  const homeCell = homeInArea && homeCellInfo ? homeCellInfo.cell : null;

  const cellsById = useMemo(() => {
    const m = new Map<string, GridFeature>();
    grid?.cells.features.forEach((f) => m.set(f.properties.id, f));
    return m;
  }, [grid]);

  // Cycling stats come from the real senseBox:bike data inside the user's reach.
  useEffect(() => {
    if (!ready || activity !== "ride") return;
    let cancelled = false;
    computeRideStats(home, prefs.radiusKm)
      .then((s) => !cancelled && setRide(s))
      .catch(() => !cancelled && setRide(null));
    return () => {
      cancelled = true;
    };
    // `home` is rebuilt as a new array on every render; its text form is the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activity, home?.join(), prefs.radiusKm]);

  const effectiveLens: Lens = lens === "safety" && activity !== "ride" ? "index" : lens;

  const values = useMemo(() => {
    const out: Record<string, number> = {};
    grid?.cells.features.forEach(({ properties: c }) => {
      out[c.id] = lensValue(c, hour, effectiveLens, activity, tune);
    });
    return out;
  }, [grid, hour, effectiveLens, activity, tune]);

  const focusScores = useMemo(() => {
    if (!day) return Array<number>(24).fill(0);
    if (homeCell) return Array.from({ length: 24 }, (_, h) => cellScore(homeCell.properties, h, activity, tune));
    return day.hours.map((h) => hourScore(h, activity, tune));
  }, [day, homeCell, activity, tune]);

  // Today only looks forward: a window that is already over is not a recommendation.
  const nowH = new Date().getHours();
  const windows = useMemo(() => bestWindows(maskPast(focusScores, date === today ? nowH : null)), [focusScores, date, today, nowH]);

  const spots = useCallback(
    (n: number, atHour: Hour = hour, atLens: Lens = effectiveLens) => {
      if (!grid) return [];
      return rankSpots(grid, atHour, activity, tune, n, home, prefs.radiusKm, (f) => lensValue(f.properties, atHour, atLens, activity, tune));
    },
    [grid, hour, effectiveLens, activity, tune, home, prefs.radiusKm],
  );

  const bestSpot = useMemo<Spot | null>(() => {
    if (!grid || !windows[0]) return null;
    return rankSpots(grid, windows[0].start, activity, tune, 1, home, prefs.radiusKm)[0] ?? null;
  }, [grid, windows, activity, tune, home, prefs.radiusKm]);

  const placeCell = placeId ? cellsById.get(placeId) ?? null : null;

  // --- navigation ---
  const openPlace = useCallback((id: string) => setPlaceId(id), []);
  const closePlace = useCallback(() => setPlaceId(null), []);
  const openSheet = useCallback((s: Exclude<SheetName, null>) => setSheet(s), []);
  const inspectSensor = useCallback((s: Sensor) => {
    setInspected(s);
    setSheet("sensor");
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Optional backend street scores: loaded for the selected sport and hour, only when a backend URL is configured.
  useEffect(() => {
    if (!consumer.configured) return;
    const ac = new AbortController();
    consumer
      .scores(PROFILE[activity], utcHour(berlinHourToUtc(date, hour)), ac.signal)
      .then(setSegments)
      .catch(() => {
        if (!ac.signal.aborted) setSegments(null);
      });
    return () => ac.abort();
  }, [activity, date, hour]);

  const inspectSegment = useCallback(
    async (lng: number, lat: number) => {
      setSegmentView({ state: "loading" });
      setSheet("segment");
      try {
        setSegmentView({ state: "ready", detail: await consumer.score(lat, lng, PROFILE[activity], utcHour(berlinHourToUtc(date, hour))) });
      } catch {
        setSegmentView({ state: "none" });
      }
    },
    [activity, date, hour],
  );

  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    setPlaceId(null);
  }, []);

  const setLens = useCallback((l: Lens) => setLensState(l), []);

  const toggleBike = useCallback((l: BikeLayer) => {
    setBikeLayers((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const toggleSaved = useCallback((p: SavedPlace) => {
    setPrefs((cur) => ({ ...cur, saved: cur.saved.some((s) => s.id === p.id) ? cur.saved.filter((s) => s.id !== p.id) : [...cur.saved, p] }));
  }, []);

  const addReminder = useCallback(
    async (at: Date, title: string, body: string) => {
      if (at.getTime() <= Date.now()) {
        showToast("That time has already passed.");
        return false;
      }
      if (prefs.reminders.some((r) => new Date(r.at).getTime() === at.getTime())) {
        showToast("You already have a reminder for that time.");
        return false;
      }
      const perm = await askNotifications();
      if (perm === "denied" || perm === "unsupported") {
        showToast(perm === "denied" ? "Notifications are blocked. Allow them in your browser settings." : "This browser can't show notifications.");
        return false;
      }
      const r: Reminder = { id: `${Date.now()}`, at: at.toISOString(), title, body };
      setPrefs((cur) => ({ ...cur, reminders: [...cur.reminders, r].sort((a, b) => a.at.localeCompare(b.at)) }));
      scheduleReminder(r);
      showToast(`Reminder set for ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Your watch will buzz too.`);
      return true;
    },
    [showToast, prefs.reminders],
  );

  const removeReminder = useCallback((id: string) => {
    cancelReminder(id);
    setPrefs((cur) => ({ ...cur, reminders: cur.reminders.filter((r) => r.id !== id) }));
  }, []);

  const nowHour = date === today ? new Date().getHours() : null;

  const value: AppValue = {
    ready,
    prefs,
    update,
    resetAll,
    activity,
    setActivity,
    tune,
    tab,
    setTab: changeTab,
    placeId,
    openPlace,
    closePlace,
    sheet,
    openSheet,
    showSensors,
    setShowSensors,
    inspected,
    inspectSensor,
    segments,
    segmentTileUrl: consumer.configured ? (b: string) => consumer.tileUrl(b) : null,
    segmentView,
    inspectSegment,
    closeSheet,
    today,
    date,
    setDate,
    hour,
    setHour,
    nowHour,
    lens: effectiveLens,
    setLens,
    bikeLayers,
    toggleBike,
    day,
    grid,
    sensors,
    error,
    retry,
    home,
    homeCell,
    focusScores,
    windows,
    bestSpot,
    values,
    cellsById,
    placeCell,
    spots,
    mapFocus,
    focusMap,
    ride,
    toggleSaved,
    addReminder,
    removeReminder,
    toast,
    showToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
