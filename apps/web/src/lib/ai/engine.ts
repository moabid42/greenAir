/**
 * On-device AI: Qwen3-0.6B (GGUF, Q5_K_M) running in the browser through llama.cpp compiled to WebAssembly (wllama).
 * It uses WebGPU when the device has it and the CPU otherwise, so it works on any modern phone or laptop.
 * Nothing is sent to a server. The model is downloaded once, only when the user asks, and cached on the phone.
 *
 * This module is a small state machine plus the model's lifecycle. It must only be called in the browser.
 */
import { PREFIX } from "./prompt";
import type { Wllama } from "@wllama/wllama/esm/index.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Same Qwen3-0.6B weights as Qwen/Qwen3-0.6B-GGUF, but that repo only ships Q8_0; Unsloth publishes the Q5_K_M quantisation. */
export const MODEL_URL = "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q5_K_M.gguf";
const MODEL_FILE = "Qwen3-0.6B-Q5_K_M.gguf";
export const MODEL_NAME = "Qwen3-0.6B";
/** Everything the AI manages on the phone (model, chats) should stay under this. */
export const AI_STORAGE_CAP_BYTES = 1024 * 1024 * 1024;
/** Tokens the model may see at once, including its answer. */
export const CONTEXT_TOKENS = 4096;
/** The app puts the model to sleep this long after it goes to the background. */
const BACKGROUND_UNLOAD_MS = 45_000;

export type AIStatus =
  | "checking"
  | "unsupported"
  | "not_installed"
  | "downloading"
  | "loading"
  | "off"
  | "ready"
  | "generating"
  | "stopping"
  | "paused"
  | "error";

export interface AIState {
  status: AIStatus;
  /** 0–1 while downloading or loading. */
  progress: number;
  progressText: string;
  error: string | null;
  unsupportedReason: string | null;
  /** The model files are in the browser cache. */
  installed: boolean;
  /** Last generation only, in memory. Contains timing and counts, never chat text. */
  lastGeneration: { firstTextMs: number | null; totalMs: number; promptCharacters: number; stopped: boolean } | null;
}

const INITIAL: AIState = { status: "checking", progress: 0, progressText: "", error: null, unsupportedReason: null, installed: false, lastGeneration: null };

let state: AIState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<AIState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const getState = () => state;
export const getServerState = () => INITIAL;

// --- device ---------------------------------------------------------------------------------

interface GpuAdapterLike {
  info?: { description?: string; vendor?: string };
}
interface NavigatorGpu {
  requestAdapter: () => Promise<GpuAdapterLike | null>;
}

export type Backend = "webgpu" | "wasm";

export interface DeviceReport {
  ok: boolean;
  /** "webgpu" is fast; "wasm" runs on the CPU and is slower but works almost everywhere. */
  backend: Backend;
  webgpu: boolean;
  gpu: string | null;
  memoryGB: number | null;
  storageFreeMB: number | null;
  /** Plain-language problems that stop the AI from running. */
  blockers: string[];
  /** Things worth knowing that do not stop it. */
  notes: string[];
}

/** What a browser can honestly tell us. Battery, temperature and exact free RAM are not available here. */
export async function checkDevice(): Promise<DeviceReport> {
  const blockers: string[] = [];
  const notes: string[] = [];
  const gpuApi = (navigator as Navigator & { gpu?: NavigatorGpu }).gpu;

  let gpu: string | null = null;
  let webgpu = false;
  if (gpuApi) {
    try {
      const adapter = await gpuApi.requestAdapter();
      if (adapter) {
        webgpu = true;
        gpu = adapter.info?.description || adapter.info?.vendor || "Available";
      }
    } catch {
      /* fall back to the CPU */
    }
  }
  if (!webgpu) notes.push("No WebGPU here, so the AI will run on your processor. It works, just more slowly.");

  if (typeof WebAssembly === "undefined") blockers.push("This browser can't run WebAssembly, which the on-device AI needs.");

  const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  if (memoryGB != null && memoryGB < 2) blockers.push(`This device reports about ${memoryGB} GB of memory. The AI needs roughly 1.5 GB free.`);
  else if (memoryGB == null) notes.push("Your browser doesn't report memory, so we can't check it in advance.");

  let storageFreeMB: number | null = null;
  try {
    const est = await navigator.storage?.estimate();
    if (est?.quota != null && est.usage != null) {
      storageFreeMB = Math.round((est.quota - est.usage) / 1048576);
      if (storageFreeMB < 800) blockers.push(`Only about ${storageFreeMB} MB of free browser storage. The model needs roughly 650 MB.`);
    }
  } catch {
    notes.push("Couldn't read free storage.");
  }

  notes.push("Battery and temperature can't be checked from a browser. The app puts the AI to sleep when it goes to the background.");
  return { ok: blockers.length === 0, backend: webgpu ? "webgpu" : "wasm", webgpu, gpu, memoryGB, storageFreeMB, blockers, notes };
}

