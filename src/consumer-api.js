import {z} from 'zod';
const profile=z.enum(['running','cycling','walking']);
const hour=z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:00:00Z$/).refine(x=>Number.isFinite(Date.parse(x)));
const tuple=z.tuple([z.number().int().min(0).max(100),z.number().min(0).max(1),z.number().int().nonnegative()]);
const snapshot=z.object({profile,t:hour,kind:z.enum(['observed','forecast']),version:z.string().min(1),build_id:z.string().min(1),scores:z.record(tuple)}).refine(x=>Object.keys(x.scores).every(id=>/^\d+$/.test(id)&&Number.isSafeInteger(Number(id))));
const detail=z.object({segment_id:z.number().int().nonnegative(),profile,t:hour,kind:z.enum(['observed','forecast']),score:z.number().min(0).max(100),confidence:z.number().min(0).max(1),components:z.array(z.object({key:z.string(),label:z.string(),value:z.union([z.number(),z.string(),z.null()]),unit:z.string(),goodness:z.number().min(0).max(1),weight:z.number(),contribution:z.number(),source:z.enum(['observed','forecast','static','interpolated'])})),gates:z.array(z.string()),missing:z.array(z.string())}).passthrough();
const best=z.object({segment_id:z.number().int().nonnegative(),profile,hours:z.array(z.object({t:hour,score:z.number().min(0).max(100),confidence:z.number().min(0).max(1),flags:z.number().int().nonnegative()})),best_windows:z.array(z.object({start:z.string(),end:z.string(),mean_score:z.number()}))});
const status=z.object({build_id:z.string().min(1),sources:z.array(z.object({id:z.string(),status:z.enum(['ok','stale','down'])}).passthrough())}).passthrough();
const segments=z.object({type:z.literal('FeatureCollection'),features:z.array(z.object({type:z.literal('Feature'),geometry:z.object({type:z.string(),coordinates:z.array(z.unknown())}),properties:z.object({segment_id:z.number().int().nonnegative()}).passthrough()}))});
export const validateSnapshot=x=>snapshot.parse(x);export const validateScoreDetail=x=>detail.parse(x);export const validateBestTime=x=>best.parse(x);export const validateStatus=x=>status.parse(x);export const validateSegments=x=>segments.parse(x);
export function utcHour(time){const date=new Date(time);if(!Number.isFinite(date.getTime()))throw Error('Invalid time');date.setUTCMinutes(0,0,0);return date.toISOString().replace('.000Z','Z')}
export function flagsInfo(flags){return {rain:!!(flags&1),air:!!(flags&2),alert:!!(flags&4),interpolated:!!(flags&8),stale:!!(flags&16)}}
export class ConsumerClient {
  constructor(base='',fetcher=(...args)=>globalThis.fetch(...args)){this.base=base.replace(/\/$/,'');this.fetcher=fetcher}
  get configured(){return !!this.base}
  tileUrl(build){if(!this.configured)throw Error('Backend not configured');return `${this.base}/tiles/segments/{z}/{x}/{y}.pbf?v=${encodeURIComponent(build)}`}
  async request(path,params={},options={}){if(!this.configured)throw Error('Backend not configured');const url=new URL(this.base+path,globalThis.location?.href);for(const [k,v] of Object.entries(params))if(v!=null)url.searchParams.set(k,String(v));const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);const r=await this.fetcher(url.toString(),{method:options.method||'GET',headers:options.body?{'Content-Type':'application/json',Accept:'application/json'}:{Accept:'application/json'},body:options.body?JSON.stringify(options.body):undefined,cache:'no-store',signal});if(!r.ok){const e=Error(`Backend HTTP ${r.status}`);e.status=r.status;e.retryAfter=r.headers?.get('Retry-After');throw e}return r.json()}
  async scores(p,t,signal){profile.parse(p);hour.parse(t);return validateSnapshot(await this.request('/scores',{profile:p,t},{signal}))}
  async score(lat,lon,p,t){profile.parse(p);hour.parse(t);return validateScoreDetail(await this.request('/score',{lat,lon,profile:p,t}))}
  async bestTime(id,p,from,hours=24){if(!Number.isSafeInteger(id)||id<0)throw Error('A known segment is required');profile.parse(p);hour.parse(from);return validateBestTime(await this.request('/best-time',{segment_id:id,profile:p,from,hours}))}
  async status(){return validateStatus(await this.request('/status'))}
  async segments(bbox){if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite))throw Error('Invalid bounds');return validateSegments(await this.request('/segments',{bbox:bbox.join(',')}))}
  async day(p,date){profile.parse(p);if(!/^\d{4}-\d\d-\d\d$/.test(date))throw Error('Invalid date');return this.request('/scores/day',{profile:p,date})}
  async routeScore(route){profile.parse(route.profile);hour.parse(route.t);if(!(Array.isArray(route.segment_ids)&&route.segment_ids.length&&route.segment_ids.every(Number.isSafeInteger))&&!(typeof route.polyline==='string'&&route.polyline.length))throw Error('Existing route required');return this.request('/route-score',{}, {method:'POST',body:route})}
}
export class SnapshotStore {
  constructor(client){this.client=client;this.cache=new Map();this.generation=0;this.abort=null}
  async select(profileName,t){const key=profileName+'|'+t;this.abort?.abort();const controller=new AbortController();this.abort=controller;const generation=++this.generation;try{const data=await this.client.scores(profileName,t,controller.signal);if(data.profile!==profileName||data.t!==t)throw Error('Snapshot does not match selection');if(generation!==this.generation)return null;this.cache.set(key,data);return {data,source_type:data.kind==='observed'?'live_observed':'live_forecast'}}catch(error){if(generation!==this.generation)return null;const previous=this.cache.get(key);return previous?{data:previous,source_type:'stale_live',error}:{data:null,source_type:'illustrative',error}}}
}

/** EventSource owns its built-in reconnect; fallback polling never requests scores. */
export class ConsumerEvents {
  constructor(client,{onScores=()=>{},onBuild=()=>{},onStatus=()=>{},EventSourceClass=globalThis.EventSource}={}){this.client=client;this.onScores=onScores;this.onBuild=onBuild;this.onStatus=onStatus;this.EventSourceClass=EventSourceClass;this.source=null;this.poll=null}
  start(){if(!this.client.configured||this.source||!this.EventSourceClass)return;this.source=new this.EventSourceClass(this.client.base+'/events');this.source.addEventListener('scores.updated',e=>{try{const v=JSON.parse(e.data);if(profile.safeParse(v.profile).success&&hour.safeParse(v.t).success)this.onScores(v)}catch{}});this.source.addEventListener('segments.rebuilt',e=>{try{const v=JSON.parse(e.data);if(typeof v.build_id==='string'&&v.build_id)this.onBuild(v)}catch{}});this.source.onerror=()=>{if(!this.poll)this.poll=setInterval(()=>this.client.status().then(this.onStatus).catch(()=>{}),300000)};this.source.onopen=()=>{if(this.poll){clearInterval(this.poll);this.poll=null}}}
  stop(){this.source?.close();this.source=null;if(this.poll){clearInterval(this.poll);this.poll=null}}
}
