export interface Provenance {
  sourceId: string;
  kind: string;
  observedAt: string[];
  retrievedAt?: string | null;
  unit: string;
  qcFlags: string[];
}

export interface Station {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  source: string;
  exposure?: string | null;
  stale: boolean;
  updatedAt: string;
  latest: Record<string, number | null>;
  channelProvenance: Record<string, Provenance>;
}

export interface ForecastHour {
  hour: number;
  tempC: number | null;
  humidity: number | null;
  pm25: number | null;
  no2: number | null;
  windKmh: number | null;
  instants: string[];
  provenance: Record<string, Provenance>;
}

export interface ForecastDay {
  date: string;
  source: string;
  status: string;
  retrievedAt: string | null;
  attribution: string[];
  hours: ForecastHour[];
}

export const POLLUTANTS = [
  { key: 'NO2', label: 'NO₂', name: 'Nitrogen dioxide' },
  { key: 'PM2.5', label: 'PM2.5', name: 'Fine particulate matter' },
  { key: 'PM10', label: 'PM10', name: 'Particulate matter' },
  { key: 'O3', label: 'O₃', name: 'Ozone' },
] as const;

export function berlinDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Channel age matters: a station's newest upload can hide an older pollutant reading.
export function channelReading(station: Station, key: string, now: number) {
  const provenance = station.channelProvenance[key];
  const times = provenance?.observedAt.map(Date.parse) ?? [];
  const oldest = times.length ? Math.min(...times) : NaN;
  const value = station.latest[key];
  const measured = station.source === 'measured' && provenance?.kind === 'observation';
  const stale = !Number.isFinite(oldest) || now - oldest > (station.kind === 'lubw' ? 3 * 3600000 : 30 * 60000) || oldest > now;
  return { value: measured && typeof value === 'number' && Number.isFinite(value) ? value : null, provenance, at: Number.isFinite(oldest) ? oldest : null, stale };
}

export function currentForecast(day: ForecastDay | null, now: number) {
  if (!day || day.source !== 'forecast' || day.date !== berlinDate(now)) return null;
  return day.hours.find(h => h.instants.some(t => now >= Date.parse(t) && now < Date.parse(t) + 3600000)) ?? null;
}

export function forecastStale(day: ForecastDay, now: number) {
  const retrieved = Date.parse(day.retrievedAt ?? '');
  return day.status === 'stale' || !Number.isFinite(retrieved) || now - retrieved > 3 * 3600000;
}

export interface NetworkStatus {
  source: string;
  grouptag: string;
  retrieved_at: string;
  counts: { online: number; stale: number; no_data: number };
}
