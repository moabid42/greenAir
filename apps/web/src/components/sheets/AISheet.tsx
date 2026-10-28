"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Cpu, Download, HardDrive, Lock, Power, Trash2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Toggle from "@/components/ui/Toggle";
import { checkDevice, installModel, loadModel, removeModel, storageUsage, unloadModel, AI_STORAGE_CAP_BYTES, MODEL_NAME, type AIStatus, type DeviceReport } from "@/lib/ai/engine";
import { clearHistory } from "@/lib/ai/history";
import { useAI } from "@/lib/ai/useAI";
import { cn } from "@/lib/cn";
import { EMPTY_MEMORY } from "@/lib/prefs";
import { useApp } from "@/state/app";

const STATUS_LABEL: Record<AIStatus, string> = {
  checking: "Checking your device…",
  unsupported: "Not available on this device",
  not_installed: "Not installed",
  downloading: "Downloading…",
  loading: "Waking up…",
  off: "Off",
  ready: "Ready",
  generating: "Answering…",
  stopping: "Stopping…",
  paused: "Asleep to save battery",
  error: "Something went wrong",
};

const DOT: Partial<Record<AIStatus, string>> = { ready: "bg-great", generating: "bg-great", downloading: "bg-ok", loading: "bg-ok", stopping: "bg-ok", error: "bg-bad", unsupported: "bg-bad" };

const mb = (b: number) => (b >= 1048576 * 100 ? `${(b / 1073741824).toFixed(2)} GB` : `${Math.round(b / 1048576)} MB`);

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-10 rounded-full px-3.5 text-[13px]", on ? "bg-ink font-extrabold text-white" : "border border-line font-bold")}>
      {children}
    </button>
  );
}

