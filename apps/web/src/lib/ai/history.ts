import type { CoachCard } from "@/lib/coach/engine";

/** One saved chat message. Only the words and answer cards, never raw environmental data. */
export interface StoredMessage {
  id: number;
  role: "user" | "coach";
  text: string;
  cards?: CoachCard[];
  note?: string;
}

const KEY = "sweetspot:coach-chat:v1";
export const HISTORY_CLEARED_EVENT = "sweetspot:chat-cleared";
const MAX = 40;

// Stored in the browser's localStorage. That is NOT encrypted; the native app is meant to use encrypted storage.
export function loadHistory(): StoredMessage[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(messages: StoredMessage[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX)));
  } catch {
    /* storage full or unavailable: the chat just isn't kept */
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  window.dispatchEvent(new Event(HISTORY_CLEARED_EVENT));
}
