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
export type DataSource = "mock" | "forecast" | "measured" | "mixed" | "unavailable";
export interface ChannelProvenance {
  sourceId: string;
  kind: "model" | "observation" | "derived" | "mock";
  observedAt: string[];
  retrievedAt: string | null;
  issuedAt: string | null;
  rawRefs: number[];
  unit: string;
  method?: string | null;
  qcFlags?: string[];
}

/** 24 values, index = local hour. */
export type Hourly<T = number> = T[];

/** Raw measurements / model outputs for one hour, city-wide. */
export interface HourConditions {
  hour: Hour;
  tempC: number | null;
  humidity: number | null; // %
  pm25: number | null; // µg/m³; source kind is explicit in provenance
  no2: number | null; // µg/m³; model output is distinct from station measurements
  windKmh: number | null;
  /** 0–1, how strongly this hour is a commuter peak (bike counts + NO2 fingerprint). */
  rush: number | null;
  /** 0–1, 0 = dark, 1 = full daylight. */
  daylight: number | null;
  /** Factor scores 0–100 (100 = best). `safety` only meaningful for ride. */
  factors: Record<Factor, number | null>;
  instants?: string[];
  provenance?: Record<string, ChannelProvenance>;
  missing?: string[];
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
  source: DataSource;
  status?: "available" | "partial" | "stale";
  retrievedAt?: string | null;
  buildId?: string | null;
  attribution?: string[];
  hours: HourConditions[]; // length 24
}

/** Properties of one grid cell in GET /api/v1/grid */
export interface CellProperties {
  id: string;
  /** Nearest named place, e.g. "Pfühlpark" */
  place: string;
  /** Per-hour factor scores for this cell, 0–100. */
  heat: Hourly<number | null>;
  air: Hourly<number | null>;
  wind: Hourly<number | null>;
  traffic: Hourly<number | null>;
  light: Hourly<number | null>;
  /** Static: surface + overtaking risk, 0–100. null if no bike data nearby. */
  safety: number | null;
  /** Static: 0–1 share of green / water around the cell. */
  green: number | null;
  surface?: number | null;
  confidence?: number;
  recommendable?: boolean;
  segment_ids?: number[];
  coverage?: Record<string, number>;
  provenance?: Record<string, string>;
}

export interface GridFeature {
  type: "Feature";
  id?: string | number;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: CellProperties;
}

/** GET /api/v1/grid?date=YYYY-MM-DD */
export interface GridResponse {
  source?: DataSource;
  status?: "available" | "partial" | "unavailable";
  message?: string | null;
  date: string;
  cellSizeM: number;
  buildId?: string | null;
  capturedAt?: string | null;
  spatialObservedAt?: string | null;
  stale?: boolean;
  attribution?: string[];
  coverage?: Record<string, number>;
  cells: { type: "FeatureCollection"; features: GridFeature[] };
}

export type SensorKind = "sensebox_home" | "lubw" | "bike_counter";

/** GET /api/v1/sensors */
export interface Sensor {
  /** Provenance supplied by the backend; optional for older API responses. */
  source?: DataSource;
  exposure?: "indoor" | "outdoor" | null;
  stale?: boolean;
  channelProvenance?: Record<string, ChannelProvenance>;
  id: string;
  name: string;
  kind: SensorKind;
  lat: number;
  lng: number;
  /** Free-form latest readings, e.g. { "Temperature": 21.3, "PM2.5": 8.1 } */
  latest: Record<string, number | null>;
  updatedAt: string | null;
}
