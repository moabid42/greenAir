"use client";

import { useRef, useState, type ReactNode } from "react";
import { Download, RotateCcw, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useAdmin } from "@/components/AdminProvider";
import { RANGES } from "@/components/RangeSelect";
import { btnOutline, btnPrimary, card, field, FieldRow, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { download } from "@/lib/csv";
import type { Settings } from "@/lib/types";
import { type Errors, hasErrors, validateSettings } from "@/lib/validate";

function Section({ id, title, text, children }: { id?: string; title: string; text?: string; children: ReactNode }) {
  return (
    <section id={id} className={cn(card, "scroll-mt-6 p-5 sm:p-6")} aria-labelledby={`${id ?? title}-h`}>
      <h2 id={`${id ?? title}-h`} className="font-display text-lg font-extrabold">{title}</h2>
      {text && <p className="mt-0.5 text-sm text-mute">{text}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SettingsForm() {
  const a = useAdmin();
  const [draft, setDraft] = useState<Settings>({ ...a.settings });
  const [errors, setErrors] = useState<Errors<keyof Settings>>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(a.settings);
  const live = validateSettings(draft);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors({});
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const result = a.saveSettings(draft);
    setErrors(result);
    if (!hasErrors(result)) setDraft((d) => ({ ...d, backendUrl: d.backendUrl.trim().replace(/\/$/, "") }));
  };
  // Show a problem as soon as the field was changed, not only after pressing Save.
  const err = (k: keyof Settings) => errors[k] ?? (draft[k] !== a.settings[k] ? live[k] : undefined);

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <FieldRow label="greenAir backend URL" htmlFor="st-base" error={err("backendUrl")} hint="The address the EcoMAB web client uses (NEXT_PUBLIC_API_URL). Leave empty while there is no backend: its endpoints then show as Not configured instead of failing.">
        <input id="st-base" className={cn(field, "font-mono text-[13px]", err("backendUrl") && "border-bad")} value={draft.backendUrl} onChange={(e) => set("backendUrl", e.target.value)} placeholder="http://localhost:8000" inputMode="url" spellCheck={false} autoComplete="off" aria-invalid={!!err("backendUrl")} aria-describedby={err("backendUrl") ? "st-base-err" : undefined} />
      </FieldRow>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldRow label="Check every" htmlFor="st-int">
          <select id="st-int" className={field} value={draft.intervalSec} onChange={(e) => set("intervalSec", Number(e.target.value) as Settings["intervalSec"])}>
            <option value={0}>Manually only</option>
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute</option>
            <option value={300}>5 minutes</option>
          </select>
        </FieldRow>
        <FieldRow label="Timeout (seconds)" htmlFor="st-to" error={err("timeoutMs")}>
          <input id="st-to" type="number" min={1} max={30} step={1} className={cn(field, err("timeoutMs") && "border-bad")} value={draft.timeoutMs / 1000} onChange={(e) => set("timeoutMs", Math.round(Number(e.target.value) * 1000))} aria-invalid={!!err("timeoutMs")} aria-describedby={err("timeoutMs") ? "st-to-err" : undefined} />
        </FieldRow>
        <FieldRow label="Slow above (ms)" htmlFor="st-slow" error={err("degradedMs")} hint="Slower than this = Degraded.">
          <input id="st-slow" type="number" min={100} step={100} className={cn(field, err("degradedMs") && "border-bad")} value={draft.degradedMs} onChange={(e) => set("degradedMs", Number(e.target.value))} aria-invalid={!!err("degradedMs")} aria-describedby={err("degradedMs") ? "st-slow-err" : undefined} />
        </FieldRow>
      </div>
      <FieldRow label="Default date range" htmlFor="st-range" hint="Used for the summary cards and charts when the admin opens.">
        <select id="st-range" className={cn(field, "sm:max-w-[220px]")} value={draft.defaultRange} onChange={(e) => set("defaultRange", Number(e.target.value) as Settings["defaultRange"])}>
          {RANGES.map((r) => <option key={r} value={r}>Last {r} days</option>)}
        </select>
      </FieldRow>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={!dirty || hasErrors(live)}>Save settings</button>
        <button type="button" className={btnOutline} onClick={() => setDraft({ ...a.settings })} disabled={!dirty}>Discard changes</button>
        {hasErrors(live) && dirty && <p role="status" className="text-sm font-semibold text-bad">Fix the highlighted fields to save.</p>}
      </div>
    </form>
  );
}

function ConfigTools() {
  const a = useAdmin();
  const file = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<"reset" | "history" | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 500_000) throw new Error("This file is too large to be an admin configuration.");
      a.importConfig(await f.text());
    } catch (e) {
      a.notify(e instanceof Error ? e.message : "Could not import this file.", "error");
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const danger = (kind: "reset" | "history", label: string, icon: ReactNode, run: () => void) =>
    confirm === kind ? (
      <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-bad px-4 text-sm font-bold text-white" onClick={() => { run(); setConfirm(null); }} onBlur={() => setConfirm(null)} autoFocus>
        Tap again to confirm
      </button>
    ) : (
      <button type="button" className={cn(btnOutline, "text-[#a43a2a]")} onClick={() => setConfirm(kind)}>{icon} {label}</button>
    );

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btnOutline} onClick={() => download("ecomab-admin-config.json", a.exportConfig(), "application/json")}>
        <Download className="size-4" aria-hidden /> Export configuration
      </button>
      <button type="button" className={btnOutline} onClick={() => file.current?.click()}>
        <Upload className="size-4" aria-hidden /> Import configuration
      </button>
      <input ref={file} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Choose a configuration file" onChange={(e) => void onFile(e.target.files?.[0])} />
      {danger("history", "Clear check history", <Trash2 className="size-4" aria-hidden />, a.clearHistory)}
      {danger("reset", "Restore default endpoints", <RotateCcw className="size-4" aria-hidden />, a.resetEndpoints)}
    </div>
  );
}

