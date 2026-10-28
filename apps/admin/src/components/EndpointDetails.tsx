"use client";

import { useState } from "react";
import { Check, Copy, Pencil, RefreshCw, Shuffle, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago, fmtDateTime, fmtMs } from "@/lib/format";
import { endpointStats, HEALTH_DETAIL } from "@/lib/health";
import type { Endpoint } from "@/lib/types";
import { useAdmin } from "./AdminProvider";
import { Sparkline } from "./Charts";
import { useNow } from "./Shell";
import { btnOutline, btnPrimary, CategoryIcon, LiveBadge, StatusPill } from "./ui";

const MODE_LABEL = { off: "Off", "on-failure": "Send to the target when this endpoint is down", always: "Always send to the target" } as const;

/** Everything about the selected endpoint, with the actions that change it. */
export default function EndpointDetails({ endpoint, onEdit, onRedirect, onClose, heading = true, compact = false }: { endpoint: Endpoint; onEdit: () => void; onRedirect: () => void; onClose?: () => void; heading?: boolean; compact?: boolean }) {
  const a = useAdmin();
  const now = useNow();
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const probes = a.probes[endpoint.id] ?? [];
  const health = a.healthOf(endpoint);
  const stats = endpointStats(probes);
  const last = probes.at(-1);
  const checkedUrl = a.resolved(endpoint);
  const blocked = a.blockedReason(endpoint);
  const busy = a.checking.has(endpoint.id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      a.notify("Copying is blocked in this browser. Select the URL and copy it by hand.", "error");
    }
  };

  const row = (label: string, children: React.ReactNode) => (
    <div className={cn("grid grid-cols-[110px_1fr] items-start gap-3 text-sm", compact ? "py-2.5 [@media(max-height:880px)]:py-1.5" : "py-2.5")}>
      <dt className="text-mute">{label}</dt>
      <dd className="min-w-0 font-semibold">{children}</dd>
    </div>
  );

  return (
    <div className={cn("flex flex-col", compact ? "gap-3.5 [@media(max-height:880px)]:gap-2.5" : "gap-4")}>
      {heading && <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-extrabold">Endpoint details</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-ink hover:bg-wash" aria-label="Close endpoint details">
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>}

      <div className={cn("flex items-center gap-x-3 gap-y-2", !compact && "flex-wrap")}>
        <CategoryIcon category={endpoint.category} size={compact ? 46 : 52} />
        <div className={cn("flex-1", compact ? "min-w-[110px]" : "min-w-[130px]")}>
          <p className={cn("break-words font-extrabold leading-tight", compact ? "text-base" : "text-lg")}>{endpoint.name}</p>
          <p className="break-all text-sm text-mute">{endpoint.path || "–"}</p>
        </div>
        <StatusPill health={health} className={compact ? "px-2.5 py-1 text-xs" : undefined} />
      </div>

      <div>
        <p className="mb-1.5 text-sm text-mute">URL</p>
        <div className="flex items-center gap-2 rounded-xl bg-wash px-3 py-2.5">
          <code title={endpoint.url} className={cn("min-w-0 flex-1 break-all text-[13px] leading-snug", compact && "line-clamp-2")}>{endpoint.url || "Not set yet"}</code>
          <button type="button" onClick={copy} disabled={!endpoint.url} className="grid size-8 shrink-0 place-items-center rounded-lg text-ink hover:bg-white disabled:opacity-40" aria-label={copied ? "Copied" : "Copy URL"}>
            {copied ? <Check className="size-4 text-great" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
        </div>
        {checkedUrl && checkedUrl !== endpoint.url && <p className="mt-1.5 break-all text-xs text-mute">Checked as {checkedUrl}</p>}
        {blocked && <p className="mt-1.5 text-xs font-semibold text-[#8a5f00]">{blocked}.</p>}
      </div>

      <dl className="divide-y divide-line/70">
        {row(
          "Status",
          <>
            {HEALTH_DETAIL[health]}
            {last && !last.ok && <span className="block text-[13px] font-normal text-bad">{last.error}</span>}
            {last?.opaque && <span className="block text-[13px] font-normal text-mute">Reachable. The server hides its status code from browsers (CORS).</span>}
          </>,
        )}
        {row(
          "Last check",
          last ? (
            <>
              {ago(last.at, now)}
              <span className={cn("block text-[13px] font-normal text-mute", compact && "[@media(max-height:880px)]:hidden")}>{fmtDateTime(last.at)}</span>
            </>
          ) : (
            "Not checked yet"
          ),
        )}
        {row("Average latency", stats.avgMs != null ? fmtMs(stats.avgMs) : "–")}
        {row("Uptime", stats.uptimePct != null ? <>{stats.uptimePct}%<span className={cn("block text-[13px] font-normal text-mute", compact && "[@media(max-height:880px)]:hidden")}>{stats.checks} {stats.checks === 1 ? "check" : "checks"} from this browser since {fmtDateTime(stats.since!)}</span></> : "–")}
        {!compact && row("Redirect", endpoint.redirect.mode === "off" ? "Off" : <><span className="font-semibold">{MODE_LABEL[endpoint.redirect.mode]}</span><span className="block break-all text-[13px] font-normal text-mute">{endpoint.redirect.target}</span></>)}
      </dl>

      {!compact && <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-mute">Recent checks</p>
          {probes.length > 0 && <LiveBadge />}
        </div>
        <Sparkline probes={probes} degradedMs={a.settings.degradedMs} />
      </div>}

      {!compact && endpoint.note && <p className="rounded-xl bg-wash px-3 py-2.5 text-[13px] leading-relaxed text-mute">{endpoint.note}</p>}

      <div className={cn("flex flex-col gap-2 border-t border-line/70 pt-4", compact && "[@media(max-height:880px)]:grid [@media(max-height:880px)]:grid-cols-2 [@media(max-height:880px)]:pt-3")}>
        <button type="button" onClick={onEdit} className={btnPrimary}>
          <Pencil className="size-4" aria-hidden /> Edit endpoint
        </button>
        <button type="button" onClick={onRedirect} className={btnOutline}>
          <Shuffle className="size-4" aria-hidden /> Configure redirect
        </button>
        {!compact && <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || blocked != null} onClick={() => void a.checkOne(endpoint.id)} className={btnOutline}>
            <RefreshCw className={cn("size-4", busy && "animate-spin")} aria-hidden /> Check now
          </button>
          {confirmDelete ? (
            <button
              type="button"
              onClick={() => {
                a.removeEndpoint(endpoint.id);
                setConfirmDelete(false);
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bad px-4 text-sm font-bold text-white"
            >
              Tap to confirm
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} onBlur={() => setConfirmDelete(false)} className={cn(btnOutline, "text-[#a43a2a]")}>
              <Trash2 className="size-4" aria-hidden /> Remove
            </button>
          )}
        </div>}
      </div>
    </div>
  );
}
