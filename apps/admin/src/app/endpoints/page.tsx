"use client";

import { useMemo, useState } from "react";
import { Database, Plus, RefreshCw, Search, SearchX, X } from "lucide-react";
import { useAdmin } from "@/components/AdminProvider";
import EndpointTable from "@/components/EndpointTable";
import { DetailsHost, useEndpointDialogs } from "@/components/Workspace";
import { btnOutline, btnPrimary, card, EmptyState, field, Skeleton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Endpoint, Health } from "@/lib/types";

type StatusFilter = "all" | Health;
type Source = "all" | Endpoint["origin"];
type Sort = "name" | "status" | "latency" | "checked";

const STATUS_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "healthy", label: "Healthy" },
  { id: "degraded", label: "Degraded" },
  { id: "offline", label: "Offline" },
  { id: "unverified", label: "Unverified" },
  { id: "unconfigured", label: "Not configured" },
];
// Worst first, so problems rise to the top when sorting by status.
const SEVERITY: Record<Health, number> = { offline: 0, unverified: 1, degraded: 2, checking: 3, healthy: 4, unconfigured: 5 };

export default function EndpointsPage() {
  const a = useAdmin();
  const dialogs = useEndpointDialogs();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<Source>("all");
  const [sort, setSort] = useState<Sort>("status");

  const health = useMemo(() => new Map(a.endpoints.map((e) => [e.id, a.healthOf(e)])), [a]);
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: a.endpoints.length, healthy: 0, degraded: 0, offline: 0, unverified: 0, unconfigured: 0, checking: 0 };
    for (const h of health.values()) c[h]++;
    return c;
  }, [a.endpoints.length, health]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const last = (e: Endpoint) => a.probes[e.id]?.at(-1);
    const list = a.endpoints.filter((e) => {
      if (status !== "all" && health.get(e.id) !== status) return false;
      if (source !== "all" && e.origin !== source) return false;
      return !needle || [e.name, e.path, e.url, e.note].some((t) => t.toLowerCase().includes(needle));
    });
    return list.sort((x, y) => {
      if (sort === "name") return x.name.localeCompare(y.name);
      if (sort === "latency") return (last(y)?.ms ?? -1) - (last(x)?.ms ?? -1);
      if (sort === "checked") return (last(y)?.at ?? 0) - (last(x)?.at ?? 0);
      return SEVERITY[health.get(x.id)!] - SEVERITY[health.get(y.id)!] || x.name.localeCompare(y.name);
    });
  }, [a.endpoints, a.probes, health, q, status, source, sort]);

  const filtered = q.trim() !== "" || status !== "all" || source !== "all";
  const clear = () => {
    setQ("");
    setStatus("all");
    setSource("all");
  };
  const anyChecking = a.checking.size > 0;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-extrabold leading-tight sm:text-[38px]">Endpoints</h1>
          <p className="mt-1 text-[15px] text-mute">Checks run from this browser. External provider URLs are independent of your greenAir backend URL. Healthy means an HTTP 2xx response; check Source data for actual ingestion and freshness.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void a.checkAll()} disabled={!a.ready || anyChecking} className={btnOutline}>
            {anyChecking ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />} Run all checks
          </button>
          <button type="button" onClick={dialogs.openAdd} className={btnPrimary}>
            <Plus className="size-4" aria-hidden /> Add endpoint
          </button>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_380px]">
        <section className={cn(card, "p-4 sm:p-6")} aria-label="Endpoint list">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <label className="relative block flex-1">
                <span className="sr-only">Search endpoints</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" aria-hidden />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, path or URL" className={cn(field, "pl-9")} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Source</span>
                <select value={source} onChange={(e) => setSource(e.target.value as Source)} className={cn(field, "w-auto min-w-[150px]")}>
                  <option value="all">All sources</option>
                  <option value="backend">greenAir API</option>
                  <option value="third-party">Third party</option>
                  <option value="planned">Planned</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Sort by</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cn(field, "w-auto min-w-[150px]")}>
                  <option value="status">Sort: problems first</option>
                  <option value="name">Sort: name</option>
                  <option value="latency">Sort: slowest first</option>
                  <option value="checked">Sort: last checked</option>
                </select>
              </label>
            </div>
            <div role="radiogroup" aria-label="Filter by status" className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {STATUS_CHIPS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={status === c.id} onClick={() => setStatus(c.id)} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold", status === c.id ? "bg-brand text-white" : "bg-wash text-ink hover:bg-great-soft")}>
                  {c.label}
                  <span className={cn("rounded-full px-1.5 text-[11px]", status === c.id ? "bg-white/20" : "bg-white")}>{counts[c.id]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            {!a.ready ? (
              <div className="flex flex-col gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : a.endpoints.length === 0 ? (
              <EmptyState icon={Database} title="No endpoints yet" text="Add an endpoint to start monitoring it, or restore the endpoints the EcoMAB web client uses." action={<><button type="button" onClick={dialogs.openAdd} className={btnPrimary}>Add endpoint</button><button type="button" onClick={a.resetEndpoints} className={btnOutline}>Restore defaults</button></>} />
            ) : rows.length === 0 ? (
              <EmptyState icon={SearchX} title="No endpoints match" text="Try a different search or clear the filters." action={<button type="button" onClick={clear} className={btnOutline}><X className="size-4" aria-hidden /> Clear filters</button>} />
            ) : (
              <>
                <p className="mb-2 text-xs text-mute" role="status">
                  Showing {rows.length} of {a.endpoints.length}
                  {filtered && (
                    <>
                      {" · "}
                      <button type="button" onClick={clear} className="font-bold text-brand hover:underline">Clear filters</button>
                    </>
                  )}
                </p>
                <EndpointTable rows={rows} onEdit={dialogs.openEdit} showSource />
              </>
            )}
          </div>
        </section>
        <DetailsHost dialogs={dialogs} />
      </div>
      {dialogs.element}
    </div>
  );
}
