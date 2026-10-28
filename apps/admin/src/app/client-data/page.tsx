"use client";

import { useMemo, useState } from "react";
import { Download, FlaskConical, Inbox } from "lucide-react";
import { useAdmin } from "@/components/AdminProvider";
import { ClientChart, Donut, TYPE_COLOR } from "@/components/Charts";
import { RangeSelect } from "@/components/RangeSelect";
import { StatCard } from "@/components/StatCard";
import { btnOutline, card, EmptyState, field, SimBadge, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { download, toCsv } from "@/lib/csv";
import { ago, fmtDateTime, fmtInt } from "@/lib/format";
import { todayIso } from "@/lib/probe";
import { DATA_TYPES, simBatches, simDays } from "@/lib/sim";
import { breakdown, periods, trend } from "@/lib/stats";
import type { DataType } from "@/lib/types";
import { BarChart3, Users, Activity, RotateCw } from "lucide-react";

type Show = "both" | "records" | "clients";
const STATUS_STYLE = { accepted: "bg-great-soft text-[#0b6b4c]", partial: "bg-ok-soft text-[#8a5f00]", rejected: "bg-bad-soft text-[#a43a2a]" } as const;
const typeLabel = (t: DataType) => DATA_TYPES.find((x) => x.id === t)!.label;

export default function ClientDataPage() {
  const a = useAdmin();
  const [show, setShow] = useState<Show>("both");
  const [typeFilter, setTypeFilter] = useState<"all" | DataType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "accepted" | "partial" | "rejected">("all");
  const range = a.range;

  const all = useMemo(() => simDays(todayIso()), []);
  const { current, previous } = useMemo(() => periods(all, range), [all, range]);
  const split = useMemo(() => breakdown(current.types), [current]);
  const prevSplit = useMemo(() => (previous ? previous.types : null), [previous]);
  const batches = useMemo(() => simBatches(Date.now()), []);
  const shown = batches.filter((b) => (typeFilter === "all" || b.type === typeFilter) && (statusFilter === "all" || b.status === statusFilter));
  const perDay = Math.round(current.records / range);
  const prevPerDay = previous ? Math.round(previous.records / range) : null;
  const versus = `vs. previous ${range} days`;

  const exportDaily = () => download(`ecomab-client-data-simulated-last-${range}-days.csv`, toCsv(["date", "data_records", "unique_clients", "requests", "activity", "environment", "wearable", "note"], current.days.map((d) => [d.date, d.records, d.clients, d.requests, d.types.activity, d.types.environment, d.types.wearable, "simulated sample"])));

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[32px] font-extrabold leading-tight sm:text-[38px]">Client data</h1>
            <SimBadge label="Simulated sample" />
          </div>
          <p className="mt-1 text-[15px] text-mute">What clients send to the platform, aggregated over time.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RangeSelect value={range} onChange={a.setRange} label="Date range" />
          <button type="button" onClick={exportDaily} className={btnOutline}>
            <Download className="size-4" aria-hidden /> Export CSV
          </button>
        </div>
      </header>

      <p role="note" className="flex gap-3 rounded-2xl bg-ok-soft px-4 py-3 text-sm text-[#7a5200]">
        <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          <b>These numbers are a simulated sample, not measurements.</b> The EcoMAB web client currently sends nothing to a server (wearable and location data stay on the device), and the backend has no ingestion endpoint yet. This page shows how client data will look once one exists; exports are marked as simulated.
        </span>
      </p>

      <section aria-label="Totals" className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 min-[1400px]:grid-cols-4">
        {!a.ready ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[112px] rounded-[20px]" />)
        ) : (
          <>
            <StatCard icon={BarChart3} tint="bg-great-soft text-great" label="Data records" value={fmtInt(current.records)} delta={{ value: trend(current.records, previous?.records), unit: "%", versus }} simulated />
            <StatCard icon={Users} tint="bg-great-soft text-great" label="Unique clients" value={fmtInt(current.clients)} delta={{ value: trend(current.clients, previous?.clients), unit: "%", versus }} simulated />
            <StatCard icon={RotateCw} tint="bg-great-soft text-great" label="Requests" value={fmtInt(current.requests)} delta={{ value: trend(current.requests, previous?.requests), unit: "%", versus }} simulated />
            <StatCard icon={Activity} tint="bg-great-soft text-great" label="Records per day" value={fmtInt(perDay)} delta={{ value: trend(perDay, prevPerDay), unit: "%", versus }} simulated />
          </>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="cd-chart">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="cd-chart" className="font-display text-xl font-extrabold">Client data over time</h2>
              <p className="text-sm text-mute">Hover or use the arrow keys to read a day.</p>
            </div>
            <div role="radiogroup" aria-label="Show" className="flex rounded-xl bg-wash p-1">
              {(["both", "records", "clients"] as Show[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={show === s} onClick={() => setShow(s)} className={cn("h-9 rounded-lg px-3 text-[13px] font-bold", show === s ? "bg-white shadow-sm" : "text-mute")}>
                  {s === "both" ? "Both" : s === "records" ? "Records" : "Clients"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">{a.ready ? <ClientChart days={current.days} show={show} height={250} /> : <Skeleton className="h-[270px]" />}</div>
        </section>

        <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="cd-types">
          <h2 id="cd-types" className="font-display text-lg font-extrabold">Data types</h2>
          <p className="text-[13px] text-mute">Share of the {range}-day total.</p>
          <div className="mt-5">{a.ready ? <Donut total={split.total} rows={split.rows} /> : <Skeleton className="h-40" />}</div>
        </section>
      </div>

      <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="cd-break">
        <h2 id="cd-break" className="font-display text-xl font-extrabold">Breakdown by type</h2>
        {!a.ready ? <Skeleton className="mt-3 h-40" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="text-[13px] font-bold text-mute">
                <th scope="col" className="rounded-l-xl bg-wash px-4 py-3">Type</th>
                <th scope="col" className="bg-wash px-3 py-3 text-right">Records</th>
                <th scope="col" className="bg-wash px-3 py-3">Share</th>
                <th scope="col" className="rounded-r-xl bg-wash px-3 py-3 text-right">{versus}</th>
              </tr>
            </thead>
            <tbody>
              {split.rows.map((r) => {
                const t = trend(r.value, prevSplit?.[r.id]);
                return (
                  <tr key={r.id} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3 text-[15px] font-bold">
                      <span aria-hidden className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: TYPE_COLOR[r.id] }} />
                      {typeLabel(r.id)}
                    </td>
                    <td className="px-3 py-3 text-right text-[15px] tabular-nums">{fmtInt(r.value)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-wash" aria-hidden>
                          <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: TYPE_COLOR[r.id] }} />
                        </div>
                        <span className="text-sm font-bold tabular-nums">{r.pct}%</span>
                      </div>
                    </td>
                    <td className={cn("px-3 py-3 text-right text-sm font-bold tabular-nums", t == null ? "text-mute" : t >= 0 ? "text-great" : "text-bad")}>{t == null ? "–" : `${t > 0 ? "+" : t < 0 ? "−" : "± "}${Math.abs(t)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="cd-batches">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 id="cd-batches" className="font-display text-xl font-extrabold">Recent uploads</h2>
            <SimBadge />
          </div>
          <div className="flex gap-2">
            <label>
              <span className="sr-only">Filter by type</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className={cn(field, "h-10 w-auto text-[13px]")}>
                <option value="all">All types</option>
                {DATA_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by result</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={cn(field, "h-10 w-auto text-[13px]")}>
                <option value="all">Any result</option>
                <option value="accepted">Accepted</option>
                <option value="partial">Partly accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>
        </div>
        {!a.ready ? (
          <Skeleton className="mt-3 h-48" />
        ) : shown.length === 0 ? (
          <EmptyState icon={Inbox} title="No uploads match" text="Change the filters to see more." action={<button type="button" className={btnOutline} onClick={() => { setTypeFilter("all"); setStatusFilter("all"); }}>Clear filters</button>} />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="text-[13px] font-bold text-mute">
                  <th scope="col" className="rounded-l-xl bg-wash px-4 py-3">Received</th>
                  <th scope="col" className="bg-wash px-3 py-3">Source</th>
                  <th scope="col" className="bg-wash px-3 py-3">Type</th>
                  <th scope="col" className="bg-wash px-3 py-3 text-right">Records</th>
                  <th scope="col" className="bg-wash px-3 py-3 text-right">Clients</th>
                  <th scope="col" className="rounded-r-xl bg-wash px-3 py-3">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className="border-b border-line/70 last:border-0 text-[14px]">
                    <td className="whitespace-nowrap px-4 py-2.5"><span className="font-semibold">{ago(b.at)}</span><span className="block text-xs text-mute">{fmtDateTime(b.at)}</span></td>
                    <td className="px-3 py-2.5">{b.source}</td>
                    <td className="px-3 py-2.5">{typeLabel(b.type)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(b.records)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(b.clients)}</td>
                    <td className="px-3 py-2.5"><span className={cn("rounded-full px-2.5 py-1 text-xs font-bold capitalize", STATUS_STYLE[b.status])}>{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
