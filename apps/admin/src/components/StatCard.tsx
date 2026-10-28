import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { card, SimBadge } from "./ui";

export interface Delta {
  /** Signed change; null = no comparison available. */
  value: number | null;
  /** "%" for relative change, "" for plain counts. */
  unit: string;
  /** What it is compared with, e.g. "vs. previous 30 days". */
  versus: string;
  /** Is a rise good news? Healthy up = good; degraded up = bad. */
  upIsGood?: boolean;
}

export function StatCard({ icon: Icon, tint, label, value, outOf, delta, simulated, note, dense }: { icon: LucideIcon; tint: string; label: string; value: string; outOf?: string; delta: Delta; simulated?: boolean; note?: string; dense?: boolean }) {
  const v = delta.value;
  const good = v == null || v === 0 ? null : (v > 0) === (delta.upIsGood ?? true);
  return (
    <div className={cn(card, "flex items-center gap-3.5", dense ? "gap-3 p-3" : "p-4 sm:p-5")}>
      <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full", dense ? "size-11" : "size-12 sm:size-14", tint)}>
        <Icon className={cn(dense ? "size-5" : "size-6 sm:size-7")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-mute", dense ? "text-[13px]" : "text-[15px]")}>{label}</p>
        <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-0">
          <p className={cn("font-display font-extrabold leading-tight", dense ? "text-[26px]" : "text-[32px]")}>
            {value}
            {outOf && <span className="text-[20px] font-semibold text-mute"> / {outOf}</span>}
          </p>
          <p className={cn("pb-1 leading-tight text-mute sm:text-right", dense ? "text-[11px]" : "text-xs")}>
            {v == null ? (
              <span>{delta.versus}</span>
            ) : (
              <>
                <span className={cn("inline-flex items-center gap-0.5 text-[13px] font-extrabold", good === null ? "text-mute" : good ? "text-great" : "text-bad")}>
                  {v === 0 ? <Minus className="size-3" aria-hidden /> : v > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
                  {v === 0 ? "± 0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}${delta.unit}`}
                </span>
                <br />
                {delta.versus}
              </>
            )}
          </p>
        </div>
        {simulated && <SimBadge className="mt-0.5 px-2 py-0.5 text-[9px]" />}
        {note && <p className={cn("text-mute", dense ? "text-[11px]" : "text-xs")}>{note}</p>}
      </div>
    </div>
  );
}
