"use client";

import { ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago, fmtMs } from "@/lib/format";
import type { Endpoint } from "@/lib/types";
import { useAdmin } from "./AdminProvider";
import { useNow } from "./Shell";
import { btnIcon, CategoryIcon, StatusPill } from "./ui";

const SOURCE: Record<Endpoint["origin"], string> = { backend: "greenAir API", "third-party": "Third party", planned: "Planned", custom: "Custom" };

/** The endpoint list: a table from tablet width up, stacked cards on phones. */
export default function EndpointTable({ rows, onEdit, showSource = false, dense = false }: { rows: Endpoint[]; onEdit: (ep: Endpoint) => void; showSource?: boolean; dense?: boolean }) {
  const py = dense ? "py-1.5" : "py-3";
  const a = useAdmin();
  const now = useNow();

  const info = (ep: Endpoint) => {
    const probes = a.probes[ep.id] ?? [];
    const last = probes.at(-1);
    return { health: a.healthOf(ep), last, ms: last?.ok ? last.ms : null, busy: a.checking.has(ep.id) };
  };
  const open = (ep: Endpoint) => {
    a.select(ep.id);
    a.setDetailOpen(true);
  };

  const actions = (ep: Endpoint, busy: boolean, wide = false) => (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={btnIcon} onClick={() => onEdit(ep)} aria-label={`Edit ${ep.name}`} title="Edit">
        <Pencil className="size-4" aria-hidden />
      </button>
      <button type="button" className={cn(btnIcon, !wide && "hidden 2xl:grid")} disabled={busy || a.blockedReason(ep) != null} onClick={() => void a.checkOne(ep.id)} aria-label={`Check ${ep.name} now`} title={a.blockedReason(ep) ?? "Check now"}>
        <RefreshCw className={cn("size-4", busy && "animate-spin")} aria-hidden />
      </button>
      {a.resolved(ep) ? (
        <a className={btnIcon} href={a.resolved(ep)!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${ep.name} in a new tab`} title="Open in a new tab">
          <ExternalLink className="size-4" aria-hidden />
        </a>
      ) : (
        <span className={cn(btnIcon, "opacity-40")} aria-hidden title="Nothing to open yet">
          <ExternalLink className="size-4" />
        </span>
      )}
    </div>
  );

  return (
    <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-left">
        <thead>
          <tr className="text-[13px] font-bold text-mute">
            <th scope="col" className="rounded-l-xl bg-wash px-3 py-3 font-bold">Endpoint</th>
            <th scope="col" className="bg-wash px-2 py-3 font-bold">Status</th>
            <th scope="col" className="bg-wash px-2 py-3 font-bold">Latency</th>
            <th scope="col" className="bg-wash px-2 py-3 font-bold">Last check</th>
            <th scope="col" className="rounded-r-xl bg-wash px-2 py-3 font-bold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ep) => {
            const { health, last, ms, busy } = info(ep);
            const selected = a.selectedId === ep.id;
            return (
              <tr key={ep.id} onClick={() => open(ep)} className={cn("cursor-pointer border-b border-line/70 last:border-0 transition-colors hover:bg-wash/70", selected && "bg-great-soft/40")}>
                <td className={cn("px-3", py)}>
                  <div className="flex items-center gap-3">
                    <CategoryIcon category={ep.category} size={dense ? 34 : 40} />
                    <div className="min-w-0">
                      <button type="button" onClick={() => open(ep)} aria-pressed={selected} className="block max-w-[140px] xl:max-w-[190px] truncate text-left text-[15px] font-bold hover:underline">
                        {ep.name}
                      </button>
                      <p className="max-w-[140px] xl:max-w-[190px] truncate text-[13px] text-mute">{ep.path || "–"}{showSource && <span> · {SOURCE[ep.origin]}</span>}</p>
                    </div>
                  </div>
                </td>
                <td className={cn("px-2", py)}>
                  <StatusPill health={health} className="px-2.5 py-1 text-xs" />
                </td>
                <td className={cn("whitespace-nowrap px-2 text-[14px]", py)}>{health === "unconfigured" ? "–" : fmtMs(ms)}</td>
                <td className={cn("whitespace-nowrap px-2 text-[13px] text-mute", py)}>{health === "unconfigured" ? "Not checked" : last ? ago(last.at, now) : busy ? "Checking…" : "Never"}</td>
                <td className={cn("px-2", py)}>{actions(ep, busy)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>

      <ul className="flex flex-col gap-2.5 md:hidden">
        {rows.map((ep) => {
          const { health, last, ms, busy } = info(ep);
          return (
            <li key={ep.id} className={cn("rounded-2xl border border-line/80 p-3.5", a.selectedId === ep.id && "border-brand/40 bg-great-soft/30")}>
              <div className="flex items-start gap-3">
                <CategoryIcon category={ep.category} size={38} />
                <button type="button" onClick={() => open(ep)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[15px] font-bold">{ep.name}</span>
                  <span className="block truncate text-[13px] text-mute">{ep.path || "–"}{showSource && <span> · {SOURCE[ep.origin]}</span>}</span>
                </button>
                <StatusPill health={health} className="px-2.5 py-1 text-xs" />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2 text-[13px] text-mute">
                <span>
                  {health === "unconfigured" ? "Not checked" : `${fmtMs(ms)} · ${last ? ago(last.at, now) : busy ? "checking…" : "never"}`}
                </span>
                {actions(ep, busy, true)}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
