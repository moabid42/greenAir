"use client";

import Image from "next/image";
import { type ReactNode, useEffect, useRef } from "react";
import { Bike, FlaskConical, Leaf, Loader2, Map as MapIcon, MapPin, Plug, RefreshCw, Server, Sun, TriangleAlert, Watch, Wind, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { HEALTH_LABEL } from "@/lib/health";
import type { Category, Health } from "@/lib/types";

export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return <Image src="/brand.png" alt="" width={size} height={size} priority className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
}

export function Wordmark({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-extrabold tracking-[-0.04em] text-brand" style={{ fontSize: size * 0.62 }}>
      <Logo size={size} />
      EcoMAB
    </span>
  );
}

export const card = "rounded-[20px] bg-white shadow-[0_2px_14px_rgb(22_44_41/0.07)]";
export const btnPrimary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";
export const btnOutline = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink transition-colors hover:bg-wash disabled:opacity-50";
export const btnIcon = "grid size-9 place-items-center rounded-[10px] bg-wash text-ink transition-colors hover:bg-great-soft hover:text-brand disabled:opacity-40";
export const field = "h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-mute/70 focus:border-brand focus:outline-none";

const CATEGORY: Record<Category, { icon: LucideIcon; tint: string }> = {
  backend: { icon: Server, tint: "bg-wash text-brand" },
  environment: { icon: Leaf, tint: "bg-great-soft text-great" },
  weather: { icon: Sun, tint: "bg-ok-soft text-ok" },
  air: { icon: Wind, tint: "bg-great-soft text-great" },
  wearable: { icon: Watch, tint: "bg-wash text-ink" },
  geo: { icon: MapPin, tint: "bg-wash text-brand" },
  map: { icon: MapIcon, tint: "bg-wash text-brand" },
  bike: { icon: Bike, tint: "bg-great-soft text-great" },
  other: { icon: Plug, tint: "bg-wash text-mute" },
};

export function CategoryIcon({ category, size = 40 }: { category: Category; size?: number }) {
  const { icon: Icon, tint } = CATEGORY[category];
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full", tint)} style={{ width: size, height: size }}>
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

const PILL: Record<Health, { box: string; dot: string }> = {
  healthy: { box: "bg-great-soft text-[#0b6b4c]", dot: "bg-great" },
  degraded: { box: "bg-ok-soft text-[#8a5f00]", dot: "bg-ok" },
  unverified: { box: "bg-ok-soft text-[#8a5f00]", dot: "bg-ok" },
  offline: { box: "bg-bad-soft text-[#a43a2a]", dot: "bg-bad" },
  unconfigured: { box: "bg-wash text-mute", dot: "bg-mute/50" },
  checking: { box: "bg-wash text-mute", dot: "bg-mute/50 animate-pulse" },
};

export function StatusPill({ health, className }: { health: Health; className?: string }) {
  const p = PILL[health];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-bold", p.box, className)}>
      <span aria-hidden className={cn("size-2 rounded-full", p.dot)} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** Marks anything that is not measured. Used wherever demo numbers appear. */
export function SimBadge({ label = "Simulated", className }: { label?: string; className?: string }) {
  return (
    <span title="Sample data, not measured" className={cn("inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#8a5f00]", className)}>
      <FlaskConical className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function LiveBadge({ label = "Live check", className }: { label?: string; className?: string }) {
  return (
    <span title="Measured from this browser" className={cn("inline-flex items-center gap-1 rounded-full bg-great-soft px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#0b6b4c]", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-great" />
      {label}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />;
}

export function RefreshIcon({ spinning, className }: { spinning: boolean; className?: string }) {
  return <RefreshCw className={cn("size-4", spinning && "animate-spin", className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-line/70", className)} />;
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-full bg-wash text-mute">
        <Icon className="size-6" />
      </span>
      <h3 className="text-[15px] font-extrabold">{title}</h3>
      <p className="max-w-sm text-sm text-mute">{text}</p>
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", text, onRetry }: { title?: string; text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-full bg-bad-soft text-bad">
        <TriangleAlert className="size-6" />
      </span>
      <h3 className="text-[15px] font-extrabold">{title}</h3>
      <p className="max-w-sm text-sm text-mute">{text}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cn(btnOutline, "mt-2")}>
          Try again
        </button>
      )}
    </div>
  );
}

/** An accessible dialog: Escape and the backdrop close it, focus moves inside, and the page behind does not scroll. */
export function Modal({ open, onClose, title, children, wide, sheetOnMobile = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; sheetOnMobile?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
        if (!items.length) return;
        const [a, z] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={cn("fixed inset-0 z-50 flex justify-center", sheetOnMobile ? "items-end sm:items-center" : "items-center", "p-0 sm:p-6")} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-ink/45" tabIndex={-1} />
      <div ref={panel} tabIndex={-1} className={cn("sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-2xl outline-none", sheetOnMobile ? "rounded-t-[24px] sm:rounded-[24px]" : "rounded-[24px]", wide ? "sm:max-w-xl" : "sm:max-w-md")}>
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <button type="button" data-close onClick={onClose} aria-label="Close" className={btnIcon}>
            <X className="size-[18px]" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function FieldRow({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-bold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-err`} role="alert" className="text-xs font-semibold text-bad">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-mute">{hint}</p>
      )}
    </div>
  );
}
