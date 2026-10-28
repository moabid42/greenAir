"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_ENDPOINTS, DEFAULT_SETTINGS } from "@/lib/defaults";
import { deriveHealth } from "@/lib/health";
import { probeUrl, resolveUrl } from "@/lib/probe";
import { load, MAX_PROBES, parseConfig, save } from "@/lib/storage";
import type { Endpoint, Health, Probe, RangeDays, Redirect, Settings } from "@/lib/types";
import { type EndpointForm, pathFromUrl, slug, validateEndpoint, validateRedirect, validateSettings, type Errors } from "@/lib/validate";

type Tone = "ok" | "error";

interface Counts {
  healthy: number;
  degraded: number;
}

interface AdminValue {
  ready: boolean;
  settings: Settings;
  endpoints: Endpoint[];
  probes: Record<string, Probe[]>;
  checking: ReadonlySet<string>;
  healthOf: (ep: Endpoint) => Health;
  /** Why an endpoint cannot be checked, or null when it can. */
  blockedReason: (ep: Endpoint) => string | null;
  resolved: (ep: Endpoint) => string | null;
  lastRunAt: number | null;
  /** Healthy / degraded counts before the latest round of checks, for "vs. previous check". */
  previousCounts: Counts | null;
  checkOne: (id: string) => Promise<void>;
  checkAll: () => Promise<void>;
  saveSettings: (next: Settings) => Errors<keyof Settings>;
  addEndpoint: (form: EndpointForm) => Errors<keyof EndpointForm>;
  updateEndpoint: (id: string, form: EndpointForm) => Errors<keyof EndpointForm>;
  removeEndpoint: (id: string) => void;
  setRedirect: (id: string, r: Redirect) => Errors<"target">;
  resetEndpoints: () => void;
  clearHistory: () => void;
  exportConfig: () => string;
  importConfig: (text: string) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** On small screens the details open as a sheet instead of a side panel. */
  detailOpen: boolean;
  setDetailOpen: (v: boolean) => void;
  range: RangeDays;
  setRange: (r: RangeDays) => void;
  chartRange: RangeDays;
  setChartRange: (r: RangeDays) => void;
  toast: { msg: string; tone: Tone } | null;
  notify: (msg: string, tone?: Tone) => void;
  persistFailed: boolean;
}

const Ctx = createContext<AdminValue | null>(null);

export function useAdmin(): AdminValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside AdminProvider");
  return v;
}

