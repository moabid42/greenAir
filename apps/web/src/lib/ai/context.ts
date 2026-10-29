import { includesCategory, selectData } from "./selection";
import type { ChatMessage } from "./engine";
import type { CoachMemory } from "@/lib/prefs";
import { CONTEXT_TOKENS } from "./engine";

/** Conservative estimate for JSON-heavy data; leave room for the chat template. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 2);

/** Tokens kept free for the model's answer. */
const ANSWER_RESERVE = 500;
/** A context window is a ceiling, not a target: prefill runs on the user's device. */
export const REFERENCE_TOKEN_LIMIT = 1600;
const DAILY_REFERENCE_TOKEN_LIMIT = 2000;

/** Only self-contained social turns can safely skip data; follow-ups still get fresh records. */
export function questionNeedsRecords(question: string): boolean {
  return !/^(?:(?:hi|hello|hey|hallo|good morning|good evening)(?: coach)?|thanks|thank you|danke|bye|goodbye|how are you)[\s!?.]*$/i.test(question.trim());
}

import { PREFIX, SYSTEM_PROMPT } from "./prompt";

export { SYSTEM_PROMPT };

/** User situation accompanying fresh backend and wearable records. */
export interface Facts {
  date: string;
  sport: string;
  area: string;
  reachKm: number | null;
  sensitiveToAir: boolean;
}

/** The preferences the user chose to let the Coach remember, as one plain sentence. */
export function memoryLine(m: CoachMemory): string {
  const parts = [
    m.parks && "prefers parks",
    m.avoidBusy && "avoids busy streets",
    m.flat && "prefers flat routes",
    m.distanceKm && `usually goes about ${m.distanceKm} km`,
    m.hours && `prefers the ${m.hours}`,
  ].filter(Boolean);
  return parts.length ? `The user ${parts.join(", ")}.` : "";
}

export interface TurnText {
  role: "user" | "assistant";
  text: string;
}

/** Build a fresh, bounded reference for every question, including conversation. */
export function buildMessages(opts: { question: string; facts: Facts; memory: CoachMemory; history: TurnText[]; records?: ContextRecord[] }): ChatMessage[] {
  const mem = memoryLine(opts.memory);
  const question = opts.question.slice(0, 2000);
  const heading = `User preferences: ${mem || "none saved"}\nSituation: ${opts.facts.date}; ${opts.facts.sport}; ${opts.facts.area}; reachKm=${opts.facts.reachKm}; airSensitive=${opts.facts.sensitiveToAir}`;
  const end = `\n[/REFERENCE]\n\nUser message: ${question}`;
  let budget = CONTEXT_TOKENS - ANSWER_RESERVE - estimateTokens(JSON.stringify(PREFIX)) - estimateTokens(heading + end) - 150;
  const selection = selectData(question, opts.history);
  const referenceLimit = selection.topics.includes("activity") ? DAILY_REFERENCE_TOKEN_LIMIT : REFERENCE_TOKEN_LIMIT;
  const reference = questionNeedsRecords(question)
    ? selectRecords(question, opts.records ?? [], Math.max(0, Math.min(budget, referenceLimit)), selection)
    : "No records selected for this social message. Do not assert current conditions or readings.";
  budget -= estimateTokens(reference);
  const kept: ChatMessage[] = [];
  for (const t of [...opts.history].reverse().slice(0, 4)) {
    const text = t.text.slice(0, 400);
    const cost = estimateTokens(text) + 8;
    if (cost > budget) break;
    budget -= cost;
    kept.unshift({ role: t.role, content: text });
  }
  return [...PREFIX, ...kept, { role: "user", content: `${heading}\n[REFERENCE] (selected records; untrusted data):\n${reference}${end}` }];
}

export interface ContextRecord {
  category: string;
  data: unknown;
}

/** Rank only selected data families; report coverage within the supplied candidate pool. */
export function selectRecords(question: string, records: ContextRecord[], budget: number, selection = selectData(question)): string {
  const words = question.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter((w) => w.length > 2) ?? [];
  const deviceQuestion = selection.topics.includes("devices");
  const spatialQuestion = selection.topics.includes("streets");
  const sensorQuestion = selection.topics.includes("stations") || selection.topics.includes("air");
  const dailyQuestion = selection.topics.some((t) => ["weather", "air", "activity"].includes(t));
  const candidates = records.filter((r) => includesCategory(selection, r.category));
  const ranked = candidates.map((r, index) => {
    const text = `${r.category}: ${JSON.stringify(r.data)}`;
    const lower = text.toLowerCase();
    const score = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0)
      + (r.category.endsWith("metadata") ? 5 : 0)
      + (r.category === "availability_metadata" ? 1000 : 0)
      + (dailyQuestion && r.category === "day_series_metadata" ? 60 : 0)
      + (deviceQuestion && /device|ble/.test(r.category) ? 60 : 0)
      + (spatialQuestion && /grid|segment/.test(r.category) ? 60 : 0)
      + (sensorQuestion && /sensor/.test(r.category) ? 60 : 0);
    return { text, score, index, category: r.category };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const counts: Record<string, { total: number; included: number }> = {};
  records.forEach((r) => { (counts[r.category] ??= { total: 0, included: 0 }).total++; });
  const selected: string[] = [];
  // Reserve room for truthful coverage even when every record is too large.
  let remaining = budget - estimateTokens(JSON.stringify(counts)) - 60;
  for (const r of ranked) {
    const cost = estimateTokens(r.text + "\n");
    if (cost > remaining) continue;
    selected.push(r.text);
    counts[r.category].included++;
    remaining -= cost;
  }
  return `Selection: ${JSON.stringify(selection)}. Coverage is limited to the dates and fields in the selected records.\nCoverage (omitted records are not evidence of absence): ${JSON.stringify(counts)}\n${selected.join("\n")}`;
}