export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate();
    return est?.usage != null && est.quota != null ? { usage: est.usage, quota: est.quota } : null;
  } catch {
    return null;
  }
}

// --- lifecycle ------------------------------------------------------------------------------

const WASM = { default: "/wllama/wllama.wasm" };

let llama: Wllama | null = null;
let backend: Backend = "wasm";
let started = false;
let stopRequested = false;
let abort: AbortController | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | undefined;

async function create(): Promise<Wllama> {
  const { Wllama, LoggerWithoutDebug } = await import("@wllama/wllama/esm/index.js");
  return new Wllama(WASM, { suppressNativeLog: true, logger: LoggerWithoutDebug });
}

/** Is the model file already stored on this device? */
async function modelCached(): Promise<boolean> {
  try {
    const w = await create();
    return (await w.cacheManager.list()).some((e) => e.name.endsWith(MODEL_FILE) && e.size > 100 * 1024 * 1024);
  } catch {
    return false;
  }
}

/** Decides whether the AI can run here and whether the model is already downloaded. Safe to call many times. */
export async function initAI(): Promise<void> {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", onVisibility);
  const dev = await checkDevice();
  if (!dev.ok) {
    set({ status: "unsupported", unsupportedReason: dev.blockers.join(" ") });
    return;
  }
  backend = dev.backend;
  const installed = await modelCached();
  set({ installed, status: installed ? "off" : "not_installed" });
}

/** Downloads the file if needed, then loads it. Thinking mode is switched off at load time. */
async function startEngine(): Promise<void> {
  const w = await create();
  llama = w;
  const mb = (n: number) => Math.round(n / 1048576);
  await w.loadModelFromUrl(MODEL_URL, {
    n_ctx: CONTEXT_TOKENS,
    n_threads: (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1,
    n_gpu_layers: backend === "webgpu" ? 99 : 0,
    reasoning: false, // no "thinking" mode: answers start straight away
    reasoning_budget_tokens: 0,
    default_template_kwargs: { enable_thinking: false },
    progressCallback: ({ loaded, total }) => {
      if (!total) return;
      set({ progress: loaded / total, progressText: `${mb(loaded)} of ${mb(total)} MB`, status: state.installed ? "loading" : "downloading" });
    },
  });
  // Warm the fixed prefix; fresh reference records still require prefill on each turn.
  set({ status: "loading", progress: 1, progressText: "Warming up…" });
  await w.createChatCompletion({ messages: [...PREFIX, { role: "user", content: "hi" }], max_tokens: 1, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } });
  // The download is finished; what remains is loading it into memory.
  set({ installed: true, status: "loading", progress: 1, progressText: "Starting the model…" });
}

function fail(e: unknown) {
  void llama?.exit().catch(() => undefined);
  llama = null;
  const raw = e instanceof Error ? e.message : "";
  const memory = /memory|alloc|oom|buffer|webgpu|gpu/i.test(raw);
  set({
    status: "error",
    error: memory ? "This device ran out of memory loading the model. Close other tabs or apps and try again." : raw || "Something went wrong with the AI.",
  });
}

