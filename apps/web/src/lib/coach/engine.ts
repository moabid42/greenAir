import { getDay, getGrid } from "@/lib/api/client";
import type { Activity, DayForecast, Factor, GridFeature, GridResponse, Hour, TimeWindow } from "@/lib/api/types";
import { dayWord, shortDate, tempWord } from "@/lib/format";
import { MAX_OUTSIDE_KM, type LngLat, fmtKm, nearestCell, rankSpots, type Spot } from "@/lib/rank";
import { reasons } from "@/lib/reasons";
import { bestWindows, cellFactors, cellScore, fmtHour, hourScore, maskPast, type Tune, VERDICT_TEXT, verdict } from "@/lib/score";

/** Everything the Coach knows about the user's situation right now. */
export interface CoachCtx {
  today: string;
  date: string;
  hourNow: Hour;
  activity: Activity;
  tune: Tune;
  home: LngLat | null;
  homeLabel: string | null;
  radiusKm: number | null;
  day: DayForecast;
  grid: GridResponse;
  airSensitive: boolean;
}

export interface CoachCard {
  score: number;
  title: string;
  sub: string;
}

export type CoachAction =
  | { kind: "remind"; label: string; at: string; title: string; body: string }
  | { kind: "map"; label: string; lngLat: LngLat }
  | { kind: "place"; label: string; cellId: string; hour: Hour }
  | { kind: "day"; label: string; date: string }
  | { kind: "tab"; label: string; tab: "devices" | "today" };

/** What the question is about. "general" means it is not a data question (chat, off-topic, unclear). */
export type CoachIntent = "week" | "watch" | "workouts" | "greeting" | "hour" | "heat" | "air" | "wind" | "where" | "route" | "best" | "general";

export interface CoachReply {
  text: string;
  cards?: CoachCard[];
  actions?: CoachAction[];
  note?: string;
}

interface DayInfo {
  date: string;
  day: DayForecast;
  grid: GridResponse;
  homeCell: GridFeature | null;
  scores: number[];
  windows: TimeWindow[];
}

const VERB: Record<Activity, string> = { run: "run", ride: "ride", walk: "walk" };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const pad = (h: number) => String(h).padStart(2, "0");
const range = (w: TimeWindow) => `${pad(w.start)}–${pad(w.end)}`;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Which day does the question mean? */
function parseDate(q: string, ctx: CoachCtx): string {
  if (q.includes("tomorrow")) return addDays(ctx.today, 1);
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (q.includes(WEEKDAYS[i])) {
      const [y, m, d] = ctx.today.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      return addDays(ctx.today, (i - dow + 7) % 7 || 7);
    }
  }
  return ctx.date;
}

/** Which hour does the question mean? null when it names none. */
function parseHour(q: string): Hour | null {
  let m = q.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return Math.min(23, Number(m[1]));
  m = q.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m) return Math.min(23, (Number(m[1]) % 12) + (m[2] === "pm" ? 12 : 0));
  m = q.match(/\b(?:at|around|after|before|by|from)\s+(\d{1,2})\b(?!\s*(?:km|k\b|min|m\b))/);
  if (m && Number(m[1]) <= 23) return Number(m[1]);
  if (/after work|after school|end of (the )?day/.test(q)) return 17;
  if (/before work|early morning|sunrise/.test(q)) return 6;
  if (q.includes("morning")) return 7;
  if (/lunch|noon|midday/.test(q)) return 12;
  if (q.includes("afternoon")) return 15;
  if (q.includes("evening")) return 19;
  if (/tonight|night/.test(q)) return 21;
  return null;
}

