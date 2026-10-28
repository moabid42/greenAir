import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: ReactNode;
  className?: string;
}

/** A labelled switch row. The whole row is the tap target. */
export default function Toggle({ checked, onChange, title, hint, className }: ToggleProps) {
  return (
    <label className={cn("flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2.5", className)}>
      <span className="flex-1">
        <span className="block text-[13px] font-bold">{title}</span>
        {hint && <span className="block text-xs text-mute">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-[3px] transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand",
          checked ? "justify-end bg-ink" : "justify-start bg-line",
        )}
      >
        <span className={cn("size-5 rounded-full transition-colors", checked ? "bg-lime" : "bg-white")} />
      </span>
    </label>
  );
}
