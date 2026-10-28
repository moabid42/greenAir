import { scoreColor } from "./score";

/** 24 coloured segments (one per hour) as a CSS conic-gradient. Gaps between hours are `gap` degrees. */
export function ringGradient(scores: number[], gap = 1.6): string {
  const stops = scores.map((s, h) => {
    const a = h * 15;
    const b = a + gap;
    const c = a + 15 - gap;
    const d = a + 15;
    return `transparent ${a}deg ${b}deg, ${scoreColor(s)} ${b}deg ${c}deg, transparent ${c}deg ${d}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/** Marks a window (hours [start, end)) around the ring. */
export function windowGradient(start: number, end: number, color = "#162c29"): string {
  return `conic-gradient(transparent 0deg ${start * 15}deg, ${color} ${start * 15}deg ${end * 15}deg, transparent ${end * 15}deg 360deg)`;
}

/** Pointer position inside a circle → hour 0–23 (12 o'clock = 00:00, clockwise). */
export function hourFromPointer(clientX: number, clientY: number, rect: DOMRect): number {
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return Math.min(23, Math.floor(deg / 15));
}