async function dayInfo(ctx: CoachCtx, date: string): Promise<DayInfo> {
  let day = ctx.day;
  let grid = ctx.grid;
  if (date !== ctx.date) {
    day = await getDay(date);
    grid = await getGrid(date, day);
  }
  const near = ctx.home ? nearestCell(grid, ctx.home) : null;
  const homeCell = near && near.km <= MAX_OUTSIDE_KM ? near.cell : null;
  const scores = homeCell ? Array.from({ length: 24 }, (_, h) => cellScore(homeCell.properties, h, ctx.activity, ctx.tune)) : day.hours.map((h) => hourScore(h, ctx.activity, ctx.tune));
  // Today only looks forward: hours that are over are not recommended.
  return { date, day, grid, homeCell, scores, windows: bestWindows(maskPast(scores, date === ctx.today ? ctx.hourNow : null)) };
}

const factorsAt = (i: DayInfo, h: Hour): Record<Factor, number | null> => (i.homeCell ? cellFactors(i.homeCell.properties, h) : i.day.hours[h].factors);

/** The one or two things that matter most at an hour, worst first. */
function why(i: DayInfo, h: Hour, ctx: CoachCtx): string {
  const rs = reasons(factorsAt(i, h), i.day.hours[h], ctx.activity);
  const notGood = rs.filter((r) => r.tone !== "good");
  return (notGood.length ? notGood : rs).slice(0, 2).map((r) => r.text).join(" · ");
}

function spotsAt(i: DayInfo, h: Hour, ctx: CoachCtx, n = 3): Spot[] {
  return rankSpots(i.grid, h, ctx.activity, ctx.tune, n, ctx.home, ctx.radiusKm);
}

