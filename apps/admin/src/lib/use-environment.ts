'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { berlinDate, type ForecastDay, type Station, type NetworkStatus } from './environment';

interface Resource<T> { data: T | null; error: string | null }
export function useEnvironment(base: string) {
  const [stations, setStations] = useState<Resource<Station[]>>({ data: null, error: null });
  const [forecast, setForecast] = useState<Resource<ForecastDay>>({ data: null, error: null });
  const [network, setNetwork] = useState<Resource<NetworkStatus>>({ data: null, error: null });
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    async function load<T>(path: string, save: (r: Resource<T>) => void, validate: (v: T) => boolean) {
      try {
        if (!base) throw new Error('Set the backend URL in Settings.');
        const response = await fetch(`${base.replace(/\/$/, '')}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Data unavailable (HTTP ${response.status}).`);
        const data = await response.json() as T;
        if (!validate(data)) throw new Error('Real environmental data is unavailable from this backend.');
        if (current === generation.current) save({ data, error: null });
      } catch (e) {
        if (current === generation.current) save({ data: null, error: e instanceof Error ? e.message : 'Data unavailable.' });
      }
    }
    await Promise.all([
      load<NetworkStatus>('/stations/status', setNetwork, v => v?.source === 'opensensemap' && !!v.counts),
      load<Station[]>('/api/v1/sensors', setStations, v => Array.isArray(v) && v.every(s => s.source === 'measured' && s.latest && s.channelProvenance)),
      load<ForecastDay>(`/v1/days/${berlinDate(Date.now())}`, setForecast, v => v?.source === 'forecast' && Array.isArray(v.hours)),
    ]);
    if (current === generation.current) setLoading(false);
  }, [base]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    setNetwork({ data: null, error: null });
    setStations({ data: null, error: null });
    setForecast({ data: null, error: null });
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    return () => { clearInterval(timer); invalidate(); };
  }, [refresh, invalidate]);
  return { stations, forecast, network, loading, refresh };
}
