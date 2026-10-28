"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Cpu, Mic, Sparkles, SquarePen, Square } from "lucide-react";
import { buildMessages } from "@/lib/ai/context";
import { generate, getState as getAIState, stopGenerating } from "@/lib/ai/engine";
import { clearHistory, HISTORY_CLEARED_EVENT, loadHistory, saveHistory, type StoredMessage } from "@/lib/ai/history";
import { useAI } from "@/lib/ai/useAI";
import { buildFacts, answer, intentOf, type CoachAction, type CoachCard, type CoachCtx, type CoachReply } from "@/lib/coach/engine";
import { cn } from "@/lib/cn";
import { useApp } from "@/state/app";

interface Message extends StoredMessage {
  actions?: CoachAction[];
  /** The on-device AI is still writing this answer. */
  streaming?: boolean;
}

/** The browser's speech recognition, where it exists (Chrome, Safari). */
interface Recognizer {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognizerCtor = new () => Recognizer;
function speechCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const VERB = { run: "run", ride: "ride", walk: "walk" } as const;

function CardTile({ c }: { c: CoachCard }) {
  const tone = c.score >= 75 ? "bg-great-soft border-great" : c.score >= 45 ? "bg-ok-soft border-transparent" : "bg-bad-soft border-transparent";
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-[18px] border-[1.5px] px-3 py-2.5", tone)}>
      <span className="font-display text-[22px] font-extrabold leading-none" style={{ color: c.score >= 75 ? "#14653e" : c.score >= 45 ? "#7a5200" : "#9a3a12" }}>
        {c.score}
      </span>
      <span className="truncate text-[13px] font-extrabold">{c.title}</span>
      <span className="line-clamp-2 text-xs font-semibold text-mute">{c.sub}</span>
    </div>
  );
}

