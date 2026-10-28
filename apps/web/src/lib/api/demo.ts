/**
 * Demo data source used when NEXT_PUBLIC_API_URL is not set.
 * City-wide hours come from Open-Meteo (real weather + CAMS air quality) when
 * reachable, otherwise from a synthetic seasonal model. The grid then spreads
 * those city values over Heilbronn using simple local features.
 */
import type { CellProperties, DayForecast, GridResponse, HourConditions, Sensor } from "./types";
import { GREEN, MAIN_ROADS, NECKAR, HEILBRONN_CENTER, distKm, distToLineKm, squareGrid, nearestPlace } from "../geo";
import { airScore, daylightCurve, heatScore, lightScore, rushCurve, trafficScore, windScore } from "../model";

interface RawHour {
  tempC: number;
  humidity: number;
  windKmh: number;
  pm25: number;
  no2: number;
}

const LAT = 49.1427;
const LNG = 9.2185;

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Days between `date` and today (negative = in the past). */
function daysFromToday(date: string): number {
  const now = new Date();
  return Math.round((parseDate(date).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
}

async function fetchOpenMeteo(date: string): Promise<RawHour[] | null> {
  const q = `latitude=${LAT}&longitude=${LNG}&timezone=Europe%2FBerlin&start_date=${date}&end_date=${date}`;
  const weatherVars = "hourly=temperature_2m,relative_humidity_2m,wind_speed_10m";
  const ago = daysFromToday(date);
  // Open-Meteo's forecast service covers about the last 3 months; older days live in the archive.
  // The air-quality service covers a similar window, so older days use typical values instead.
  const weatherUrl = ago < -85 ? `https://archive-api.open-meteo.com/v1/archive?${q}&${weatherVars}` : `https://api.open-meteo.com/v1/forecast?${q}&${weatherVars}`;
  try {
    const [w, a] = await Promise.all([
      fetch(weatherUrl).then((r) => (r.ok ? r.json() : fetch(`https://archive-api.open-meteo.com/v1/archive?${q}&${weatherVars}`).then((x) => x.json()))),
      ago < -85 ? Promise.resolve(null) : fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm2_5,nitrogen_dioxide`).then((r) => (r.ok ? r.json() : null)),
    ]);
    const t: (number | null)[] = w?.hourly?.temperature_2m ?? [];
    if (t.length < 24 || t.some((v) => v == null)) return null;
    return t.slice(0, 24).map((tempC, h) => ({
      tempC: tempC as number,
      humidity: w.hourly.relative_humidity_2m[h] ?? 60,
      windKmh: w.hourly.wind_speed_10m[h] ?? 8,
      pm25: a?.hourly?.pm2_5?.[h] ?? 10,
      no2: a?.hourly?.nitrogen_dioxide?.[h] ?? 20,
    }));
  } catch {
    return null;
  }
}

// Monthly mean min / max for Heilbronn (approx.)
const CLIMATE: [number, number][] = [
  [-1, 4], [0, 6], [2, 11], [5, 16], [9, 20], [13, 25],
  [15, 27], [14, 26], [11, 21], [7, 15], [3, 9], [0, 5],
];

function synthetic(date: string): RawHour[] {
  const d = parseDate(date);
  const [lo, hi] = CLIMATE[d.getMonth()];
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const winterish = d.getMonth() >= 9 || d.getMonth() <= 2;
  return Array.from({ length: 24 }, (_, h) => {
    const phase = Math.cos(((h - 15) / 24) * 2 * Math.PI); // max 15:00
    const tempC = lo + ((hi - lo) * (phase + 1)) / 2;
    const rush = rushCurve(h, weekend);
    const morningInversion = Math.exp(-((h - 7.5) ** 2) / 6);
    return {
      tempC,
      humidity: 85 - 30 * ((phase + 1) / 2),
      windKmh: 6 + 8 * Math.max(0, Math.sin(((h - 7) / 14) * Math.PI)) + (winterish ? 4 : 0),
      pm25: (winterish ? 11 : 6) + 7 * morningInversion + 3 * rush + (winterish && h >= 18 ? 4 : 0),
      no2: 12 + 38 * rush,
    };
  });
}

function toHour(raw: RawHour, h: number, date: Date): HourConditions {
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const rush = rushCurve(h, weekend);
  const daylight = daylightCurve(date, h);
  return {
    hour: h,
    tempC: round1(raw.tempC),
    humidity: Math.round(raw.humidity),
    pm25: round1(raw.pm25),
    no2: round1(raw.no2),
    windKmh: round1(raw.windKmh),
    rush: round2(rush),
    daylight: round2(daylight),
    factors: {
      heat: Math.round(heatScore(raw.tempC, raw.humidity)),
      air: Math.round(airScore(raw.pm25, raw.no2)),
      wind: Math.round(windScore(raw.windKmh)),
      traffic: Math.round(trafficScore(rush, 0.5)),
      light: Math.round(lightScore(daylight)),
      safety: 70,
    },
  };
}

export async function demoDay(date: string): Promise<DayForecast> {
  const real = await fetchOpenMeteo(date);
  const d = parseDate(date);
  const raw = real ?? synthetic(date);
  return {
    date,
    timezone: "Europe/Berlin",
    generatedAt: new Date().toISOString(),
    source: real ? "forecast" : "mock",
    hours: raw.map((r, h) => toHour(r, h, d)),
  };
}

/** Deterministic pseudo-random in [0,1) from a string. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function demoGrid(day: DayForecast): GridResponse {
  const cells = squareGrid(250).map(({ id, center, ring }) => {
    const urban = Math.max(0, 1 - distKm(center, HEILBRONN_CENTER) / 3.2);
    const green = Math.min(1, GREEN.reduce((acc, g) => acc + g.w * Math.exp(-((distKm(center, g.at) / g.r) ** 2)), 0));
    const river = Math.exp(-((distToLineKm(center, NECKAR) / 0.35) ** 2));
    const road = Math.min(1, MAIN_ROADS.reduce((acc, l) => Math.max(acc, Math.exp(-((distToLineKm(center, l) / 0.25) ** 2))), 0));
    const jitter = hash01(id) - 0.5;
    const cool = Math.min(1, green + river * 0.6);

    const props: CellProperties = {
      id,
      place: nearestPlace(center),
      heat: [], air: [], wind: [], traffic: [], light: [],
      safety: Math.round(Math.max(10, Math.min(100, 85 - road * 45 - urban * 10 + cool * 10 + jitter * 20))),
      green: round2(cool),
    };

    day.hours.forEach((hr) => {
      const night = 1 - hr.daylight;
      // Urban heat island: strongest in the evening/night, greenery and the Neckar cool.
      const t = hr.tempC + urban * (1.2 + 1.6 * night) - cool * 2.2 + jitter * 0.8;
      const pm = hr.pm25 * (0.8 + 0.45 * road + 0.2 * urban - 0.25 * cool);
      const no2 = 8 + (hr.no2 - 8) * (0.35 + 1.3 * road + 0.2 * urban - 0.2 * cool);
      const wind = hr.windKmh * (1 - 0.35 * urban + 0.25 * river + 0.15 * green);
      props.heat.push(Math.round(heatScore(t, hr.humidity)));
      props.air.push(Math.round(airScore(Math.max(1, pm), Math.max(2, no2))));
      props.wind.push(Math.round(windScore(wind)));
      props.traffic.push(Math.round(trafficScore(hr.rush, Math.min(1, road + urban * 0.3))));
      props.light.push(Math.round(lightScore(hr.daylight, 0.15 + urban * 0.6 - green * 0.3)));
    });

    return { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [ring] }, properties: props };
  });
  return { date: day.date, cellSizeM: 250, cells: { type: "FeatureCollection", features: cells } };
}

/** Fixed sensor list (openSenseMap GreenCityHN group + LUBW). */
export function demoSensors(day: DayForecast, hour: number): Sensor[] {
  const h = day.hours[hour];
  const now = new Date().toISOString();
  const box = (id: string, name: string, lng: number, lat: number): Sensor => ({
    id, name, kind: "sensebox_home", lat, lng, updatedAt: now,
    latest: { Temperature: h.tempC, "PM2.5": h.pm25, Humidity: h.humidity },
  });
  return [
    box("69b99dd4deee28000952cea8", "GreenCity OpenSpace", 9.215319, 49.151748),
    box("69bd6c10867a8a00078bedbb", "Schulgarten", 9.22795, 49.142243),
    box("69bd6ceb867a8a00078d3c3f", "Innenstadt", 9.221977, 49.142487),
    box("69bd6f04867a8a000790717b", "Elly-Heuss-Knapp Gymnasium", 9.178809, 49.145848),
    {
      id: "lubw-weinsberger", name: "LUBW Weinsberger Straße (approx.)", kind: "lubw",
      lat: 49.1497, lng: 9.2342, updatedAt: now, latest: { NO2: h.no2 },
    },
  ];
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
