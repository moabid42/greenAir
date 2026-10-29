import { includesCategory, selectedDayFields, type DataSelection } from "./selection";
import type { DayForecast, GridResponse, Sensor } from "../api/types";
import type { SegmentDetail, SegmentSnapshot } from "../api/consumer";
import type { DemoDevice } from "../wearables/devices";
import type { HeartRateSample } from "../wearables/ble";
import type { ContextRecord } from "./context";

/** Construct only requested data families; optional unscoped mode supports offline inspection. */
export function contextRecords(inputs: {
  day: DayForecast | null; grid: GridResponse | null; sensors: Sensor[];
  segments: SegmentSnapshot | null; segmentDetail: SegmentDetail | null;
  devices: DemoDevice[]; readings: HeartRateSample[]; recent: HeartRateSample[];
  ble: { connected: boolean; battery: number | null; last: HeartRateSample | null };
  error: string | null;
}, selection?: DataSelection): ContextRecord[] {
  const records: ContextRecord[] = [];
  const wants = (category: string) => !selection || includesCategory(selection, category);
  const add = (category: string, data: unknown) => { if (wants(category)) records.push({ category, data }); };
  add("availability_metadata", { dayLoaded: !!inputs.day, gridLoaded: !!inputs.grid, sensorCount: inputs.sensors.length, error: inputs.error,
    units: { tempC: "°C", humidity: "%", pm25: "µg/m³", no2: "µg/m³", windKmh: "km/h", coordinates: "WGS84 [longitude, latitude]" } });
  if (inputs.day && wants("day_metadata")) {
    const { hours: rawHours, ...metadata } = inputs.day;
    const fieldsWanted = selection ? selectedDayFields(selection) : [];
    const hours = fieldsWanted.length ? rawHours.map((hour) => {
      const allowed = new Set(["hour", "instants", "missing", ...fieldsWanted]);
      return { ...Object.fromEntries(Object.entries(hour).filter(([key]) => allowed.has(key))),
        provenance: Object.fromEntries(Object.entries(hour.provenance ?? {}).filter(([key]) => fieldsWanted.includes(key))),
      } as unknown as typeof hour;
    }) : rawHours;
    add("day_metadata", metadata);
    // Columnar overview includes every hour/value without repeating field names or provenance.
    const fields = [...new Set(hours.flatMap((hour) => Object.keys(hour)))].filter((key) => key !== "provenance" && key !== "factors");
    const series = Object.fromEntries(fields.map((key) => [key, hours.map((hour) => (hour as unknown as Record<string, unknown>)[key] ?? null)]));
    const factorKeys = [...new Set(hours.flatMap((hour) => Object.keys(hour.factors ?? {})))];
    add("day_series_metadata", { source: metadata.source, date: metadata.date, timezone: metadata.timezone,
      ...series, factors: Object.fromEntries(factorKeys.map((key) => [key, hours.map((hour) => hour.factors?.[key as keyof typeof hour.factors] ?? null)])),
      selectedFields: fieldsWanted.length ? fieldsWanted : "all",
      layout: "Each array follows the hour array. Only selected fields are shown; omitted channels are not missing. Detailed hour records carry channel provenance." });
    hours.forEach((hour) => add("day_hour", hour));
  }
  if (inputs.grid && wants("grid_metadata")) {
    const { cells, ...metadata } = inputs.grid;
    add("grid_metadata", metadata);
    cells.features.forEach((cell) => add("grid_cell", cell));
  }
  if (wants("sensor")) inputs.sensors.forEach((sensor) => {
    if (!selection || (!selection.topics.includes("air") && !selection.topics.includes("weather"))) {
      add("sensor", sensor);
      return;
    }
    const channelMatches = (key: string) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (selection.topics.includes("air") && /pm25|pm10|no2|ozone|^o3$|particulate/.test(normalized))
        || (selection.topics.includes("weather") && /temp|humid|wind|feucht/.test(normalized));
    };
    const latest = Object.fromEntries(Object.entries(sensor.latest).filter(([key]) => channelMatches(key)));
    add("sensor", { ...sensor, latest,
      channelProvenance: Object.fromEntries(Object.entries(sensor.channelProvenance ?? {}).filter(([key]) => channelMatches(key))),
      selectedChannels: Object.keys(latest), omittedChannels: Object.keys(sensor.latest).filter((key) => !channelMatches(key)),
    });
  });
  if (inputs.segments && wants("segment_metadata")) {
    const { scores, ...metadata } = inputs.segments;
    add("segment_metadata", { ...metadata, tupleFields: ["score", "confidence", "flags"] });
    Object.entries(scores).forEach(([id, score]) => add("segment_score", { id, score }));
  }
  if (inputs.segmentDetail) add("segment_detail", inputs.segmentDetail);
  if (wants("device_metadata")) inputs.devices.forEach(({ samples, ...metadata }) => {
    add("device_metadata", { ...metadata, source: "synthetic local fixture", sampleCount: samples.length });
    [...samples].reverse().forEach((sample) => add("device_sample", { ...sample, deviceId: metadata.id, name: metadata.name, source: "synthetic local fixture" }));
  });
  add("ble_metadata", { source: "observed BLE heart-rate device", ...inputs.ble });
  if (!wants("ble_sample")) return records;
  const samples = new Map([...inputs.readings, ...inputs.recent].map((s) => [s.sample_id, s]));
  [...samples.values()].sort((a, b) => b.timestamp_utc.localeCompare(a.timestamp_utc)).forEach((sample) => add("ble_sample", sample));
  return records;
}
