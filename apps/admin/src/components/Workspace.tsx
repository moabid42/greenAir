"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { Endpoint } from "@/lib/types";
import { useAdmin } from "./AdminProvider";
import EndpointDetails from "./EndpointDetails";
import { EndpointDialog, RedirectDialog } from "./EndpointDialogs";
import { card, EmptyState, Modal } from "./ui";
import { MousePointerClick } from "lucide-react";

/** Tracks a CSS media query (false until the browser has been asked, so server and first client render agree). */
export function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Wide enough (1400 px) to show the details beside a table instead of in a sheet. */
export const WIDE_QUERY = "(min-width: 1400px)";
/** Big enough for the whole Overview to fit one screen, like the reference design. */
export const FIT_QUERY = "(min-width: 1360px) and (min-height: 720px)";

/** Dialog state for adding, editing and configuring the redirect of endpoints. */
export function useEndpointDialogs() {
  const a = useAdmin();
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "edit"; id: string } | { kind: "redirect"; id: string } | null>(null);
  const close = useCallback(() => setDialog(null), []);
  const find = (id: string): Endpoint | null => a.endpoints.find((e) => e.id === id) ?? null;

  const element: ReactNode = (
    <>
      <EndpointDialog open={dialog?.kind === "add" || dialog?.kind === "edit"} editing={dialog?.kind === "edit" ? find(dialog.id) : null} onClose={close} />
      <RedirectDialog open={dialog?.kind === "redirect"} endpoint={dialog?.kind === "redirect" ? find(dialog.id) : null} onClose={close} />
    </>
  );
  return {
    openAdd: () => setDialog({ kind: "add" }),
    openEdit: (ep: Endpoint) => setDialog({ kind: "edit", id: ep.id }),
    openRedirect: (ep: Endpoint) => setDialog({ kind: "redirect", id: ep.id }),
    element,
  };
}

/** The selected endpoint's details: a side panel on wide screens, a bottom sheet elsewhere. */
export function DetailsHost({ dialogs, className, query = WIDE_QUERY, compact = false }: { dialogs: ReturnType<typeof useEndpointDialogs>; className?: string; query?: string; compact?: boolean }) {
  const a = useAdmin();
  const wide = useMedia(query);
  const ep = a.endpoints.find((e) => e.id === a.selectedId) ?? null;
  const closeSheet = useCallback(() => a.setDetailOpen(false), [a]);

  return (
    <>
      <aside className={cn(card, "p-5", wide ? "block" : "hidden", className)} aria-label="Endpoint details">
        {ep ? (
          <EndpointDetails compact={compact} endpoint={ep} onEdit={() => dialogs.openEdit(ep)} onRedirect={() => dialogs.openRedirect(ep)} onClose={() => a.select(null)} />
        ) : (
          <EmptyState icon={MousePointerClick} title="Select an endpoint" text="Choose a row to see its URL, status, latency and uptime, and to edit it." />
        )}
      </aside>
      {!wide && ep && (
        <Modal open={a.detailOpen} onClose={closeSheet} title="Endpoint details">
          <EndpointDetails heading={false} endpoint={ep} onEdit={() => { closeSheet(); dialogs.openEdit(ep); }} onRedirect={() => { closeSheet(); dialogs.openRedirect(ep); }} />
        </Modal>
      )}
    </>
  );
}