function remind(i: DayInfo, w: TimeWindow, place: string): CoachAction | null {
  const [y, m, d] = i.date.split("-").map(Number);
  const at = new Date(y, m - 1, d, w.start, 0);
  at.setMinutes(at.getMinutes() - 15);
  if (at.getTime() <= Date.now()) return null;
  return {
    kind: "remind",
    label: `Remind me ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    at: at.toISOString(),
    title: "Your window opens in 15 min",
    body: `${place} · ${range(w)} · score ${w.score}`,
  };
}

const compact = <T,>(xs: (T | null | undefined)[]): T[] => xs.filter((x): x is T => x != null);

/** Answers a question from the live data. Always works, with or without a language model. */
export async function answer(question: string, ctx: CoachCtx): Promise<CoachReply> {
  const q = question.toLowerCase();
  const has = (...w: string[]) => w.some((x) => q.includes(x));
  const date = parseDate(q, ctx);
  const hour = parseHour(q);

  if (has("week", "best day", "weekend", "next few days", "which day")) return weekReply(ctx);

  const i = await dayInfo(ctx, date);
  const when = dayWord(date, ctx.today);
  const place = ctx.homeLabel ?? "Heilbronn";
  const best = i.windows[0];
  const bestSpot = best ? spotsAt(i, best.start, ctx, 1)[0] : undefined;
  const verb = VERB[ctx.activity];

  if (has("watch", "garmin", "strava", "buzz", "wrist", "apple health")) {
    return {
      text: "Reminders you set reach your watch, because phones mirror their notifications to a paired watch. Syncing workouts from Apple Health, Health Connect, Garmin or Strava needs the native app. You can set up the watch alerts under Devices.",
      actions: [{ kind: "tab", label: "Open Devices", tab: "devices" }],
    };
  }

  if (has("last run", "my run", "workout", "my pace", "heart rate", "my last")) {
    return {
      text: "I can't see your workouts yet. Syncing them from a watch needs the native app. For now I can tell you the best time and place to go.",
      actions: [{ kind: "tab", label: "Open Devices", tab: "devices" }],
    };
  }

  if (has("hello", "hi!", "hey", "good morning", "good evening") && q.length < 24) {
    return { text: best ? `Hi! ${when === "today" ? "Today" : when}'s best window to ${verb} is ${range(best)} (score ${best.score}). Ask me anything about it.` : "Hi! Ask me when and where to get out." };
  }

  // A specific hour: "Can I run after work?" / "Is 6 pm OK?"
  if (hour != null && best) {
    const s = i.scores[hour];
    const here = bestSpot?.place ?? place;
    const passed = date === ctx.today && hour < ctx.hourNow;
    const inBest = hour >= best.start && hour < best.end;
    const tomorrow = addDays(ctx.today, 1);
    const stats = `${pad(hour)}:00 ${when}`;
    let text: string;
    if (passed) text = `${stats} has already passed. The best time left is ${range(best)} (score ${best.score}).`;
    else if (s >= 75) text = `Yes, ${stats} looks ${verdict(s) === "great" ? "great" : "good"} for a ${verb} (score ${s}).`;
    else if (inBest) text = `${stats} isn't great (score ${s}): ${why(i, hour, ctx).toLowerCase()}. It's the best of what's left ${when}, and tomorrow may be better.`;
    else if (s >= 60) text = `${stats} is okay (score ${s}): ${why(i, hour, ctx).toLowerCase()}. ${range(best)} would be better.`;
    else text = `I'd skip ${stats} (score ${s}): ${why(i, hour, ctx).toLowerCase()}. Try ${range(best)} instead.`;

    const cards: CoachCard[] = [];
    if (!passed) cards.push({ score: s, title: `${pad(hour)}:00 · ${place}`, sub: why(i, hour, ctx) });
    if (passed || !inBest) cards.push({ score: best.score, title: `${range(best)} · ${here}`, sub: why(i, best.start, ctx) });
    const spot = spotsAt(i, passed ? best.start : hour, ctx, 1)[0];
    const target = passed || (!inBest && s < 75) ? best : { start: hour, end: hour + 1, score: s };
    return {
      text,
      cards,
      actions: compact<CoachAction>([
        remind(i, target, spot?.place ?? place),
        spot ? { kind: "place", label: `See ${spot.place}`, cellId: spot.cellId, hour: passed ? best.start : hour } : null,
        date === ctx.today && (inBest || passed) && s < 75 ? { kind: "day", label: "See tomorrow", date: tomorrow } : null,
      ]),
    };
  }

  if (has("hot", "heat", "warm", "cool", "temperature", "sweat", "sun")) {
    const temps = i.day.hours.map((h) => h.tempC);
    const max = Math.max(...temps);
    const min = Math.min(...temps);
    const hottest = temps.indexOf(max);
    const cool = i.day.hours.map((h, k) => ({ k, v: factorsAt(i, k).heat ?? 0, h })).filter((x) => x.k >= 5 && x.k < 23 && x.v >= 75);
    const tooHot = max >= 28;
    return {
      text: `${when === "today" ? "Today" : when} runs ${Math.round(min)}° to ${Math.round(max)}°, warmest around ${pad(hottest)}:00 (${tempWord(max).toLowerCase()}). ${
        tooHot ? `It's too hot to ${verb} in the middle of the day. ` : ""
      }${cool.length ? `Comfortable from ${pad(cool[0].k)}:00 to ${pad(cool[cool.length - 1].k + 1)}:00.` : "No hour is really comfortable today."}`,
      cards: [{ score: Math.round(factorsAt(i, hottest).heat ?? 0), title: `${pad(hottest)}:00 · warmest`, sub: `${Math.round(max)} °C` }],
      actions: compact<CoachAction>([best ? { kind: "day", label: "Show the day", date } : null]),
    };
  }

  if (has("air", "asthma", "pollut", "pollen", "breath", "no2", "dust", "lung", "allerg")) {
    const waking = i.day.hours.map((h, k) => ({ k, v: factorsAt(i, k).air ?? 0, rush: h.rush > 0.45 })).filter((x) => x.k >= 5 && x.k < 23);
    const top = waking.reduce((a, b) => (b.v > a.v ? b : a));
    const low = waking.reduce((a, b) => (b.v < a.v ? b : a));
    const rush = waking.filter((x) => x.rush).map((x) => pad(x.k));
    return {
      text: `Air is ${top.v >= 75 ? "clean" : "okay"} at its best around ${pad(top.k)}:00 (score ${Math.round(top.v)}). It's worst around ${pad(low.k)}:00${low.rush ? ", in the commuter rush" : ""}.${
        rush.length ? ` Stay off the main roads during rush hour (${rush[0]}:00–${pad(Number(rush[rush.length - 1]) + 1)}:00).` : ""
      }${ctx.airSensitive ? " I weigh air more heavily for you." : ""}`,
      cards: [
        { score: Math.round(top.v), title: `${pad(top.k)}:00 · best air`, sub: "Cleanest hour" },
        { score: Math.round(low.v), title: `${pad(low.k)}:00 · worst air`, sub: low.rush ? "Rush-hour traffic" : "Lowest of the day" },
      ],
      note: "Not medical advice. Follow your doctor's plan.",
    };
  }

  if (has("wind", "rain", "storm", "weather")) {
    const winds = i.day.hours.map((h) => h.windKmh);
    const maxW = Math.max(...winds);
    const minW = Math.min(...winds.slice(5, 23));
    return {
      text: `I don't track rain yet, only wind. ${when === "today" ? "Today" : when} wind peaks at ${Math.round(maxW)} km/h around ${pad(winds.indexOf(maxW))}:00 and is calmest (${Math.round(minW)} km/h) around ${pad(winds.indexOf(minW, 5))}:00.`,
    };
  }

  if (has("where", "which park", "which place", "best place", "best spot", "spot", "park", "coolest", "cleanest", "quietest", "area", "neighbourhood")) {
    const h = hour ?? best?.start ?? ctx.hourNow;
    const spots = spotsAt(i, h, ctx, 3);
    if (spots.length === 0) return { text: "Nothing within your reach yet. Try a bigger distance in your location settings." };
    return {
      text: `For ${pad(h)}:00 ${when}, ${spots[0].place} is your best bet (score ${spots[0].score})${spots[0].distanceKm != null ? `, ${fmtKm(spots[0].distanceKm)} away` : ""}.`,
      cards: spots.map((s) => ({ score: s.score, title: s.place, sub: s.distanceKm != null ? `${fmtKm(s.distanceKm)} away` : "In Heilbronn" })),
      actions: [
        { kind: "place", label: `See ${spots[0].place}`, cellId: spots[0].cellId, hour: h },
        { kind: "map", label: "Show on map", lngLat: spots[0].lngLat },
      ],
    };
  }

  if (has("loop", "route", "plan", " km", "distance", "road", "street", "path", "trail")) {
    return {
      text: `I can't plan routes yet, but I can tell you where to go. ${bestSpot ? `${bestSpot.place} scores ${bestSpot.score} at ${pad(best!.start)}:00.` : ""} ${ctx.activity === "ride" ? "In ride mode the map shows the smoothest streets from real rider measurements." : ""}`.trim(),
      actions: compact<CoachAction>([bestSpot ? { kind: "place", label: `See ${bestSpot.place}`, cellId: bestSpot.cellId, hour: best!.start } : null]),
    };
  }

  // Default: when is the best time?
  if (!best) {
    const next = await dayInfo(ctx, addDays(ctx.today, 1));
    const nb = next.windows[0];
    return nb
      ? { text: `Nothing good is left ${when}. Tomorrow's best time to ${verb} is ${range(nb)} (score ${nb.score}).`, actions: [{ kind: "day", label: "See tomorrow", date: next.date }] }
      : { text: "I don't have data for that day yet. Try again in a moment." };
  }
  const second = i.windows[1];
  const where = bestSpot ? bestSpot.place : place;
  return {
    text: `${when === "today" ? "Today" : when[0].toUpperCase() + when.slice(1)}'s best time to ${verb} is ${range(best)} (${VERDICT_TEXT[verdict(best.score)].toLowerCase()}, score ${best.score}). ${
      bestSpot ? `${bestSpot.place} is the best bet${bestSpot.distanceKm != null ? `, ${fmtKm(bestSpot.distanceKm)} away` : ""}.` : ""
    }`,
    cards: compact<CoachCard>([
      { score: best.score, title: `${range(best)} · ${where}`, sub: why(i, best.start, ctx) },
      second ? { score: second.score, title: `${range(second)} · ${where}`, sub: why(i, second.start, ctx) } : null,
    ]),
    actions: compact<CoachAction>([
      remind(i, best, where),
      bestSpot ? { kind: "place", label: `See ${bestSpot.place}`, cellId: bestSpot.cellId, hour: best.start } : null,
    ]),
  };
}

