import assert from 'node:assert/strict';
import { test } from 'node:test';
import { berlinDate, channelReading, currentForecast, forecastStale, type ForecastDay, type Station } from '../src/lib/environment';

const now = Date.parse('2026-10-29T10:30:00Z');
const station: Station = {
  id: 'uba-DEBW015', name: 'Synthetic test station', source: 'measured', kind: 'lubw',
  lat: 49.16, lng: 9.22, exposure: 'outdoor', stale: false,
  updatedAt: '2026-10-29T10:25:00Z', latest: { NO2: 0, O3: null, PM10: 7 },
  channelProvenance: {
    NO2: { sourceId: 'uba', kind: 'observation', unit: 'µg/m³', observedAt: ['2026-10-29T06:00:00Z'], qcFlags: [] },
    O3: { sourceId: 'uba', kind: 'observation', unit: 'µg/m³', observedAt: ['2026-10-29T10:00:00Z'], qcFlags: ['quality_filtered'] },
  },
};

test('channel freshness uses measurement time, preserves zero, and does not hide old channels behind new uploads', () => {
  assert.equal(channelReading(station, 'NO2', now).value, 0);
  assert.equal(channelReading(station, 'NO2', now).stale, true);
  assert.equal(channelReading(station, 'O3', now).value, null);
  assert.equal(channelReading(station, 'missing', now).value, null);
  assert.equal(channelReading(station, 'PM10', now).value, null);
  assert.equal(channelReading({ ...station, source: 'mock' }, 'NO2', now).value, null);
  assert.equal(channelReading({ ...station, channelProvenance: { NO2: { ...station.channelProvenance.NO2, kind: 'model' } } }, 'NO2', now).value, null);
});

test('community measurements age out after 30 minutes; missing and future timestamps remain unverified', () => {
  const community = { ...station, kind: 'sensebox_home' };
  const withTime = (time: string) => ({ ...community, channelProvenance: { NO2: { ...station.channelProvenance.NO2, observedAt: [time] } } });
  assert.equal(channelReading(withTime('2026-10-29T10:01:00Z'), 'NO2', now).stale, false);
  assert.equal(channelReading(withTime('2026-10-29T09:59:00Z'), 'NO2', now).stale, true);
  assert.equal(channelReading(withTime('2026-10-29T11:00:00Z'), 'NO2', now).stale, true);
  assert.equal(channelReading(withTime('invalid'), 'NO2', now).at, null);
});

const day = (date: string, instants: string[]): ForecastDay => ({ date, source: 'forecast', status: 'partial', retrievedAt: '2026-10-29T10:00:00Z', attribution: [], hours: [{ hour: 2, instants, tempC: 5, pm25: 0, no2: null, humidity: 80, windKmh: 2, provenance: {} }] });

test('Berlin dates and current forecasts use real instants across midnight and DST folds', () => {
  assert.equal(berlinDate(Date.parse('2026-10-29T23:30:00Z')), '2026-10-30');
  const fold = day('2026-10-25', ['2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z']);
  assert.equal(currentForecast(fold, Date.parse('2026-10-25T01:30:00Z'))?.tempC, 5);
  assert.equal(currentForecast(day('2026-03-29', []), Date.parse('2026-03-29T01:30:00Z')), null);
  assert.equal(currentForecast(day('2026-10-29', ['2026-10-29T09:00:00Z']), now), null);
  assert.equal(currentForecast({ ...fold, source: 'mock' }, Date.parse('2026-10-25T01:30:00Z')), null);
});

test('forecast age comes from retrieval, independently of future forecast valid times', () => {
  assert.equal(forecastStale(day('2026-10-30', ['2026-10-30T10:00:00Z']), now), false);
  assert.equal(forecastStale({ ...day('2026-10-30', []), retrievedAt: '2026-10-29T06:00:00Z' }, now), true);
  assert.equal(forecastStale({ ...day('2026-10-30', []), retrievedAt: null }, now), true);
});