export default function AdminProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [endpoints, setEndpoints] = useState<Endpoint[]>(DEFAULT_ENDPOINTS);
  const [probes, setProbes] = useState<Record<string, Probe[]>>({});
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [previousCounts, setPreviousCounts] = useState<Counts | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(DEFAULT_ENDPOINTS[0].id);
  const [detailOpen, setDetailOpen] = useState(false);
  const [range, setRange] = useState<RangeDays>(DEFAULT_SETTINGS.defaultRange);
  const [chartRange, setChartRange] = useState<RangeDays>(DEFAULT_SETTINGS.defaultRange);
  const [toast, setToast] = useState<AdminValue["toast"]>(null);
  const [persistFailed, setPersistFailed] = useState(false);

  // The latest values for timers and async callbacks, so they never act on stale state.
  const live = useRef({ settings, endpoints, probes });
  useEffect(() => {
    live.current = { settings, endpoints, probes };
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((msg: string, tone: Tone = "ok") => {
    setToast({ msg, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  // Load what this browser remembers.
  useEffect(() => {
    const p = load();
    setSettings(p.settings);
    setEndpoints(p.endpoints);
    setProbes(p.probes);
    setRange(p.settings.defaultRange);
    setChartRange(p.settings.defaultRange);
    setSelectedId(p.endpoints[0]?.id ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    setPersistFailed(!save({ settings, endpoints, probes }));
  }, [ready, settings, endpoints, probes]);

  const healthOf = useCallback(
    (ep: Endpoint): Health => deriveHealth(probes[ep.id] ?? [], settings, resolveUrl(ep, settings).url != null),
    [probes, settings],
  );
  const blockedReason = useCallback((ep: Endpoint) => {
    const r = resolveUrl(ep, settings);
    return "reason" in r ? r.reason : null;
  }, [settings]);
  const resolved = useCallback((ep: Endpoint) => resolveUrl(ep, settings).url, [settings]);

  const record = useCallback((id: string, p: Probe) => {
    setProbes((m) => ({ ...m, [id]: [...(m[id] ?? []), p].slice(-MAX_PROBES) }));
  }, []);

  const runOne = useCallback(
    async (ep: Endpoint) => {
      const { settings: s } = live.current;
      const r = resolveUrl(ep, s);
      if (!r.url) return;
      setChecking((c) => new Set(c).add(ep.id));
      const p = await probeUrl(r.url, s.timeoutMs);
      record(ep.id, p);
      setChecking((c) => {
        const n = new Set(c);
        n.delete(ep.id);
        return n;
      });
    },
    [record],
  );

  const checkOne = useCallback(
    async (id: string) => {
      const ep = live.current.endpoints.find((e) => e.id === id);
      if (ep) await runOne(ep);
    },
    [runOne],
  );

  const checkAll = useCallback(async () => {
    const { endpoints: eps, settings: s, probes: before } = live.current;
    const count = (m: Record<string, Probe[]>): Counts => {
      let healthy = 0;
      let degraded = 0;
      for (const e of eps) {
        const h = deriveHealth(m[e.id] ?? [], s, resolveUrl(e, s).url != null);
        if (h === "healthy") healthy++;
        if (h === "degraded") degraded++;
      }
      return { healthy, degraded };
    };
    const hadChecks = eps.some((e) => (before[e.id] ?? []).length > 0);
    if (hadChecks) setPreviousCounts(count(before));
    await Promise.all(eps.map(runOne));
    setLastRunAt(Date.now());
  }, [runOne]);

  // First round right after loading, then on the chosen interval (skipped while the tab is hidden).
  const checkAllRef = useRef(checkAll);
  useEffect(() => {
    checkAllRef.current = checkAll;
  }, [checkAll]);
  useEffect(() => {
    if (!ready) return;
    void checkAllRef.current();
  }, [ready]);
  useEffect(() => {
    if (!ready || settings.intervalSec === 0) return;
    const id = setInterval(() => {
      if (!document.hidden) void checkAllRef.current();
    }, settings.intervalSec * 1000);
    return () => clearInterval(id);
  }, [ready, settings.intervalSec]);

  const saveSettings = useCallback(
    (next: Settings) => {
      const errors = validateSettings(next);
      if (Object.keys(errors).length) return errors;
      const clean = { ...next, backendUrl: next.backendUrl.trim().replace(/\/$/, "") };
      const backendChanged = clean.backendUrl !== live.current.settings.backendUrl;
      setSettings(clean);
      live.current.settings = clean;
      notify("Settings saved in this browser.");
      if (backendChanged) void checkAllRef.current();
      return errors;
    },
    [notify],
  );

  const addEndpoint = useCallback(
    (form: EndpointForm) => {
      const errors = validateEndpoint(form, live.current.endpoints);
      if (Object.keys(errors).length) return errors;
      const ep: Endpoint = {
        id: `${slug(form.name)}-${Date.now().toString(36)}`,
        name: form.name.trim(),
        path: form.path.trim() || pathFromUrl(form.url),
        url: form.url.trim(),
        category: form.category,
        origin: "custom",
        note: form.note.trim(),
        redirect: { mode: "off", target: "" },
      };
      setEndpoints((l) => [...l, ep]);
      live.current.endpoints = [...live.current.endpoints, ep];
      setSelectedId(ep.id);
      notify(`Added “${ep.name}”. Checking it now.`);
      void runOne(ep);
      return errors;
    },
    [notify, runOne],
  );

  const updateEndpoint = useCallback(
    (id: string, form: EndpointForm) => {
      const errors = validateEndpoint(form, live.current.endpoints, id);
      if (Object.keys(errors).length) return errors;
      const old = live.current.endpoints.find((e) => e.id === id);
      if (!old) return errors;
      const next: Endpoint = { ...old, name: form.name.trim(), path: form.path.trim() || pathFromUrl(form.url), url: form.url.trim(), category: form.category, note: form.note.trim() };
      setEndpoints((l) => l.map((e) => (e.id === id ? next : e)));
      live.current.endpoints = live.current.endpoints.map((e) => (e.id === id ? next : e));
      if (old.url !== next.url) {
        // The old results describe another address, so they would be misleading.
        setProbes((m) => ({ ...m, [id]: [] }));
        void runOne(next);
      }
      notify(`Saved “${next.name}”.`);
      return errors;
    },
    [notify, runOne],
  );

  const removeEndpoint = useCallback(
    (id: string) => {
      const ep = live.current.endpoints.find((e) => e.id === id);
      const rest = live.current.endpoints.filter((e) => e.id !== id);
      setEndpoints(rest);
      live.current.endpoints = rest;
      setProbes((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
      setSelectedId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur));
      setDetailOpen(false);
      if (ep) notify(`Removed “${ep.name}”.`);
    },
    [notify],
  );

  const setRedirect = useCallback(
    (id: string, r: Redirect) => {
      const ep = live.current.endpoints.find((e) => e.id === id);
      if (!ep) return {};
      const errors = validateRedirect(r, ep.url);
      if (Object.keys(errors).length) return errors;
      const clean: Redirect = r.mode === "off" ? { mode: "off", target: r.target.trim() } : { mode: r.mode, target: r.target.trim() };
      setEndpoints((l) => l.map((e) => (e.id === id ? { ...e, redirect: clean } : e)));
      live.current.endpoints = live.current.endpoints.map((e) => (e.id === id ? { ...e, redirect: clean } : e));
      notify(r.mode === "off" ? "Redirect turned off." : "Redirect saved.");
      return errors;
    },
    [notify],
  );

  const resetEndpoints = useCallback(() => {
    setEndpoints(DEFAULT_ENDPOINTS);
    live.current.endpoints = DEFAULT_ENDPOINTS;
    setProbes({});
    setSelectedId(DEFAULT_ENDPOINTS[0].id);
    notify("Default endpoints restored.");
    void checkAllRef.current();
  }, [notify]);

  const clearHistory = useCallback(() => {
    setProbes({});
    setPreviousCounts(null);
    notify("Check history cleared.");
    void checkAllRef.current();
  }, [notify]);

  const exportConfig = useCallback(
    () => JSON.stringify({ kind: "ecomab-admin-config", version: 1, exportedAt: new Date().toISOString(), settings: live.current.settings, endpoints: live.current.endpoints }, null, 2),
    [],
  );

  const importConfig = useCallback(
    (text: string) => {
      const cfg = parseConfig(text); // throws a readable error
      const errors = validateSettings(cfg.settings);
      if (Object.keys(errors).length) throw new Error("The settings in this file are not valid.");
      setSettings(cfg.settings);
      live.current.settings = cfg.settings;
      setEndpoints(cfg.endpoints);
      live.current.endpoints = cfg.endpoints;
      setProbes({});
      setSelectedId(cfg.endpoints[0]?.id ?? null);
      notify(`Imported ${cfg.endpoints.length} ${cfg.endpoints.length === 1 ? "endpoint" : "endpoints"}.`);
      void checkAllRef.current();
    },
    [notify],
  );

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  const value = useMemo<AdminValue>(
    () => ({
      ready, settings, endpoints, probes, checking, healthOf, blockedReason, resolved, lastRunAt, previousCounts,
      checkOne, checkAll, saveSettings, addEndpoint, updateEndpoint, removeEndpoint, setRedirect, resetEndpoints, clearHistory, exportConfig, importConfig,
      selectedId, select, detailOpen, setDetailOpen, range, setRange, chartRange, setChartRange, toast, notify, persistFailed,
    }),
    [ready, settings, endpoints, probes, checking, healthOf, blockedReason, resolved, lastRunAt, previousCounts, checkOne, checkAll, saveSettings, addEndpoint, updateEndpoint, removeEndpoint, setRedirect, resetEndpoints, clearHistory, exportConfig, importConfig, selectedId, select, detailOpen, range, chartRange, toast, notify, persistFailed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