export default function SettingsPage() {
  const a = useAdmin();
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <header>
        <h1 className="font-display text-[32px] font-extrabold leading-tight sm:text-[38px]">Settings</h1>
        <p className="mt-1 text-[15px] text-mute">How the admin checks endpoints, and what it keeps in this browser.</p>
      </header>

      <Section title="Data source and checks" text="Applies to every endpoint check.">
        {a.ready ? <SettingsForm key={JSON.stringify(a.settings)} /> : <Skeleton className="h-64" />}
      </Section>

      <Section title="Configuration" text="Your endpoints, redirects and settings (not the check history). Share them as a file; there is no server to sync them.">
        <ConfigTools />
      </Section>

      <Section id="access" title="Access and privacy">
        <div role="note" className="flex gap-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-[#8d2f21]">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            <b>This admin is not access-protected.</b> There is no sign-in, no roles and no server-side check: anyone who can open this address can see and change everything here. Keep it on a private network or behind an authenticating proxy until real access control exists. Nothing in the project enforces it today.
          </p>
        </div>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-sm text-mute">
          <li><b className="text-ink">Where things are stored.</b> Settings, endpoints and check history live in this browser&apos;s local storage: not encrypted, not shared between people or devices, and lost if you clear site data.</li>
          <li><b className="text-ink">Where checks come from.</b> Every check is a plain GET from your browser, so it measures what you can reach from here, not what users or a server see. Real monitoring should run on a server.</li>
          <li><b className="text-ink">Secrets.</b> URLs with passwords or API keys are refused, because they would be stored unencrypted. Keep credentials on the server.</li>
          <li><b className="text-ink">Changes are local.</b> Editing an endpoint or its redirect here does not change what the EcoMAB web client calls.</li>
          <li><b className="text-ink">Client data.</b> The Source data page reads stored provider counts and processing status from the backend. Client uploads and request analytics are unavailable.</li>
        </ul>
      </Section>
    </div>
  );
}
