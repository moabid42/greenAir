import { z } from 'zod';

const metricSchema = z.object({
  value: z.number().finite(), unit: z.string().min(1).max(30),
  source: z.string().min(1).max(120), observedAt: z.string().refine(v => Number.isFinite(Date.parse(v))),
  confidence: z.union([z.number().min(0).max(1), z.string().max(40)]).optional(),
  mode: z.enum(['live', 'stale', 'demo']).optional()
});
const sliceSchema = z.object({time: z.string().refine(v => /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)))}).passthrough();
const categories = ['weather', 'air', 'traffic', 'sportSuitability'];

/** Normalize only the documented provisional schema; preserve provenance per field. */
export function normalizeEnvironment(demo, raw, {now = Date.now(), reason = 'Missing or invalid live field'} = {}) {
  const liveSlices = Array.isArray(raw?.timeSlices) ? raw.timeSlices : [];
  const slices = (Array.isArray(demo?.timeSlices) ? demo.timeSlices : []).filter(s => sliceSchema.safeParse(s).success).map(fallback => {
    const match = liveSlices.find(s => sliceSchema.safeParse(s).success && Date.parse(s.time) === Date.parse(fallback.time));
    const result = {time:fallback.time, timeZone:'Europe/Berlin'};
    for (const category of categories) {
      result[category] = {};
      for (const [key, base] of Object.entries(fallback[category] || {})) {
        const parsed = metricSchema.safeParse(match?.[category]?.[key]);
        const fallbackMetric = metricSchema.safeParse(base);
        const receivedAt = new Date(now).toISOString();
        if (parsed.success && parsed.data.mode !== 'demo' && parsed.data.unit === base.unit) {
          const item = parsed.data;
          const stale = item.mode === 'stale' || now - Date.parse(item.observedAt) > 6 * 60 * 60 * 1000;
          result[category][key] = {...item, mode:stale?'stale':'live', source_type:stale?'stale_live':'live_observed', source_timestamp:item.observedAt, is_illustrative:false, receivedAt, confidence:item.confidence ?? 'unknown'};
        } else if (fallbackMetric.success) {
          result[category][key] = {...fallbackMetric.data, mode:'demo', source_type:'illustrative', source_timestamp:fallbackMetric.data.observedAt, is_illustrative:true, receivedAt, reason, confidence:'synthetic'};
        } else {
          result[category][key] = {value:null, unit:base?.unit || '', mode:'unavailable', source_type:'unavailable', source_timestamp:null, is_illustrative:false, source:'unavailable', observedAt:null, receivedAt, reason, confidence:'unknown'};
        }
      }
    }
    return result;
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  return {city:'Heilbronn', timeZone:'Europe/Berlin', timeSlices:slices};
}
export async function fetchEnvironment({url='', fetcher=fetch, now=Date.now()} = {}) {
  const demoResponse = await fetcher('fixtures/environment_heilbronn_2026-10-29.json', {cache:'no-store'});
  if (!demoResponse.ok) throw Error('Demo scenario unavailable');
  const demo = await demoResponse.json();
  let raw = null, reason = url ? 'Backend unavailable or invalid' : 'Backend not configured';
  if (url) {
    try {
      const response = await fetcher(url, {headers:{Accept:'application/json'}, cache:'no-store', signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw Error('Backend unavailable');
      raw = await response.json();
      reason = 'Field absent or invalid in backend response';
    } catch { /* deterministic local fallback */ }
  }
  return normalizeEnvironment(demo, raw, {now, reason});
}
