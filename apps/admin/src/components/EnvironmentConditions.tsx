'use client';

import { useState } from 'react';
import { Leaf, RefreshCw, Thermometer, Wind, Droplets, MapPin } from 'lucide-react';
import { useAdmin } from './AdminProvider';
import { useNow } from './Shell';
import { btnOutline, card, field, Skeleton } from './ui';
import { useEnvironment } from '@/lib/use-environment';
import { channelReading, currentForecast, forecastStale, POLLUTANTS, type ForecastDay, type Station } from '@/lib/environment';
import { ago, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const number = (v: number | null | undefined) => v == null ? 'Unavailable' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(v);
const time = (at: number | null) => at == null ? 'Time unavailable' : `${fmtDateTime(at)} Berlin`;
const source = (s: Station) => s.kind === 'lubw' ? 'UBA / LUBW' : 'openSenseMap';

function Reading({ station, channel, now }: { station: Station; channel: string; now: number }) {
  const r = channelReading(station, channel, now);
  return <div><span className="font-bold">{number(r.value)}{r.value != null && <span className="ml-1 text-xs font-normal text-mute">{r.provenance?.unit}</span>}</span><span className={cn('mt-1 block text-xs', r.stale ? 'text-[#8a5f00]' : 'text-mute')} title={time(r.at)}>{r.value == null ? 'Missing / quality filtered' : `${r.stale ? 'Stale · ' : ''}${r.at == null ? 'Time unavailable' : ago(r.at, now)}`}</span>{!!r.provenance?.qcFlags.length && <span className="block text-xs text-mute">QC: {r.provenance.qcFlags.join(', ')}</span>}</div>;
}

export default function EnvironmentConditions() {
  const { settings } = useAdmin();
  const { stations, forecast, network, loading, refresh } = useEnvironment(settings.backendUrl);
  const now = useNow();
  const [selected, setSelected] = useState('');
  const [exposure, setExposure] = useState('outdoor');
  const [provider, setProvider] = useState('all');
  const measured = stations.data ?? [];
  const outdoor = measured.filter(s => s.exposure === 'outdoor');
  const station = measured.find(s => s.id === selected) ?? outdoor.find(s => s.kind === 'lubw' && 'NO2' in s.latest) ?? outdoor[0];
  const hour = currentForecast(forecast.data, now);
  const staleForecast = forecast.data ? forecastStale(forecast.data, now) : false;
  const visible = measured.filter(s => (exposure === 'all' || s.exposure === exposure) && (provider === 'all' || (provider === 'official' ? s.kind === 'lubw' : s.kind !== 'lubw')));
  const fresh = measured.filter(s => Object.keys(s.latest).some(k => { const r = channelReading(s, k, now); return r.value != null && !r.stale; })).length;

  return <section aria-labelledby="environment-details" className={cn(card, 'shrink-0 p-4 sm:p-5')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="environment-details" className="flex items-center gap-2 font-display text-xl font-extrabold"><Leaf className="size-5 text-brand" aria-hidden />Measurements and forecasts</h2><p className="mt-1 text-sm text-mute">Station measurements and city forecasts for Heilbronn. Times shown in Europe/Berlin.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className={btnOutline}><RefreshCw aria-hidden className={cn('size-4', loading && 'animate-spin')} />Refresh conditions</button>
    </div>
    {loading && !stations.data && !stations.error ? <Skeleton className="mt-4 h-36" /> : <>
      {stations.error ? <p role="alert" className="mt-4 rounded-xl bg-ok-soft p-3 text-sm text-[#8a5f00]">Station readings: {stations.error}</p> : station ? <>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3"><div className="max-w-full"><label htmlFor="detail-station" className="mb-1 block text-xs font-bold text-mute">Measurement station</label><select id="detail-station" value={station.id} onChange={e => setSelected(e.target.value)} className={cn(field, 'max-w-full sm:w-96')}>{measured.map(s => <option key={s.id} value={s.id}>{s.name} · {source(s)} · {s.exposure ?? 'unknown exposure'}</option>)}</select></div><p className="text-xs text-mute">Measured · {source(station)} · {station.exposure ?? 'Unknown exposure'}</p></div>
        <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">{POLLUTANTS.map(p => <div key={p.key} className="rounded-2xl bg-wash p-4"><p className="font-display text-xl font-extrabold">{p.label}</p><p className="mb-3 text-xs text-mute">{p.name}</p><Reading station={station} channel={p.key} now={now} /></div>)}</div>
      </> : <p className="mt-4 text-sm text-mute">No measured stations available. No sample readings are used.</p>}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span className="font-bold">Measurement coverage</span>{stations.data ? <><span>{fresh} stations with fresh readings</span><span>{measured.length - fresh} stale / no usable readings</span><span>{measured.length} stored stations</span></> : <span className="text-mute">Unavailable</span>}</div>
    </>}
    <div className="mt-3 rounded-xl bg-wash p-3 text-sm">{network.data ? <><span className="font-bold">{network.data.grouptag} network</span><span className="ml-3 text-brand">{network.data.counts.online} online</span><span className="ml-3 text-[#8a5f00]">{network.data.counts.stale} stale</span><span className="ml-3 text-mute">{network.data.counts.no_data} no data</span><p className="mt-1 text-xs text-mute">Tagged network, including surrounding locations · checked {fmtDateTime(Date.parse(network.data.retrieved_at))} Berlin. Counts differ from the stored station inventory above.</p></> : <span className="text-mute">Tagged station network: {network.error ?? 'Loading…'}</span>}</div>
    <div className="mt-5 border-t border-line pt-4"><h3 className="font-bold">City weather forecast</h3>{forecast.error ? <p role="alert" className="mt-2 text-sm text-[#8a5f00]">Forecast: {forecast.error}</p> : !forecast.data ? <p className="mt-2 text-sm text-mute">Loading forecast…</p> : <>
      <p className="mt-1 text-xs text-mute">Model forecast · {hour ? `${String(hour.hour).padStart(2, '0')}:00 Berlin` : 'Current hour unavailable'} · {staleForecast ? 'Stale forecast · ' : ''}Retrieved {forecast.data.retrievedAt ? `${fmtDateTime(Date.parse(forecast.data.retrievedAt))} Berlin` : 'at an unknown time'}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{[{ label: 'Temperature', key: 'tempC', unit: '°C', icon: Thermometer }, { label: 'Humidity', key: 'humidity', unit: '%', icon: Droplets }, { label: 'Wind', key: 'windKmh', unit: 'km/h', icon: Wind }].map(({ label, key, unit, icon: Icon }) => <div key={key} className="flex items-center gap-3 rounded-2xl bg-wash p-3"><Icon className="size-5 text-brand" aria-hidden /><div><p className="text-xs text-mute">{label}</p><p className="font-bold">{number(hour?.[key as 'tempC' | 'humidity' | 'windKmh'])}{hour?.[key as 'tempC' | 'humidity' | 'windKmh'] != null && ` ${unit}`}</p></div></div>)}</div>
    </>}</div>
    <>
      {forecast.data && <HourlyForecast day={forecast.data} />}
      <div className="mt-6 border-t border-line pt-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="flex items-center gap-2 font-display text-lg font-bold"><MapPin aria-hidden className="size-5 text-brand" />Station readings</h3><p className="text-xs text-mute">Community stations include the surrounding area. Indoor readings stay separate from outdoor conditions.</p></div><div className="flex gap-2"><label className="text-xs font-bold text-mute">Exposure<select className={cn(field, 'mt-1')} value={exposure} onChange={e => setExposure(e.target.value)}><option value="outdoor">Outdoor</option><option value="indoor">Indoor</option><option value="all">All exposures</option></select></label><label className="text-xs font-bold text-mute">Provider<select className={cn(field, 'mt-1')} value={provider} onChange={e => setProvider(e.target.value)}><option value="all">All providers</option><option value="official">UBA / LUBW</option><option value="community">openSenseMap</option></select></label></div></div>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><caption className="sr-only">Latest station measurements with channel ages, units and quality flags</caption><thead className="text-xs text-mute"><tr><th className="p-3">Station / location</th>{POLLUTANTS.map(p => <th key={p.key} className="p-3">{p.label}</th>)}<th className="p-3">Temperature</th><th className="p-3">Humidity</th></tr></thead><tbody>{visible.map(s => <tr key={s.id} className="border-t border-line"><th scope="row" className="p-3 font-normal"><button type="button" className="text-left font-bold text-brand hover:underline" onClick={() => setSelected(s.id)}>{s.name}</button><p className="text-xs text-mute">{source(s)} · {s.exposure ?? 'Unknown exposure'}</p><p className="text-xs text-mute">{s.lat.toFixed(4)}° N, {s.lng.toFixed(4)}° E</p></th>{[...POLLUTANTS.map(p => p.key), 'Temperature', 'Humidity'].map(k => <td key={k} className="p-3 align-top"><Reading station={s} channel={k} now={now} /></td>)}</tr>)}</tbody></table>{!visible.length && <p className="p-4 text-sm text-mute">No stations match these filters.</p>}</div>
      </div>
    </>
    <p className="mt-4 text-xs text-mute">Pollutant values are concentrations in µg/m³, not air-quality scores. Missing or quality-filtered readings are unavailable. Regional forecasts do not establish street-level exposure.</p>
  </section>;
}

function HourlyForecast({ day }: { day: ForecastDay }) {
  const [metric, setMetric] = useState<'pm25' | 'no2' | 'tempC' | 'humidity' | 'windKmh'>('pm25');
  const metrics = { pm25: ['PM2.5', 'µg/m³'], no2: ['NO₂', 'µg/m³'], tempC: ['Temperature', '°C'], humidity: ['Humidity', '%'], windKmh: ['Wind', 'km/h'] };
  const [label, unit] = metrics[metric];
  const values = day.hours.flatMap(h => h[metric] == null ? [] : [h[metric] as number]);
  const min = Math.min(0, ...values), max = Math.max(min + 1, ...values);
  const x = (h: number) => 48 + h / 23 * 690;
  const y = (v: number) => 165 - (v - min) / (max - min) * 135;
  let gap = true;
  const path = day.hours.map(h => { const v = h[metric]; if (v == null || !h.instants.length) { gap = true; return ''; } const command = gap ? 'M' : 'L'; gap = false; return `${command}${x(h.hour)},${y(v)}`; }).join(' ');
  return <div className="mt-6 border-t border-line pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-lg font-bold">Hourly city forecast</h3><p className="text-xs text-mute">{day.date} · {day.attribution.join(' / ')} · {day.status}</p></div><label className="text-xs font-bold text-mute">Forecast variable<select value={metric} onChange={e => setMetric(e.target.value as typeof metric)} className={cn(field, 'mt-1')}>{Object.entries(metrics).map(([k, [l, u]]) => <option key={k} value={k}>{l} ({u})</option>)}</select></label></div>
    <svg viewBox="0 0 760 210" role="img" aria-label={`${label} model forecast in ${unit} for ${day.date}. Hourly values in the table below.`} className="mt-4 w-full"><text x="48" y="15" fontSize="12" fill="var(--color-mute)">{label} · {unit}</text>{[min, (min + max) / 2, max].map(v => <g key={v}><line x1="48" x2="738" y1={y(v)} y2={y(v)} stroke="var(--color-line)" /><text x="40" y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-mute)">{number(v)}</text></g>)}{[0, 6, 12, 18, 23].map(h => <text key={h} x={x(h)} y="190" textAnchor="middle" fontSize="11" fill="var(--color-mute)">{String(h).padStart(2, '0')}:00</text>)}<path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="3" />{day.hours.filter(h => h[metric] != null && h.instants.length).map(h => <circle key={h.hour} cx={x(h.hour)} cy={y(h[metric] as number)} r="3" fill="var(--color-brand)"><title>{String(h.hour).padStart(2, '0')}:00 Berlin: {number(h[metric])} {unit}</title></circle>)}</svg>
    {!values.length && <p className="text-sm text-mute">No forecast values available for this variable.</p>}
    <details className="text-sm"><summary className="cursor-pointer font-bold text-brand">View hourly values</summary><div className="mt-2 max-h-60 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Hour (Berlin)</th><th className="p-2">{label} ({unit})</th><th className="p-2">Actual UTC instants</th></tr></thead><tbody>{day.hours.map(h => <tr key={h.hour} className="border-t border-line"><td className="p-2">{String(h.hour).padStart(2, '0')}:00</td><td className="p-2">{number(h[metric])}</td><td className="p-2">{h.instants.join(', ') || 'DST gap'}</td></tr>)}</tbody></table></div></details>
  </div>;
}