/** Ask anything about your sport. Answers come from the live data; the on-device AI (Qwen3-0.6B) adds natural wording when it is on. */
export default function CoachScreen({ active }: { active: boolean }) {
  const app = useApp();
  const { day, grid, today, date, activity, tune, home, prefs, setTab, setDate, openPlace, setHour, focusMap, addReminder, openSheet, showToast } = app;
  const ai = useAI();
  const verb = VERB[activity];
  const greeting = useMemo<Message>(
    () => ({
      id: 0,
      role: "coach",
      text: `Hi${prefs.name ? `, ${prefs.name}` : ""}! I know today's heat, air, wind and traffic in Heilbronn. Ask me when and where to ${verb}.`,
    }),
    [prefs.name, verb],
  );
  const [messages, setMessages] = useState<Message[]>(() => (prefs.saveChat ? loadHistory() : []));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const idRef = useRef(Math.max(0, ...messages.map((m) => m.id)) + 1);
  const recRef = useRef<Recognizer | null>(null);
  const canSpeak = useMemo(() => speechCtor() != null, []);

  const shown = messages.length ? messages : [greeting];
  const aiOn = ai.status === "ready" || ai.status === "generating" || ai.status === "stopping";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: ai.status === "generating" ? "auto" : "smooth" });
  }, [messages, busy, active, ai.status]);

  // Keep the conversation only if the user asked us to; deleting memories empties it.
  useEffect(() => {
    if (prefs.saveChat) saveHistory(messages.filter((m) => !m.streaming).map((m) => ({ id: m.id, role: m.role, text: m.text, cards: m.cards, note: m.note })));
  }, [messages, prefs.saveChat]);
  useEffect(() => {
    const onCleared = () => setMessages([]);
    window.addEventListener(HISTORY_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(HISTORY_CLEARED_EVENT, onCleared);
  }, []);

  const ctx = useMemo<CoachCtx | null>(() => {
    if (!day || !grid) return null;
    return {
      today,
      date,
      hourNow: new Date().getHours(),
      activity,
      tune,
      home,
      homeLabel: prefs.home ? (prefs.home.label === "My location" ? "near you" : prefs.home.label) : null,
      radiusKm: prefs.radiusKm,
      day,
      grid,
      airSensitive: prefs.airSensitive,
    };
  }, [day, grid, today, date, activity, tune, home, prefs.home, prefs.radiusKm, prefs.airSensitive]);

  const send = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || busy) return;
      setText("");
      const past = messages;
      setMessages((m) => [...(m.length ? m : [greeting]), { id: idRef.current++, role: "user", text: q }]);
      if (!ctx) {
        setMessages((m) => [...m, { id: idRef.current++, role: "coach", text: "I'm still loading today's data. Ask me again in a moment." }]);
        return;
      }
      setBusy(true);
      let reply: CoachReply;
      try {
        reply = await answer(q, ctx);
      } catch {
        reply = { text: "I couldn't read the data just now. Check your connection and try again." };
      }
      const id = idRef.current++;
      const base: Message = { id, role: "coach", text: reply.text, cards: reply.cards, actions: reply.actions, note: reply.note };

      // Data questions get the analyst's exact, instant answer. The on-device model handles conversation,
      // because a 0.6B model repeats numbers instead of reasoning about them.
      const chat = ["general", "greeting"].includes(intentOf(q));
      if (getAIState().status === "ready" && chat) {
        base.cards = undefined;
        base.actions = undefined;
        base.note = undefined;
        setMessages((m) => [...m, { ...base, text: "", streaming: true }]);
        try {
          const history = past.filter((m) => !m.cards?.length).slice(-2).map((m) => ({ role: m.role === "coach" ? ("assistant" as const) : ("user" as const), text: m.text }));
          const prompt = buildMessages({ question: q, facts: buildFacts(ctx, reply), memory: prefs.memory, history, mode: "chat" });
          const { text: out } = await generate(prompt, (t) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: t } : x))));
          // A tiny model sometimes returns just an emoji or a question mark. Never show that.
          const usable = out.replace(/[^\p{L}\p{N}]/gu, "").length >= 8;
          const fallback = "I'm not sure I got that. Try “best time today?”, “how's the air?” or “where's the coolest spot?”.";
          setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: usable ? out : fallback, streaming: false } : x)));
        } catch {
          setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: reply.text, streaming: false } : x)));
          showToast("The AI had a problem, so here's the built-in answer.");
        }
      } else {
        setMessages((m) => [...m, base]);
      }
      setBusy(false);
    },
    [busy, ctx, greeting, messages, prefs.memory, showToast],
  );

  const newChat = () => {
    if (ai.status === "generating") void stopGenerating();
    setMessages([]);
    if (prefs.saveChat) clearHistory();
    showToast("New chat started.");
  };

  const run = (a: CoachAction) => {
    switch (a.kind) {
      case "remind":
        void addReminder(new Date(a.at), a.title, a.body);
        break;
      case "map":
        setTab("today");
        focusMap(a.lngLat, 15.2);
        break;
      case "place":
        setTab("today");
        setHour(a.hour);
        openPlace(a.cellId);
        break;
      case "day":
        setDate(a.date);
        setTab("today");
        break;
      case "tab":
        setTab(a.tab);
        break;
    }
  };

  const toggleMic = () => {
    const Ctor = speechCtor();
    if (!Ctor) return showToast("Voice input isn't available in this browser.");
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const heard = e.results[0]?.[0]?.transcript;
      if (heard) void send(heard);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      showToast("I couldn't hear you. Check the microphone permission.");
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const chips = [`Best time today?`, `Can I ${verb} after work?`, `Where's the coolest spot?`, `How's the air for me?`, `Best day this week?`];
  const generating = ai.status === "generating" || ai.status === "stopping";

  return (
    <div className={cn("absolute inset-0 z-20 flex flex-col bg-ground pb-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)]", !active && "hidden")}>
      <div aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-[300px] w-[380px] rounded-full bg-[radial-gradient(closest-side,rgb(165_230_200/0.6),transparent)]" />

      <header className="relative flex items-center gap-3 px-4 pb-2" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
        <span aria-hidden className="grid size-11 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e6fbf1,#a5e6c8_45%,#14966f)] shadow-[0_6px_18px_rgb(125_179_60/0.4)]">
          <Sparkles className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <h1 className="font-display text-xl font-extrabold">Coach</h1>
          <span className="truncate text-xs font-bold text-mute">{day?.source === "mock" ? (aiOn ? "Private AI · simulated data" : "Answers from simulated data") : (aiOn ? "Private AI · on your phone" : "Answers from available data")}</span>
        </div>
        <button
          type="button"
          onClick={() => openSheet("ai")}
          aria-label="Private AI settings"
          className="flex h-11 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-extrabold shadow-sm"
        >
          <span aria-hidden className={cn("size-2 rounded-full", aiOn ? "bg-great" : ai.status === "downloading" || ai.status === "loading" ? "animate-pulse bg-ok" : "bg-mute/40")} />
          <Cpu className="size-4" aria-hidden />
          AI
        </button>
        <button
          type="button"
          onClick={newChat}
          disabled={messages.length === 0 && !busy}
          aria-label="New chat"
          title="New chat"
          className="grid size-11 place-items-center rounded-full bg-white shadow-sm disabled:opacity-40"
        >
          <SquarePen className="size-5" aria-hidden />
        </button>
      </header>

      <div className="relative mx-4 mb-2 flex items-center gap-1.5 rounded-[14px] bg-white px-3 py-2 text-xs font-bold text-mute shadow-sm">
        <span aria-hidden className="size-[7px] rounded-full bg-great" />
        {prefs.home?.label === "My location" ? "Near you" : (prefs.home?.label ?? "Heilbronn")} · {date === today ? "today" : date} · {verb}
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" aria-live="polite">
        <div className="flex flex-col gap-2.5 pb-3">
          {shown.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="max-w-[80%] self-end rounded-[22px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] font-semibold leading-snug text-white">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="flex flex-col gap-2.5 rounded-3xl bg-white p-3.5 shadow-sm">
                {m.text ? (
                  <p className="text-[15px] leading-snug">
                    {m.text}
                    {m.streaming && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-ink" />}
                  </p>
                ) : (
                  m.streaming && <p className="text-sm font-semibold text-mute">Thinking on your device…</p>
                )}
                {!m.streaming && m.cards && m.cards.length > 0 && <div className={cn("grid gap-2", m.cards.length > 1 ? "grid-cols-2" : "grid-cols-1")}>{m.cards.slice(0, 4).map((c, i) => <CardTile key={i} c={c} />)}</div>}
                {!m.streaming && m.actions && m.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.actions.map((a, i) => (
                      <button key={i} type="button" onClick={() => run(a)} className={cn("h-[38px] rounded-full px-3.5 text-[13px] font-extrabold", i === 0 ? "bg-lime" : "bg-wash")}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
                {!m.streaming && m.note && <p className="text-xs text-mute">{m.note}</p>}
              </div>
            ),
          )}
          {busy && !generating && (
            <div className="flex w-fit items-center gap-1.5 rounded-3xl bg-white px-4 py-3.5 shadow-sm" role="status" aria-label="Coach is typing">
              {[0, 1, 2].map((d) => (
                <span key={d} className="size-2 animate-bounce rounded-full bg-mute/60" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {ai.status === "paused" && (
        <button type="button" onClick={() => openSheet("ai")} className="relative mx-4 mb-2 rounded-2xl bg-ok-soft px-3.5 py-2.5 text-left text-xs font-bold text-[#7a5200]">
          The private AI went to sleep to save battery. Tap to wake it. Coach still answers meanwhile.
        </button>
      )}

      <div className="relative flex flex-col gap-2.5 px-4 pt-1">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {ai.status === "not_installed" && (
            <button type="button" onClick={() => openSheet("ai")} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-extrabold text-lime">
              <Cpu className="size-3.5" aria-hidden /> Set up private AI
            </button>
          )}
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => send(c)} disabled={busy} className="h-9 shrink-0 rounded-full border border-line bg-white px-3.5 text-[13px] font-bold disabled:opacity-50">
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="flex items-center gap-2"
        >
          <label className="flex h-[54px] min-w-0 flex-1 items-center rounded-[27px] border border-line bg-white px-[18px]">
            <span className="sr-only">Message Coach</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about your run…" maxLength={300} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-mute/70" />
          </label>
          {generating ? (
            <button type="button" onClick={() => void stopGenerating()} disabled={ai.status === "stopping"} aria-label="Stop generating" className="grid size-[54px] shrink-0 place-items-center rounded-full bg-bad text-white disabled:opacity-60">
              <Square className="size-[18px] fill-white" aria-hidden />
            </button>
          ) : text.trim() ? (
            <button type="submit" disabled={busy} aria-label="Send" className="grid size-[54px] shrink-0 place-items-center rounded-full bg-ink text-lime disabled:opacity-50">
              <ArrowUp className="size-[22px]" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleMic}
              disabled={!canSpeak}
              aria-label={listening ? "Stop listening" : "Talk to Coach"}
              aria-pressed={listening}
              className={cn(
                "grid size-[54px] shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e6fbf1,#a5e6c8_45%,#14966f)] shadow-[0_6px_20px_rgb(125_179_60/0.45)] disabled:opacity-40",
                listening && "animate-pulse ring-4 ring-lime/60",
              )}
            >
              <Mic className="size-[22px]" aria-hidden />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
