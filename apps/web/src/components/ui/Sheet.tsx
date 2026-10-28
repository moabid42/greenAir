"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** A bottom sheet over the app. Closes on backdrop tap, the X button or Escape. */
export default function Sheet({ open, onClose, title, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="sheet-fade absolute inset-0 bg-ink/45" />
      <div
        ref={panel}
        tabIndex={-1}
        className="sheet-up relative flex max-h-[88%] flex-col rounded-t-[28px] bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgb(22_44_41/0.25)] outline-none"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-wash">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">{children}</div>
      </div>
    </div>
  );
}