/** Private AI: opt in, download Qwen3-0.6B, and control what it stores. Everything stays on this device. */
export default function AISheet() {
  const { sheet, closeSheet, prefs, update, showToast } = useApp();
  const ai = useAI();
  const open = sheet === "ai";
  const [device, setDevice] = useState<DeviceReport | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!open) return;
    void checkDevice().then(setDevice);
    void storageUsage().then(setUsage);
  }, [open, ai.status]);

  const busy = ai.status === "downloading" || ai.status === "loading";
  const awake = ai.status === "ready" || ai.status === "generating" || ai.status === "stopping";
  const pct = Math.round(ai.progress * 100);
  const used = usage?.usage ?? 0;
  const over = used > AI_STORAGE_CAP_BYTES;
  const mem = prefs.memory;

  const deleteMemories = () => {
    update({ memory: EMPTY_MEMORY, saveChat: false });
    clearHistory();
    showToast("Everything the Coach remembered is deleted.");
  };

  return (
    <Sheet open={open} onClose={closeSheet} title="Private AI">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-start gap-3 rounded-2xl bg-great-soft p-3.5">
          <Lock className="mt-0.5 size-5 shrink-0 text-[#14653e]" aria-hidden />
          <div className="text-[13px] leading-snug text-[#14653e]">
            <b>{MODEL_NAME} runs on your device.</b> Your questions and chats never leave your phone, and nothing is sent to a cloud AI. It’s optional: Coach works without it.
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded-2xl border border-line px-3.5 py-3">
          <span aria-hidden className={cn("size-2.5 rounded-full", DOT[ai.status] ?? "bg-mute/50", (busy || ai.status === "generating") && "animate-pulse")} />
          <span className="flex-1 text-sm font-extrabold">{STATUS_LABEL[ai.status]}</span>
          <Cpu className="size-4 text-mute" aria-hidden />
        </div>

        {ai.status === "unsupported" && (
          <div className="rounded-2xl bg-bad-soft p-3.5 text-[13px] leading-snug text-[#9a3a12]">
            <p className="font-extrabold">This device can’t run the on-device AI.</p>
            <p className="mt-1">{ai.unsupportedReason}</p>
            <p className="mt-1.5 font-semibold">Coach still answers every question from your live data without it.</p>
          </div>
        )}

        {ai.status === "not_installed" && (
          <>
            {device && (
              <ul className="flex flex-col gap-1.5 rounded-2xl border border-line p-3.5 text-[13px]">
                <li className="flex items-center gap-2 font-bold">
                  <Check className="size-4 text-great" aria-hidden /> {device.webgpu ? `Runs on your graphics chip (${device.gpu ?? "WebGPU"})` : "Runs on your processor (slower, but works)"}
                </li>
                {device.memoryGB != null && (
                  <li className="flex items-center gap-2 font-bold">
                    <Check className="size-4 text-great" aria-hidden /> Memory: about {device.memoryGB} GB
                  </li>
                )}
                {device.storageFreeMB != null && (
                  <li className="flex items-center gap-2 font-bold">
                    <Check className="size-4 text-great" aria-hidden /> Free storage: {device.storageFreeMB.toLocaleString()} MB
                  </li>
                )}
                {device.notes.map((n) => (
                  <li key={n} className="text-xs font-semibold text-mute">{n}</li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => void installModel()} className="flex h-[54px] items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-extrabold text-lime">
              <Download className="size-[18px]" aria-hidden />
              Download {MODEL_NAME} (about 0.45 GB)
            </button>
            <p className="-mt-2 text-xs font-semibold text-mute">Downloaded once, from Hugging Face, then kept on your phone. Wi-Fi recommended.</p>
          </>
        )}

        {busy && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-3.5" role="status">
            <div className="flex items-baseline justify-between text-[13px] font-extrabold">
              <span>{ai.status === "downloading" ? "Downloading and checking the model" : "Loading the model"}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <span className="block h-2 overflow-hidden rounded-full bg-wash">
              <span className="block h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </span>
            <p className="line-clamp-2 text-xs font-semibold text-mute">{ai.progressText}</p>
            <p className="text-xs font-semibold text-mute">Keep this page open until it’s ready.</p>
          </div>
        )}

        {ai.status === "paused" && (
          <div className="flex gap-2.5 rounded-2xl bg-ok-soft p-3.5 text-[13px] font-semibold text-[#7a5200]">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            The AI went to sleep while the app was in the background, to save battery and memory.
          </div>
        )}

        {(ai.status === "off" || ai.status === "paused") && (
          <button type="button" onClick={() => void loadModel()} className="flex h-[54px] items-center justify-center gap-2 rounded-2xl bg-ink text-[15px] font-extrabold text-lime">
            <Power className="size-[18px]" aria-hidden />
            Turn on the AI
          </button>
        )}

        {awake && (
          <button type="button" onClick={() => void unloadModel("off")} disabled={ai.status !== "ready"} className="flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-wash text-sm font-extrabold disabled:opacity-50">
            <Power className="size-4" aria-hidden />
            Turn off to free memory
          </button>
        )}

        {ai.status === "error" && (
          <div className="rounded-2xl bg-bad-soft p-3.5 text-[13px] leading-snug text-[#9a3a12]">
            <p className="font-extrabold">The AI hit a problem.</p>
            <p className="mt-1 break-words">{ai.error}</p>
            <button type="button" onClick={() => void (ai.installed ? loadModel() : installModel())} className="mt-3 h-11 rounded-xl bg-ink px-5 text-sm font-extrabold text-lime">
              Try again
            </button>
          </div>
        )}

        {ai.status !== "unsupported" && ai.status !== "checking" && (
          <section aria-labelledby="mem">
            <h3 id="mem" className="mb-1.5 text-[11px] font-extrabold tracking-[0.12em] text-mute">WHAT THE COACH REMEMBERS ABOUT YOU</h3>
            <div className="divide-y divide-wash overflow-hidden rounded-[20px] border border-line">
              <Toggle checked={mem.parks} onChange={(v) => update({ memory: { ...mem, parks: v } })} title="I prefer parks" />
              <Toggle checked={mem.avoidBusy} onChange={(v) => update({ memory: { ...mem, avoidBusy: v } })} title="Avoid busy streets" />
              <Toggle checked={mem.flat} onChange={(v) => update({ memory: { ...mem, flat: v } })} title="I prefer flat routes" />
              <div className="flex flex-col gap-2 px-4 py-3">
                <span className="text-[13px] font-bold">Usual distance</span>
                <div className="flex flex-wrap gap-1.5">
                  {[null, 3, 5, 10].map((d) => (
                    <Chip key={String(d)} on={mem.distanceKm === d} onClick={() => update({ memory: { ...mem, distanceKm: d } })}>
                      {d ? `${d} km` : "No preference"}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                <span className="text-[13px] font-bold">Preferred time of day</span>
                <div className="flex flex-wrap gap-1.5">
                  {([null, "morning", "midday", "evening"] as const).map((h) => (
                    <Chip key={String(h)} on={mem.hours === h} onClick={() => update({ memory: { ...mem, hours: h } })}>
                      {h ? h[0].toUpperCase() + h.slice(1) : "No preference"}
                    </Chip>
                  ))}
                </div>
              </div>
              <Toggle
                checked={prefs.saveChat}
                onChange={(v) => {
                  update({ saveChat: v });
                  if (!v) clearHistory();
                }}
                title="Keep my conversation on this phone"
                hint="Saved in the browser, which is not encrypted. The native app will use encrypted storage."
              />
            </div>
            <p className="mt-1.5 px-1 text-[11px] font-semibold text-mute">Today’s weather and air readings are never remembered. Only what you choose here.</p>
            <button type="button" onClick={deleteMemories} className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-wash text-[13px] font-extrabold">
              <Trash2 className="size-4" aria-hidden />
              Delete everything the Coach remembers
            </button>
          </section>
        )}

        {ai.status !== "unsupported" && ai.status !== "checking" && (
          <section aria-labelledby="stor">
            <h3 id="stor" className="mb-1.5 text-[11px] font-extrabold tracking-[0.12em] text-mute">AI STORAGE</h3>
            <div className="rounded-2xl border border-line p-3.5">
              <div className="flex items-center gap-2 text-[13px] font-extrabold">
                <HardDrive className="size-4" aria-hidden />
                <span className="flex-1">{usage ? mb(used) : "Unknown"} of {mb(AI_STORAGE_CAP_BYTES)}</span>
              </div>
              <span className="mt-2 block h-2 overflow-hidden rounded-full bg-wash">
                <span className={cn("block h-full rounded-full", over ? "bg-bad" : "bg-ink")} style={{ width: `${Math.min(100, (used / AI_STORAGE_CAP_BYTES) * 100)}%` }} />
              </span>
              <p className="mt-2 text-xs font-semibold text-mute">
                {over ? "Over the 1 GB limit. Remove the model to free space. " : ""}Everything SweetSpot keeps on this device: the model, saved places and chats.
              </p>
              {ai.installed && (
                <button
                  type="button"
                  onClick={() => (confirmRemove ? void removeModel().then(() => { setConfirmRemove(false); showToast("The model is removed from this phone."); }) : setConfirmRemove(true))}
                  disabled={busy || ai.status === "generating"}
                  className={cn("mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-extrabold disabled:opacity-50", confirmReset(confirmRemove))}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {confirmRemove ? "Tap again to remove the model" : `Remove ${MODEL_NAME} from this phone`}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}

const confirmReset = (confirming: boolean) => (confirming ? "bg-bad-soft text-[#9a3a12]" : "bg-wash");
