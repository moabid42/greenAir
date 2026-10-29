"use client";

import { fmtDateTime, fmtInt } from "@/lib/format";
import type { PipelineStatus } from "@/lib/pipeline";

const when = (v: string | null) => v ? fmtDateTime(Date.parse(v)) : "Unavailable";

export function PipelineSources({ data, error }: { data: PipelineStatus | null; error: string | null }) {
  if (error) return <p role="alert" className="p-3 text-sm text-bad">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-mute">Loading pipeline status…</p>;
  if (data.mode !== "stored") return <p className="p-3 text-sm text-bad">Backend is in demo mode. Real pipeline status is unavailable.</p>;
  if (!data.sources.length) return <p className="p-3 text-sm text-mute">Waiting for the first provider refresh. No sample data is used.</p>;
  return <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="text-mute"><th className="p-2">Source</th><th className="p-2">Latest attempt</th><th className="p-2">Last successful page</th><th className="p-2">Latest observation / model valid time</th></tr></thead><tbody>{data.sources.map((s) => <tr key={s.source_id} className="border-t border-line"><td className="p-2 font-bold">{s.source_id}<span className="block font-normal text-mute">{s.status} · {fmtInt(s.rows_downloaded)} rows in latest ingestion report</span></td><td className="p-2">{when(s.last_attempt_at)}</td><td className="p-2">{when(s.last_success_at)}</td><td className="p-2">{when(s.latest_observed_at)}</td></tr>)}</tbody></table></div>;
}

export function PipelineBuilds({ data, error }: { data: PipelineStatus | null; error: string | null }) {
  if (error) return <p className="p-3 text-sm text-mute">Build status unavailable.</p>;
  if (!data) return <p className="p-3 text-sm text-mute">Loading…</p>;
  return <div className="overflow-auto text-xs">{data.builds.length ? data.builds.map((b) => <div key={b.resource} className="border-b border-line py-2"><b>{b.resource}</b> · {b.status}<p className="text-mute">Built {when(b.built_at)}</p><p className="truncate font-mono" title={b.build_id}>{b.build_id}</p></div>) : <p className="p-3 text-mute">No processed builds yet.</p>}</div>;
}