/** Mirrors the order `answer` checks things in, so the on-device AI knows whether the question needs the data. */
export function intentOf(question: string): CoachIntent {
  const q = question.toLowerCase();
  const has = (...w: string[]) => w.some((x) => q.includes(x));
  if (has("week", "best day", "weekend", "next few days", "which day")) return "week";
  if (has("watch", "garmin", "strava", "buzz", "wrist", "apple health")) return "watch";
  if (has("last run", "my run", "workout", "my pace", "heart rate", "my last")) return "workouts";
  if (has("hello", "hi!", "hey", "good morning", "good evening") && q.length < 24) return "greeting";
  if (parseHour(q) != null) return "hour";
  if (has("hot", "heat", "warm", "cool", "temperature", "sweat", "sun")) return "heat";
  if (has("air", "asthma", "pollut", "pollen", "breath", "no2", "dust", "lung", "allerg")) return "air";
  if (has("wind", "rain", "storm", "weather")) return "wind";
  if (has("where", "which park", "which place", "best place", "best spot", "spot", "park", "coolest", "cleanest", "quietest", "area", "neighbourhood")) return "where";
  if (has("loop", "route", "plan", " km", "distance", "road", "street", "path", "trail")) return "route";
  return has("best time", "when", "what time", "good time", "best window", "time to", "should i go", "can i go") ? "best" : "general";
}

