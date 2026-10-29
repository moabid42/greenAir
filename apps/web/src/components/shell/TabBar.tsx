"use client";

import { BarChart3, Bluetooth, Box, MapPin, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { type Tab, useApp } from "@/state/app";
import { cn } from "@/lib/cn";

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "today", label: "Today", icon: MapPin },
  { value: "explore", label: "Explore", icon: Box },
  { value: "coach", label: "Coach", icon: Sparkles },
  { value: "analytics", label: "Analytics", icon: BarChart3 },
  { value: "devices", label: "Devices", icon: Bluetooth },
  { value: "me", label: "Me", icon: UserRound },
];

/** Floating tab bar. The active tab expands to show its name. */
export default function TabBar() {
  const { tab, setTab } = useApp();
  return (
    <nav
      aria-label="Main"
      className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex h-[60px] items-stretch gap-1 rounded-[30px] bg-white/97 p-1.5 shadow-[0_8px_30px_rgb(22_44_41/0.22)]"
    >
      {TABS.map(({ value, label, icon: Icon }) => {
        const on = tab === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={on ? "page" : undefined}
            aria-label={label}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[24px] text-xs font-extrabold transition-all",
              on ? "flex-[2.2] bg-ink px-2 text-lime" : "flex-1 text-mute",
            )}
          >
            <Icon className={on ? "size-[18px]" : "size-[21px]"} aria-hidden />
            {on && label}
          </button>
        );
      })}
    </nav>
  );
}
