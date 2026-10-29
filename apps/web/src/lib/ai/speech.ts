/** Continuous dictation submits only after the user explicitly finishes. */
export interface SpeechResult extends ArrayLike<{ transcript: string }> { isFinal: boolean }
export interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function startDictation(rec: Recognizer, callbacks: {
  draft(text: string): void;
  finish(text: string): void;
  error(): void;
}) {
  let done = false;
  let cancelled = false;
  let committed = "";
  let final = "";
  rec.lang = "en-GB";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (event) => {
    if (cancelled) return;
    const results = Array.from(event.results);
    final = results.filter((r) => r.isFinal).map((r) => r[0]?.transcript ?? "").join(" ");
    callbacks.draft([committed, ...results.map((r) => r[0]?.transcript ?? "")].filter(Boolean).join(" ").trim());
  };
  rec.onerror = () => {
    if (cancelled) return;
    cancelled = true;
    rec.abort();
    callbacks.error();
  };
  rec.onend = () => {
    if (cancelled) return;
    committed = [committed, final].filter(Boolean).join(" ").trim();
    final = "";
    if (done) {
      cancelled = true;
      callbacks.finish(committed);
    } else {
      // Browsers may end recognition on a pause; keep listening until Finish is tapped.
      try { rec.start(); } catch { rec.onerror?.(); }
    }
  };
  try { rec.start(); } catch { rec.onerror?.(); }
  return {
    finish() {
      if (cancelled || done) return;
      done = true;
      try { rec.stop(); } catch { rec.onerror?.(); }
    },
    cancel() {
      cancelled = true;
      rec.onresult = rec.onend = rec.onerror = null;
      rec.abort();
    },
  };
}