async function weekReply(ctx: CoachCtx): Promise<CoachReply> {
  const infos = await Promise.all(Array.from({ length: 7 }, (_, n) => dayInfo(ctx, addDays(ctx.today, n)).catch(() => null)));
  const days = compact(infos)
    .map((i) => ({ i, w: i.windows[0] }))
    .filter((d) => d.w)
    .sort((a, b) => b.w.score - a.w.score);
  if (days.length === 0) return { text: "I couldn't read the forecast right now. Try again in a moment." };
  const top = days.slice(0, 3);
  return {
    text: `${shortDate(top[0].i.date)} looks like your best day this week: ${range(top[0].w)} scores ${top[0].w.score}.`,
    cards: top.map((d) => ({ score: d.w.score, title: shortDate(d.i.date), sub: `${range(d.w)} · ${Math.round(Math.min(...d.i.day.hours.map((h) => h.tempC)))}° to ${Math.round(Math.max(...d.i.day.hours.map((h) => h.tempC)))}°` })),
    actions: [{ kind: "day", label: `Open ${shortDate(top[0].i.date)}`, date: top[0].i.date }],
  };
}

/** A small, factual summary the language model may use. Nothing else about the user is sent. */
export function buildFacts(ctx: CoachCtx, reply: CoachReply) {
  const waking = ctx.day.hours.slice(5, 23);
  return {
    date: ctx.date,
    sport: ctx.activity,
    area: ctx.homeLabel ?? "Heilbronn (whole city)",
    reachKm: ctx.radiusKm,
    sensitiveToAir: ctx.airSensitive,
    tempRangeC: [Math.round(Math.min(...waking.map((h) => h.tempC))), Math.round(Math.max(...waking.map((h) => h.tempC)))],
    rushHours: waking.filter((h) => h.rush > 0.45).map((h) => fmtHour(h.hour)),
    analysis: reply.text,
    options: (reply.cards ?? []).map((c) => `${c.title}: score ${c.score} (${c.sub})`),
  };
}
