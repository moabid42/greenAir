import type { ChatMessage } from "./engine";
import type { CoachMemory } from "@/lib/prefs";
import { CONTEXT_TOKENS } from "./engine";

/** Conservative estimate for JSON-heavy data; leave room for the chat template. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 2);

/** Tokens kept free for the model's answer. */
const ANSWER_RESERVE = 500;

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
  const reference = selectRecords(question, opts.records ?? [], Math.max(0, budget));
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

/** All loaded records are candidates; retain complete records and report selection coverage. */
export function selectRecords(question: string, records: ContextRecord[], budget: number): string {
  const words = question.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter((w) => w.length > 2) ?? [];
  const deviceQuestion = /heart|bpm|device|watch|whoop|step|pace|cadence|workout|recovery|strain|distance/i.test(question);
  const spatialQuestion = /street|park|place|where|route|surface|traffic|segment/i.test(question);
  const sensorQuestion = /sensor|station|measured|pm|no2|ozone|temperature|humidity|air/i.test(question);
  const ranked = records.map((r, index) => {
    const text = `${r.category}: ${JSON.stringify(r.data)}`;
    const lower = text.toLowerCase();
    const score = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0)
      + (r.category.endsWith("metadata") ? 30 : 0)
      + (deviceQuestion && /device|ble/.test(r.category) ? 20 : 0)
      + (spatialQuestion && /grid|segment/.test(r.category) ? 15 : 0)
      + (sensorQuestion && /sensor/.test(r.category) ? 15 : 0);
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
  return `Coverage (omitted records are not evidence of absence): ${JSON.stringify(counts)}\n${selected.join("\n")}`;
}