/** Downloads the model (once), checks it and loads it. Only ever called from a tap. */
export async function installModel(): Promise<void> {
  if (state.status !== "not_installed" && state.status !== "error") return;
  set({ status: "downloading", progress: 0, progressText: "Starting…", error: null });
  try {
    await startEngine();
    set({ installed: true, status: "ready", progress: 1 });
  } catch (e) {
    fail(e);
  }
}

/** Loads the already-downloaded model. */
export async function loadModel(): Promise<void> {
  if (state.status !== "off" && state.status !== "paused" && state.status !== "error") return;
  set({ status: "loading", progress: 0, progressText: "Waking the model…", error: null });
  try {
    await startEngine();
    set({ status: "ready", progress: 1 });
  } catch (e) {
    fail(e);
  }
}

/** Frees the memory the model holds. The downloaded file stays. */
export async function unloadModel(reason: "off" | "paused" = "off"): Promise<void> {
  clearTimeout(sleepTimer);
  abort?.abort();
  try {
    await llama?.exit();
  } catch {
    /* already gone */
  }
  llama = null;
  set({ status: state.installed ? reason : "not_installed", progress: 0, progressText: "" });
}

/** Deletes the model file from this phone. */
export async function removeModel(): Promise<void> {
  await unloadModel("off");
  try {
    const w = await create();
    await w.cacheManager.deleteMany((e) => e.name.endsWith(MODEL_FILE));
  } catch {
    /* nothing cached */
  }
  set({ installed: false, status: "not_installed" });
}

/** The app went to the background: after a short while, give the model's memory back. */
function onVisibility() {
  if (document.visibilityState === "hidden") {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      if (state.status === "ready") void unloadModel("paused");
    }, BACKGROUND_UNLOAD_MS);
  } else {
    clearTimeout(sleepTimer);
  }
}

/** Where the model runs, for showing the user. */
export const runsOn = () => (backend === "webgpu" ? "graphics chip" : "processor");

// --- chat -----------------------------------------------------------------------------------

/** Safety net: if a "<think>" block ever shows up, drop it. We only want the answer. */
function clean(t: string): string {
  return t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();
}

export async function generate(messages: ChatMessage[], onText: (text: string) => void): Promise<{ text: string; stopped: boolean }> {
  const w = llama;
  if (!w || state.status !== "ready") throw new Error("The AI isn't ready.");
  set({ status: "generating" });
  stopRequested = false;
  abort = new AbortController();
  let raw = "";
  const startedAt = performance.now();
  let firstTextMs: number | null = null;
  try {
    const stream = await w.createChatCompletion({
      messages,
      stream: true,
      abortSignal: abort.signal,
      max_tokens: 120, // short replies while retaining room for provenance and limitations
      temperature: 0.3, // low and a fixed seed keep the tone consistent from one answer to the next
      seed: 7,
      top_k: 20,
      top_p: 0.8,
      penalty_repeat: 1.1,
      chat_template_kwargs: { enable_thinking: false },
      cache_prompt: true, // fixed system prefix; reference records refresh on every turn
    });
    for await (const chunk of stream) {
      const piece = chunk.choices[0]?.delta?.content;
      if (piece) {
        raw += piece;
        const visible = clean(raw);
        if (visible && firstTextMs === null) firstTextMs = Math.round(performance.now() - startedAt);
        onText(visible);
      }
    }
  } catch (e) {
    if (!stopRequested) throw e; // stopping on purpose is not an error
  } finally {
    set({ lastGeneration: { firstTextMs, totalMs: Math.round(performance.now() - startedAt),
      promptCharacters: messages.reduce((n, m) => n + m.content.length, 0), stopped: stopRequested } });
    const now = getState().status; // read fresh: it changed while we were generating
    if (now === "generating" || now === "stopping") set({ status: llama ? "ready" : "off" });
  }
  return { text: clean(raw), stopped: stopRequested };
}

export async function stopGenerating(): Promise<void> {
  if (state.status !== "generating") return;
  stopRequested = true;
  set({ status: "stopping" });
  abort?.abort();
}
