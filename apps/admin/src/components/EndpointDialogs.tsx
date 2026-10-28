"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { probeUrl } from "@/lib/probe";
import type { Category, Endpoint, Probe, Redirect, RedirectMode } from "@/lib/types";
import { CATEGORIES, type EndpointForm, validateEndpoint, validateRedirect } from "@/lib/validate";
import { useAdmin } from "./AdminProvider";
import { btnOutline, btnPrimary, field, FieldRow, Modal, Spinner } from "./ui";

const CATEGORY_LABEL: Record<Category, string> = {
  backend: "greenAir backend",
  environment: "Environmental data",
  weather: "Weather",
  air: "Air quality",
  wearable: "Wearables",
  geo: "Location and search",
  map: "Map",
  bike: "Cycling",
  other: "Other",
};

/** Add a new endpoint or edit an existing one. Everything is validated before it is saved. */
export function EndpointDialog({ open, editing, onClose }: { open: boolean; editing: Endpoint | null; onClose: () => void }) {
  if (!open) return null;
  return <EndpointDialogBody key={editing?.id ?? "new"} editing={editing} onClose={onClose} />;
}

function EndpointDialogBody({ editing, onClose }: { editing: Endpoint | null; onClose: () => void }) {
  const a = useAdmin();
  const [form, setForm] = useState<EndpointForm>({
    name: editing?.name ?? "",
    path: editing?.path ?? "",
    url: editing?.url ?? "",
    category: editing?.category ?? "other",
    note: editing?.note ?? "",
  });
  const [touched, setTouched] = useState<Partial<Record<keyof EndpointForm, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const errors = validateEndpoint(form, a.endpoints, editing?.id ?? null);
  const show = (k: keyof EndpointForm) => (submitted || touched[k] ? errors[k] : undefined);
  const set = <K extends keyof EndpointForm>(k: K, v: EndpointForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const blur = (k: keyof EndpointForm) => () => setTouched((t) => ({ ...t, [k]: true }));
  const describe = (k: keyof EndpointForm) => (show(k) ? `${k}-err` : undefined);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const result = editing ? a.updateEndpoint(editing.id, form) : a.addEndpoint(form);
    if (Object.keys(result).length === 0) onClose();
  };

  return (
    <Modal open onClose={onClose} title={editing ? "Edit endpoint" : "Add endpoint"} wide>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FieldRow label="Name" htmlFor="ep-name" error={show("name")}>
          <input id="ep-name" className={cn(field, show("name") && "border-bad")} value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} onBlur={blur("name")} placeholder="e.g. Pollen forecast" aria-invalid={!!show("name")} aria-describedby={describe("name")} autoComplete="off" />
        </FieldRow>
        <FieldRow label="URL" htmlFor="ep-url" error={show("url")} hint="Use {base} for your backend address (Settings) and {today} for today's date. No passwords or API keys: this admin stores them unencrypted in your browser.">
          <input id="ep-url" className={cn(field, "font-mono text-[13px]", show("url") && "border-bad")} value={form.url} onChange={(e) => set("url", e.target.value)} onBlur={blur("url")} placeholder="https://api.example.org/v1/pollen" inputMode="url" spellCheck={false} aria-invalid={!!show("url")} aria-describedby={describe("url")} autoComplete="off" />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Path label" htmlFor="ep-path" error={show("path")} hint="Optional. Taken from the URL if empty.">
            <input id="ep-path" className={cn(field, show("path") && "border-bad")} value={form.path} onChange={(e) => set("path", e.target.value)} onBlur={blur("path")} placeholder="/v1/pollen" spellCheck={false} aria-invalid={!!show("path")} aria-describedby={describe("path")} autoComplete="off" />
          </FieldRow>
          <FieldRow label="Category" htmlFor="ep-cat" error={show("category")}>
            <select id="ep-cat" className={field} value={form.category} onChange={(e) => set("category", e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>
        <FieldRow label="Note" htmlFor="ep-note" error={show("note")} hint="Optional. What it is for and who owns it.">
          <textarea id="ep-note" rows={2} className={cn(field, "h-auto py-2.5", show("note") && "border-bad")} value={form.note} maxLength={200} onChange={(e) => set("note", e.target.value)} onBlur={blur("note")} aria-describedby={describe("note")} />
        </FieldRow>
        <p className="flex gap-2 rounded-xl bg-wash px-3 py-2.5 text-xs text-mute">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Saved in this browser only. The endpoint is checked with a plain GET from here; it does not change what the EcoMAB web client calls.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={btnOutline}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary}>
            {editing ? "Save changes" : "Add endpoint"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const MODES: { id: RedirectMode; title: string; text: string }[] = [
  { id: "off", title: "Off", text: "Requests go to the endpoint only." },
  { id: "on-failure", title: "Fail over", text: "Send requests to the target while the endpoint is offline." },
  { id: "always", title: "Always", text: "Send every request to the target, for example during a migration." },
];

/** Redirect or fail-over target for an endpoint, with a test button for the target. */
export function RedirectDialog({ open, endpoint, onClose }: { open: boolean; endpoint: Endpoint | null; onClose: () => void }) {
  if (!open || !endpoint) return null;
  return <RedirectBody key={endpoint.id} endpoint={endpoint} onClose={onClose} />;
}

function RedirectBody({ endpoint, onClose }: { endpoint: Endpoint; onClose: () => void }) {
  const a = useAdmin();
  const [r, setR] = useState<Redirect>({ ...endpoint.redirect });
  const [submitted, setSubmitted] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Probe | null>(null);

  const errors = validateRedirect(r, endpoint.url);
  const err = submitted || r.target ? errors.target : undefined;

  const test = async () => {
    setSubmitted(true);
    if (errors.target) return;
    setTesting(true);
    setResult(await probeUrl(r.target.trim(), a.settings.timeoutMs));
    setTesting(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(a.setRedirect(endpoint.id, r)).length === 0) onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Redirect · ${endpoint.name}`} wide>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-bold">When should requests go to the target?</legend>
          {MODES.map((m) => (
            <label key={m.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", r.mode === m.id ? "border-brand bg-great-soft/50" : "border-line")}>
              <input type="radio" name="mode" className="mt-1 accent-[#075b4a]" checked={r.mode === m.id} onChange={() => setR((x) => ({ ...x, mode: m.id }))} />
              <span>
                <span className="block text-sm font-bold">{m.title}</span>
                <span className="block text-xs text-mute">{m.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <FieldRow label="Target URL" htmlFor="rd-target" error={r.mode === "off" ? undefined : err} hint={r.mode === "off" ? "Not used while the redirect is off." : "A full http(s) URL, different from the endpoint. https is recommended."}>
          <input
            id="rd-target"
            className={cn(field, "font-mono text-[13px]", r.mode !== "off" && err && "border-bad")}
            value={r.target}
            disabled={r.mode === "off"}
            onChange={(e) => {
              setR((x) => ({ ...x, target: e.target.value }));
              setResult(null);
            }}
            placeholder="https://backup.example.org/api/v1/day"
            inputMode="url"
            spellCheck={false}
            aria-invalid={r.mode !== "off" && !!err}
            aria-describedby={r.mode !== "off" && err ? "rd-target-err" : undefined}
            autoComplete="off"
          />
        </FieldRow>
        {r.mode !== "off" && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={test} disabled={testing} className={btnOutline}>
              {testing && <Spinner />} Test target
            </button>
            {result && (
              <p role="status" className={cn("text-sm font-bold", result.ok ? "text-great" : "text-bad")}>
                {result.ok ? `Reachable · ${fmtMs(result.ms)}${result.opaque ? " (status hidden by CORS)" : ""}` : `Not reachable · ${result.error}`}
              </p>
            )}
          </div>
        )}
        <p className="flex gap-2 rounded-xl bg-ok-soft px-3 py-2.5 text-xs text-[#8a5f00]">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Saved in this browser only. The EcoMAB web client has fixed addresses and does not read this setting, so saving it does not change what users get. It records your plan.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={btnOutline}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary}>
            Save redirect
          </button>
        </div>
      </form>
    </Modal>
  );
}
