"use client";

import { Download, RefreshCw } from "lucide-react";
import { useAdmin } from "@/components/AdminProvider";
import { PipelineSources, PipelineBuilds } from "@/components/PipelineStatus";
import { btnOutline, card } from "@/components/ui";
import { download, toCsv } from "@/lib/csv";
import { usePipeline } from "@/lib/pipeline";
import { fmtInt } from "@/lib/format";

export default function ClientDataPage() {
  const a = useAdmin();
  const { data, error, refresh } = usePipeline(a.settings.backendUrl);
  const exportSources = () => {
    if (!data) return;
    download("greenair-source-status.csv", toCsv(["source", "status", "last_attempt_utc", "last_success_utc", "latest_observed_utc", "latest_report_rows"], data.sources.map((s) => [s.source_id, s.status, s.last_attempt_at ?? "", s.last_success_at ?? "", s.latest_observed_at ?? "", s.rows_downloaded])));
  };
  return <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="font-display text-[32px] font-extrabold">Source data</h1><p className="text-mute">Stored provider inputs and processed results for Heilbronn.</p></div><div className="flex gap-2"><button type="button" className={btnOutline} onClick={() => void refresh()}><RefreshCw className="size-4" />Refresh status</button><button type="button" className={btnOutline} disabled={!data || data.mode !== "stored"} onClick={exportSources}><Download className="size-4" />Export CSV</button></div></header>
    <p role="note" className="rounded-2xl bg-wash p-4 text-sm">Client uploads and server request analytics are unavailable. Wearable and location data stay on the device. The counts below describe provider data stored by the refresh worker.</p>
    <div className="grid gap-4 sm:grid-cols-3">{([ ["Canonical values", data?.observations], ["Road segments", data?.roads], ["Stored layer records", data?.layers] ] as const).map(([label, value]) => <section key={label} className={`${card} p-5`}><h2 className="text-sm text-mute">{label}</h2><p className="font-display text-3xl font-bold">{value == null ? "—" : fmtInt(value)}</p></section>)}</div>
    <section className={`${card} p-5`}><h2 className="font-display text-xl font-bold">Provider refresh status</h2><PipelineSources data={data} error={error} /></section>
    <section className={`${card} p-5`}><h2 className="font-display text-xl font-bold">Latest processing attempts</h2><p className="text-sm text-mute">Partial and unavailable builds preserve gaps. Serving retains the last usable result.</p><PipelineBuilds data={data} error={error} /></section>
  </div>;
}
