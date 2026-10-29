import type { DayForecast, GridResponse, Sensor } from "../api/types";
import type { SegmentDetail, SegmentSnapshot } from "../api/consumer";
import type { DemoDevice } from "../wearables/devices";
import type { HeartRateSample } from "../wearables/ble";
import type { ContextRecord } from "./context";

/** Preserve every loaded backend/device record as a candidate for question-time selection. */
export function contextRecords(inputs: {
  day: DayForecast | null; grid: GridResponse | null; sensors: Sensor[];
  segments: SegmentSnapshot | null; segmentDetail: SegmentDetail | null;
  devices: DemoDevice[]; readings: HeartRateSample[]; recent: HeartRateSample[];
  ble: { connected: boolean; battery: number | null; last: HeartRateSample | null };
  error: string | null;
}): ContextRecord[] {
  const records: ContextRecord[] = [];
  const add = (category: string, data: unknown) => records.push({ category, data });
  add("availability_metadata", { dayLoaded: !!inputs.day, gridLoaded: !!inputs.grid, sensorCount: inputs.sensors.length, error: inputs.error,
    units: { tempC: "°C", humidity: "%", pm25: "µg/m³", no2: "µg/m³", windKmh: "km/h", coordinates: "WGS84 [longitude, latitude]" } });
  if (inputs.day) {
    const { hours, ...metadata } = inputs.day;
    add("day_metadata", metadata);
    // Columnar overview includes every hour/value without repeating field names or provenance.
    const fields = [...new Set(hours.flatMap((hour) => Object.keys(hour)))].filter((key) => key !== "provenance" && key !== "factors");
    const series = Object.fromEntries(fields.map((key) => [key, hours.map((hour) => (hour as unknown as Record<string, unknown>)[key] ?? null)]));
    const factorKeys = [...new Set(hours.flatMap((hour) => Object.keys(hour.factors ?? {})))];
    add("day_series_metadata", { source: metadata.source, date: metadata.date, timezone: metadata.timezone,
      ...series, factors: Object.fromEntries(factorKeys.map((key) => [key, hours.map((hour) => hour.factors?.[key as keyof typeof hour.factors] ?? null)])),
      layout: "Each array follows the hour array. Detailed hour records carry channel provenance." });
    hours.forEach((hour) => add("day_hour", hour));
  }
  if (inputs.grid) {
    const { cells, ...metadata } = inputs.grid;
    add("grid_metadata", metadata);
    cells.features.forEach((cell) => add("grid_cell", cell));
  }
  inputs.sensors.forEach((sensor) => add("sensor", sensor));
  if (inputs.segments) {
    const { scores, ...metadata } = inputs.segments;
    add("segment_metadata", { ...metadata, tupleFields: ["score", "confidence", "flags"] });
    Object.entries(scores).forEach(([id, score]) => add("segment_score", { id, score }));
  }
  if (inputs.segmentDetail) add("segment_detail", inputs.segmentDetail);
  inputs.devices.forEach(({ samples, ...metadata }) => {
    add("device_metadata", { ...metadata, source: "synthetic local fixture", sampleCount: samples.length });
    [...samples].reverse().forEach((sample) => add("device_sample", { ...sample, deviceId: metadata.id, name: metadata.name, source: "synthetic local fixture" }));
  });
  add("ble_metadata", { source: "observed BLE heart-rate device", ...inputs.ble });
  const samples = new Map([...inputs.readings, ...inputs.recent].map((s) => [s.sample_id, s]));
  [...samples.values()].sort((a, b) => b.timestamp_utc.localeCompare(a.timestamp_utc)).forEach((sample) => add("ble_sample", sample));
  return records;
}
