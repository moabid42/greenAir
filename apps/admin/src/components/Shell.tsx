"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Database, House, Settings, ShieldAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/format";
import { useAdmin } from "./AdminProvider";
import { Wordmark, Logo } from "./ui";
import { type ReactNode, useEffect, useState } from "react";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Overview", icon: House },
  { href: "/endpoints", label: "Endpoints", icon: Database },
  { href: "/client-data", label: "Client data", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
}

/** Re-renders every 15 s so "2 minutes ago" stays honest. */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Sidebar() {
  const active = useActive();
  const { settings, lastRunAt } = useAdmin();
  const now = useNow();
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line/70 bg-white/55 px-3 py-6 backdrop-blur md:flex lg:px-5" aria-label="Admin navigation">
      <Link href="/" className="flex items-center gap-2 px-1 lg:px-2" aria-label="EcoMAB admin overview">
        <span className="lg:hidden">
          <Logo size={44} />
        </span>
        <span className="hidden lg:block">
          <Wordmark size={46} />
        </span>
      </Link>
      <nav className="flex flex-col gap-1.5 lg:mt-3" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = active(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              title={label}
              className={cn("flex h-12 items-center justify-center gap-3 rounded-2xl text-[15px] font-bold transition-colors lg:justify-start lg:px-4", on ? "bg-brand text-white" : "text-ink hover:bg-great-soft")}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="hidden lg:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden flex-col gap-2 rounded-2xl bg-wash p-3.5 text-xs text-mute lg:flex">
        <p className="font-bold text-ink">Health checks</p>
        <p>{settings.intervalSec ? `Every ${settings.intervalSec >= 60 ? `${settings.intervalSec / 60} min` : `${settings.intervalSec} s`}` : "Manual only"} · last run {lastRunAt ? ago(lastRunAt, now) : "not yet"}</p>
        <Link href="/settings#access" className="mt-1 inline-flex items-center gap-1.5 font-bold text-[#a43a2a]">
          <ShieldAlert className="size-3.5" aria-hidden /> No sign-in protection
        </Link>
      </div>
    </aside>
  );
}

function MobileBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line/70 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
      <Wordmark size={34} />
      <Link href="/settings#access" className="inline-flex items-center gap-1.5 rounded-full bg-bad-soft px-2.5 py-1.5 text-[11px] font-extrabold text-[#a43a2a]">
        <ShieldAlert className="size-3.5" aria-hidden /> No sign-in
      </Link>
    </header>
  );
}

function BottomNav() {
  const active = useActive();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line/70 bg-white/95 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur md:hidden">
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = active(href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={cn("flex min-h-[54px] flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold", on ? "text-brand" : "text-mute")}>
            <span className={cn("grid h-7 w-12 place-items-center rounded-full", on && "bg-great-soft")}>
              <Icon className="size-5" aria-hidden />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** A faint street-map motif behind the page header, like the reference. Purely decorative. */
function MapBackdrop() {
  return (
    <svg aria-hidden viewBox="0 0 640 260" preserveAspectRatio="xMaxYMin slice" className="pointer-events-none absolute right-0 top-0 hidden h-[260px] w-[640px] max-w-full opacity-70 md:block" style={{ maskImage: "linear-gradient(to left, black 25%, transparent 95%)", WebkitMaskImage: "linear-gradient(to left, black 25%, transparent 95%)" }}>
      <g fill="#d9edd9">
        <ellipse cx="520" cy="60" rx="70" ry="46" />
        <ellipse cx="330" cy="190" rx="60" ry="34" />
        <ellipse cx="610" cy="210" rx="80" ry="40" />
      </g>
      <path d="M250 -10 C 300 60, 360 70, 400 120 S 470 200, 520 280" fill="none" stroke="#cfe6f3" strokeWidth="26" strokeLinecap="round" />
      <g fill="none" stroke="#f1eec6" strokeWidth="9" strokeLinecap="round">
        <path d="M420 -10 C 470 40, 560 30, 660 90" />
        <path d="M200 140 C 300 120, 380 150, 470 130 S 600 120, 660 150" />
      </g>
      <g fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.9">
        <path d="M330 -10 L 380 120 L 360 270" />
        <path d="M560 -10 L 540 120 L 600 270" />
      </g>
    </svg>
  );
}

function Toast() {
  const { toast } = useAdmin();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 md:bottom-6" aria-live="polite" role="status">
      {toast && <span className={cn("rounded-2xl px-4 py-2.5 text-center text-sm font-bold text-white shadow-xl", toast.tone === "error" ? "bg-bad" : "bg-ink")}>{toast.msg}</span>}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { persistFailed } = useAdmin();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[76px_1fr] lg:grid-cols-[240px_1fr]">
      <Sidebar />
      <div className="relative min-w-0">
        <MapBackdrop />
        <MobileBar />
        {persistFailed && <p role="alert" className="mx-4 mt-3 rounded-xl bg-ok-soft px-3 py-2 text-xs font-semibold text-[#8a5f00] md:mx-8">This browser would not save the admin&apos;s settings (storage is full or blocked). Changes last until you close the tab.</p>}
        <main className="relative px-4 pb-28 pt-5 md:px-8 md:pb-6 md:pt-6">{children}</main>
      </div>
      <BottomNav />
      <Toast />
    </div>
  );
}
