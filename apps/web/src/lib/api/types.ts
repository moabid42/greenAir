/**
 * API contract between frontend and backend.
 * Keep in sync with README.md (Expected API endpoints) — this file is the source of truth for shapes.
 *
 * Convention: every factor score is 0–100 where 100 = BEST for sport
 * (cool, clean air, calm, no rush traffic, safe). Raw measurements are
 * sent alongside so the UI can explain *why* a score is what it is.
 */

export type Activity = "run" | "ride" | "walk";

/** The five (six for cyclists) things we fold into one index. */
export type Factor = "heat" | "air" | "wind" | "traffic" | "light" | "safety";

/** Hour of day in Europe/Berlin local time, 0–23. */
export type Hour = number;

/** 24 values, index = local hour. */
export type Hourly<T = number> = T[];

/** Raw measurements / model outputs for one hour, city-wide. */
export interface HourConditions {
  hour: Hour;
  tempC: number;
  humidity: number; // %
  pm25: number; // µg/m³ (senseBox:home)
  no2: number; // µg/m³ (LUBW Weinsberger Straße)
  windKmh: number;
  /** 0–1, how strongly this hour is a commuter peak (bike counts + NO2 fingerprint). */
  rush: number;
  /** 0–1, 0 = dark, 1 = full daylight. */
  daylight: number;
  /** Factor scores 0–100 (100 = best). `safety` only meaningful for ride. */
  factors: Record<Factor, number>;
}

export interface TimeWindow {
  start: Hour; // inclusive
  end: Hour; // exclusive
  score: number;
}

/** GET /api/v1/day?date=YYYY-MM-DD */
export interface DayForecast {
  date: string;
  timezone: "Europe/Berlin";
  generatedAt: string; // ISO
  /** "measured" | "forecast" | "mock" — shown as a badge so users know what they see. */
  source: "measured" | "forecast" | "mock";
  hours: HourConditions[]; // length 24
}

/** Properties of one grid cell in GET /api/v1/grid */
export interface CellProperties {
  id: string;
  /** Nearest named place, e.g. "Pfühlpark" */
  place: string;
  /** Per-hour factor scores for this cell, 0–100. */
  heat: Hourly;
  air: Hourly;
  wind: Hourly;
  traffic: Hourly;
  light: Hourly;
  /** Static: surface + overtaking risk, 0–100. null if no bike data nearby. */
  safety: number | null;
  /** Static: 0–1 share of green / water around the cell. */
  green: number;
}

export interface GridFeature {
  type: "Feature";
  id?: string | number;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: CellProperties;
}

/** GET /api/v1/grid?date=YYYY-MM-DD */
export interface GridResponse {
  date: string;
  cellSizeM: number;
  cells: { type: "FeatureCollection"; features: GridFeature[] };
}

export type SensorKind = "sensebox_home" | "lubw" | "bike_counter";

/** GET /api/v1/sensors */
export interface Sensor {
  id: string;
  name: string;
  kind: SensorKind;
  lat: number;
  lng: number;
  /** Free-form latest readings, e.g. { "Temperature": 21.3, "PM2.5": 8.1 } */
  latest: Record<string, number | null>;
  updatedAt: string | null;
}
