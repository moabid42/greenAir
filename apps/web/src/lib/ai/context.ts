import type { ChatMessage } from "./engine";
import type { CoachMemory } from "@/lib/prefs";
import { CONTEXT_TOKENS } from "./engine";

/** Roughly 3.5 characters per token for English. Good enough to stay under the budget. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);

/** Tokens kept free for the model's answer. */
const ANSWER_RESERVE = 200;

import { PREFIX, SYSTEM_PROMPT } from "./prompt";

export { SYSTEM_PROMPT };

/** What the facts say, trimmed to what this question needs. Never the whole data set. */
export interface Facts {
  date: string;
  sport: string;
  area: string;
  reachKm: number | null;
  sensitiveToAir: boolean;
  tempRangeC: number[];
  rushHours: string[];
  analysis: string;
  options: string[];
}

/** FreshFactsExtractor: keeps only the facts relevant to the question (smaller prompt, faster answer). */
export function extractFreshFacts(question: string, f: Facts, mode: "data" | "chat" = "data"): string {
  const q = question.toLowerCase();
  const wants = (...w: string[]) => w.some((x) => q.includes(x));
  const lines = [`Date: ${f.date}`, `Sport: ${f.sport}`, `Area: ${f.area}`];
  if (mode === "data") {
    lines.push(`Analysis (answers the question): ${f.analysis}`);
    if (f.options.length) lines.push(`Options: ${f.options.slice(0, 3).join(" | ")}`);
  } else {
    // Chat gets no data on purpose: a small model repeats whatever numbers it sees instead of answering.
  }
  if (mode === "data" && f.tempRangeC.length === 2 && wants("hot", "heat", "warm", "cool", "temperature", "sun", "when", "best")) lines.push(`Temperature today: ${f.tempRangeC[0]} to ${f.tempRangeC[1]} °C`);
  if (wants("air", "asthma", "pollut", "breath", "traffic", "rush", "busy", "road") && f.rushHours.length) lines.push(`Rush hours: ${f.rushHours[0]} to ${f.rushHours[f.rushHours.length - 1]}`);
  if (f.sensitiveToAir) lines.push("The user is sensitive to air quality.");
  return lines.join("\n");
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

/**
 * AIContextBuilder + TokenBudgetManager: builds the small, temporary prompt for ONE question.
 * Recent turns are kept only while they fit; the fresh facts are always included.
 */
export function buildMessages(opts: { question: string; facts: Facts; memory: CoachMemory; history: TurnText[]; mode?: "data" | "chat" }): ChatMessage[] {
  // The memory goes in the user turn, never the system prompt, so the fixed start stays identical and reusable.
  const mem = memoryLine(opts.memory);
  const body = opts.mode === "chat" ? opts.question : `REFERENCE:\n${extractFreshFacts(opts.question, opts.facts, opts.mode)}\n\nUser message: ${opts.question}`;
  const user = mem ? `(${mem})\n${body}` : body;

  let budget = CONTEXT_TOKENS - ANSWER_RESERVE - estimateTokens(JSON.stringify(PREFIX)) - estimateTokens(user);
  const kept: ChatMessage[] = [];
  // Newest first; stop as soon as the budget runs out.
  for (const t of [...opts.history].reverse().slice(0, 2)) {
    const text = t.text.slice(0, 200);
    const cost = estimateTokens(text) + 4;
    if (cost > budget) break;
    budget -= cost;
    kept.unshift({ role: t.role, content: text });
  }
  return [...PREFIX, ...kept, { role: "user", content: user }];
}
