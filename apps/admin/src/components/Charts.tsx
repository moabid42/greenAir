"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtInt, fmtMs, fmtShortDate } from "@/lib/format";
import { DATA_TYPES } from "@/lib/sim";
import type { DataType, Probe, SimDay } from "@/lib/types";

const niceMax = (v: number) => {
  if (v <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
};

export const TYPE_COLOR: Record<DataType, string> = { activity: "var(--color-chart-1)", environment: "var(--color-chart-2)", wearable: "var(--color-chart-3)" };

/** Bars for data records, a line for unique clients. Hover, tap or use the arrow keys to read a day. */
export function ClientChart({ days, show = "both", height = 230, fill = false, legendExtra }: { days: SimDay[]; show?: "both" | "records" | "clients"; height?: number; fill?: boolean; legendExtra?: ReactNode }) {
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);
  // Draw at the real width so text stays readable on a phone instead of shrinking with the SVG.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: height });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(280, Math.round(e.contentRect.width)), h: Math.max(110, Math.round(e.contentRect.height)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size.w;
  // In fill mode the chart takes the height its card gives it; otherwise a fixed height (a little shorter on phones).
  const H = fill ? size.h : W < 480 ? Math.round(height * 0.9) : height;
  const m = { l: 40, r: 10, t: 12, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = days.length;
  const maxV = niceMax(Math.max(...days.map((d) => (show === "clients" ? d.clients : d.records)), 1));
  const x = (i: number) => m.l + (iw * (i + 0.5)) / n;
  const y = (v: number) => m.t + ih - (v / maxV) * ih;
  const bw = Math.max(2, Math.min(22, (iw / n) * 0.62));
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.clients).toFixed(1)}`).join(" ");
  const ticks = [0, 1, 2, 3, 4].map((t) => (maxV * t) / 4);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 62))));
  const a = active != null ? days[active] : null;

  const move = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    setActive(Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * n - 0.5))));
  };

  return (
    <div className={cn(fill && "flex h-full min-h-0 flex-col")}>
    <div ref={box} className={cn("relative", fill && "min-h-0 flex-1")}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className={cn("w-full touch-pan-y select-none", fill ? "absolute inset-0 h-full" : "h-auto")}
        role="img"
        aria-label={`Client data per day, ${fmtShortDate(days[0].date)} to ${fmtShortDate(days[n - 1].date)}. Use the left and right arrow keys to read each day.`}
        tabIndex={0}
        onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
          else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
          else if (e.key === "Escape") setActive(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-mute)">
              {fmtInt(Math.round(t))}
            </text>
          </g>
        ))}
        {show !== "clients" &&
          days.map((d, i) => <rect key={d.date} x={x(i) - bw / 2} y={y(d.records)} width={bw} height={Math.max(0, m.t + ih - y(d.records))} rx={Math.min(3, bw / 2)} fill="var(--color-chart-3)" opacity={active == null || active === i ? 1 : 0.55} />)}
        {show !== "records" && (
          <>
            <path d={line} fill="none" stroke="var(--color-chart-1)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
            {n <= 45 && days.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.clients)} r={active === i ? 5 : 2.6} fill="var(--color-chart-1)" />)}
            {n > 45 && active != null && <circle cx={x(active)} cy={y(days[active].clients)} r={5} fill="var(--color-chart-1)" />}
          </>
        )}
        {days.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-mute)">
              {fmtShortDate(d.date)}
            </text>
          ) : null,
        )}
        {active != null && <line x1={x(active)} x2={x(active)} y1={m.t} y2={m.t + ih} stroke="var(--color-brand)" strokeWidth={1} strokeDasharray="3 3" />}
      </svg>
      {a && (
        <div className={cn("pointer-events-none absolute top-1 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg", active! > n / 2 ? "right-2" : "left-12")} role="status">
          <p className="font-bold">{fmtShortDate(a.date)}</p>
          {show !== "clients" && <p>{fmtInt(a.records)} data records</p>}
          {show !== "records" && <p>{fmtInt(a.clients)} unique clients</p>}
        </div>
      )}
      <table className="sr-only">
        <caption id={`${uid}-cap`}>Client data per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Data records</th>
            <th>Unique clients</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.records}</td>
              <td>{d.clients}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-5 text-xs font-semibold text-mute" aria-hidden>
        {show !== "clients" && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[4px] bg-chart-3" /> Data records
          </span>
        )}
        {show !== "records" && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-chart-1" /> Unique clients
          </span>
        )}
        {legendExtra}
      </div>
    </div>
  );
}

/** Ring chart of received data by type, with the total in the middle. */
export function Donut({ total, rows, compact = false }: { total: number; rows: { id: DataType; value: number; pct: number }[]; compact?: boolean }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className={cn("flex items-center", compact ? "h-full min-h-0 gap-3" : "flex-col gap-5 sm:flex-row sm:justify-center lg:flex-col xl:flex-row")}>
      <svg viewBox="0 0 140 140" className={cn("shrink-0 -rotate-90", compact ? "h-full max-h-[130px] min-h-[90px] w-auto" : "size-40")} role="img" aria-label={`${fmtInt(total)} records: ${rows.map((r) => `${DATA_TYPES.find((t) => t.id === r.id)?.label} ${r.pct}%`).join(", ")}`}>
        <circle cx={70} cy={70} r={R} fill="none" stroke="var(--color-wash)" strokeWidth={20} />
        {rows.map((r) => {
          const len = total ? (r.value / total) * C : 0;
          const el = <circle key={r.id} cx={70} cy={70} r={R} fill="none" stroke={TYPE_COLOR[r.id]} strokeWidth={20} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
        <g className="rotate-90 origin-center" style={{ transformOrigin: "70px 70px" }}>
          <text x={70} y={68} textAnchor="middle" fontSize={21} fontWeight={800} fill="var(--color-ink)">
            {fmtInt(total)}
          </text>
          <text x={70} y={85} textAnchor="middle" fontSize={11} fill="var(--color-mute)">
            records
          </text>
        </g>
      </svg>
      <ul className={cn("flex min-w-0 flex-col", compact ? "gap-1.5" : "w-full gap-3 sm:w-auto")}>
        {rows.map((r) => (
          <li key={r.id} className={cn("flex items-start gap-2", compact ? "text-xs" : "gap-2.5 text-sm")}>
            <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full" style={{ background: TYPE_COLOR[r.id] }} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className={cn("text-mute", compact ? "text-[11px]" : "text-[13px]")}>{DATA_TYPES.find((t) => t.id === r.id)?.label}</span>
              <span className="flex items-baseline justify-between gap-2">
                <b className={compact ? "text-[13px]" : "text-[15px]"}>{fmtInt(r.value)}</b>
                <span className={cn("font-bold text-mute", compact ? "text-[11px]" : "text-[13px]")}>{r.pct}%</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The latest checks as little bars (height = latency, red = failed). */
export function Sparkline({ probes, degradedMs }: { probes: Probe[]; degradedMs: number }) {
  const recent = probes.slice(-24);
  if (recent.length === 0) return <p className="text-xs text-mute">No checks yet.</p>;
  const max = Math.max(degradedMs, ...recent.map((p) => p.ms ?? 0));
  return (
    <div className="flex h-12 items-end gap-[3px]" role="img" aria-label={`Latency of the last ${recent.length} checks: ${recent.map((p) => (p.ok ? fmtMs(p.ms) : "failed")).join(", ")}`}>
      {recent.map((p) => (
        <span
          key={p.at}
          title={p.ok ? fmtMs(p.ms) : (p.error ?? "failed")}
          className={cn("min-w-[3px] flex-1 rounded-t-[3px]", !p.ok ? "bg-bad" : p.ms != null && p.ms > degradedMs ? "bg-ok" : "bg-chart-2")}
          style={{ height: `${p.ok ? Math.max(14, ((p.ms ?? 0) / max) * 100) : 100}%`, opacity: p.ok ? 1 : 0.75 }}
        />
      ))}
    </div>
  );
}
