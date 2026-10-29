/** Display calendar/hour explicitly in the product's Europe/Berlin timezone. */
export function berlinDate(moment = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(moment).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const berlinHour = (moment = new Date()) => Number(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23",
}).format(moment));

/** Earliest actual instant of a Berlin wall hour; null for a spring DST gap. */
export function berlinInstant(date: string, hour: number): Date | null {
  const [y,m,d] = date.split("-").map(Number);
  const guess = Date.UTC(y,m-1,d,hour);
  const candidates = Array.from({length:29}, (_,i) => new Date(guess+(i-14)*3600000))
    .filter((at) => berlinDate(at) === date && berlinHour(at) === hour);
  return candidates[0] ?? null;
}
