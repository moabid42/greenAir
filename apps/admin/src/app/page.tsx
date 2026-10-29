"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Database, Leaf, Plus, RefreshCw, RotateCw, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { useAdmin } from "@/components/AdminProvider";
import { PipelineSources, PipelineBuilds } from "@/components/PipelineStatus";
import { usePipeline } from "@/lib/pipeline";
import EndpointTable from "@/components/EndpointTable";
import { StatCard } from "@/components/StatCard";
import { DetailsHost, FIT_QUERY, useEndpointDialogs, useMedia } from "@/components/Workspace";
import { btnOutline, btnPrimary, card, EmptyState, LiveBadge, Skeleton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/format";
import type { Health } from "@/lib/types";

/** The reference design shows four endpoints; taller screens have room for six. The ones that need attention come first. */
const FIT_ROWS = 4;
const TALL_ROWS = 6;
const TALL_QUERY = "(min-height: 1000px)";
const SEVERITY: Record<Health, number> = { offline: 0, unverified: 1, degraded: 2, checking: 3, healthy: 4, unconfigured: 5 };

export default function Overview() {
  const a = useAdmin();
  const dialogs = useEndpointDialogs();
  // One screen, no page scroll, like the reference. Smaller windows get the stacked layout that scrolls.
  const fit = useMedia(FIT_QUERY);
  const tall = useMedia(TALL_QUERY);
  const fitRows = tall ? TALL_ROWS : FIT_ROWS;
  const pipeline = usePipeline(a.settings.backendUrl);

  const checkable = a.endpoints.filter((e) => a.blockedReason(e) == null);
  const states = checkable.map((e) => a.healthOf(e));
  const healthy = states.filter((s) => s === "healthy").length;
  const degraded = states.filter((s) => s === "degraded").length;
  const offline = states.filter((s) => s === "offline").length;
  const unverified = states.filter((s) => s === "unverified").length;
  const waiting = states.filter((s) => s === "checking").length;
  const unconfigured = a.endpoints.length - checkable.length;
  const prev = a.previousCounts;
  const versusCheck = prev ? (fit ? "vs. last check" : "vs. previous check") : fit ? "No earlier check" : "No earlier check yet";
  const anyChecking = a.checking.size > 0;

  const rows = useMemo(() => {
    if (!fit) return a.endpoints;
    // Problems first, then the rest in their usual order.
    return a.endpoints
      .map((e, i) => ({ e, i, s: SEVERITY[a.healthOf(e)] }))
      .sort((x, y) => x.s - y.s || x.i - y.i)
      .slice(0, fitRows)
      .map((x) => x.e);
  }, [a, fit, fitRows]);

  const firstVisible = rows[0]?.id;
  const selectFirst = a.select;
  const selectedVisible = rows.some((r) => r.id === a.selectedId);
  useEffect(() => {
    if (fit && a.ready && firstVisible && !selectedVisible && a.selectedId !== null) selectFirst(firstVisible);
  }, [fit, a.ready, firstVisible, selectedVisible, a.selectedId, selectFirst]);

  const tableCard = (
    <section className={cn(card, "flex min-h-0 flex-col", fit ? "p-4" : "p-4 sm:p-6")} aria-labelledby="health-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Database className="size-8 shrink-0 text-brand" aria-hidden />
          <div>
            <h2 id="health-h" className="flex flex-wrap items-center gap-2 font-display text-xl font-extrabold">
              Endpoint health <LiveBadge />
            </h2>
            <p className="text-sm text-mute">Monitor the status and performance of all data endpoints.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void a.checkAll()} disabled={!a.ready || anyChecking} className={btnOutline} title="Run all checks now">
            {anyChecking ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />}
            <span className="sr-only">Run checks</span>
          </button>
          <button type="button" onClick={dialogs.openAdd} className={btnPrimary}>
            <Plus className="size-4" aria-hidden /> Add endpoint
          </button>
        </div>
      </div>
      <div className={cn("mt-3", fit && "min-h-0 flex-1 overflow-y-auto")}>
        {!a.ready ? (
          <div className="flex flex-col gap-3">{Array.from({ length: fit ? 4 : 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : a.endpoints.length === 0 ? (
          <EmptyState icon={Database} title="No endpoints yet" text="Add the first endpoint to start monitoring it, or restore the endpoints the EcoMAB web client uses." action={<><button type="button" onClick={dialogs.openAdd} className={btnPrimary}>Add endpoint</button><button type="button" onClick={a.resetEndpoints} className={btnOutline}>Restore defaults</button></>} />
        ) : (
          <EndpointTable rows={rows} onEdit={dialogs.openEdit} dense={fit} />
        )}
      </div>
      {fit && a.ready && a.endpoints.length > fitRows && (
        <p className="mt-2 text-xs text-mute">
          Showing the {fitRows} that need attention first. <Link href="/endpoints" className="font-bold text-brand hover:underline">View all {a.endpoints.length} endpoints →</Link>
        </p>
      )}
    </section>
  );

  const chartCard = (
    <section className={cn(card, "flex min-h-0 flex-col p-4")}>
      <h2 className="font-display text-lg font-bold">Provider refresh status</h2>
      <div className="min-h-0 flex-1 overflow-auto"><PipelineSources {...pipeline} /></div>
    </section>
  );
  const donutCard = (
    <section className={cn(card, "flex min-h-0 flex-col p-4")}>
      <h2 className="font-display text-lg font-bold">Latest processing attempts</h2>
      <div className="min-h-0 flex-1 overflow-auto"><PipelineBuilds {...pipeline} /></div>
      <Link href="/client-data" className="mt-2 text-sm font-bold text-brand">See source data →</Link>
    </section>
  );

  return (
    <div className={cn("mx-auto flex max-w-[1700px] flex-col", fit ? "h-[calc(100dvh-3rem)] gap-3 overflow-hidden" : "gap-5")}>
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={cn("font-display font-extrabold leading-tight", fit ? "text-[32px]" : "text-[32px] sm:text-[38px]")}>Admin overview</h1>
            <span className="rounded-full bg-great-soft px-3 py-1 text-[13px] font-bold text-brand" title="Provider inputs and processed builds from the backend">{pipeline.data?.mode === "stored" ? "Stored real data" : pipeline.error ? "Data unavailable" : pipeline.data ? "Demo backend" : "Loading data…"}</span>
            <Link href="/settings#access" className="inline-flex items-center gap-1.5 rounded-full bg-bad-soft px-3 py-1 text-[13px] font-bold text-[#a43a2a]" title="Anyone who can open this address can use the admin">
              <ShieldAlert className="size-3.5" aria-hidden /> No sign-in
            </Link>
          </div>
          <p className="mt-0.5 text-[15px] text-mute">Monitor data endpoints, stored source data and system health.</p>
        </div>

      </header>

      <section aria-label="Summary" className={cn("grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2", fit ? "grid-cols-4 gap-3 sm:grid-cols-4" : "gap-4 min-[1400px]:grid-cols-4")}>
        {!a.ready ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[20px]" />)
        ) : (
          <>
            <StatCard dense={fit} icon={Leaf} tint="bg-great-soft text-great" label="Healthy endpoints" value={String(healthy)} outOf={String(checkable.length)} delta={{ value: prev ? healthy - prev.healthy : null, unit: "", versus: versusCheck, upIsGood: true }} note={[unverified ? `${unverified} unverified (CORS)` : "", waiting ? `${waiting} being checked` : "", unconfigured ? `${unconfigured} not configured` : ""].filter(Boolean).join(" · ") || undefined} />
            <StatCard dense={fit} icon={TriangleAlert} tint="bg-ok-soft text-ok" label="Degraded endpoints" value={String(degraded)} outOf={String(checkable.length)} delta={{ value: prev ? degraded - prev.degraded : null, unit: "", versus: versusCheck, upIsGood: false }} note={offline ? `${offline} offline` : undefined} />
            <StatCard dense={fit} icon={RotateCw} tint="bg-great-soft text-great" label="Stored canonical values" value={pipeline.data?.observations == null ? "—" : fmtInt(pipeline.data.observations)} delta={{ value: null, unit: "", versus: "Provider values, including nulls" }} />
            <StatCard dense={fit} icon={Users} tint="bg-great-soft text-great" label="Real road segments" value={pipeline.data?.roads == null ? "—" : fmtInt(pipeline.data.roads)} delta={{ value: null, unit: "", versus: "Captured Heilbronn geometry" }} />
          </>
        )}
      </section>

      {fit ? (
        // The reference layout: table over chart and donut on the left, details running the full height on the right.
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px_360px] grid-rows-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
          <div className="col-span-2 min-h-0 [&>section]:h-full">{tableCard}</div>
          <div className="row-span-2 min-h-0 [&>aside]:h-full [&>aside]:overflow-y-auto">
            <DetailsHost dialogs={dialogs} query={FIT_QUERY} compact />
          </div>
          <div className="min-h-0 [&>section]:h-full">{chartCard}</div>
          <div className="min-h-0 [&>section]:h-full">{donutCard}</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_380px]">
            {tableCard}
            <DetailsHost dialogs={dialogs} className="self-start min-[1400px]:sticky min-[1400px]:top-6" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            {chartCard}
            {donutCard}
          </div>
        </>
      )}
      {dialogs.element}
    </div>
  );
}
