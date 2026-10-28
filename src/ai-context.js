// No inference or persistent AI storage is provided here. Context is ephemeral.
export const AI_DISK_LIMIT=1024*1024*1024;
export function fitsAiBudget({model=0,temporary=0,history=0,metadata=0}) {
  return [model,temporary,history,metadata].every(n=>Number.isSafeInteger(n)&&n>=0) && model+temporary+history+metadata<=AI_DISK_LIMIT;
}
export async function buildTurnContext({fetchLatest, time, activity, devices=[], allowWearables=false, allowedDeviceIds=null, preferences=[]}) {
  const environment=await fetchLatest();
  const slice=environment.timeSlices.find(s=>s.time===time);
  const wearableHistory=allowWearables ? devices.filter(d=>d.samples?.length && (!allowedDeviceIds || allowedDeviceIds.includes(d.id))).map(d=>({device:d.name, status:d.connected?'connected':'disconnected', mode:'demo', source_type:'sample_device', is_illustrative:true, lastObservedAt:d.samples.at(-1).timestamp, heartRateBpm:d.samples.at(-1).heartRateBpm})) : [];
  const compact=m=>m?{value:m.value,unit:m.unit,source_type:m.source_type||m.mode,source:m.source,observedAt:m.observedAt}:null;
  return {city:'Heilbronn',timeZone:'Europe/Berlin',environmental:slice?{time:slice.time,suitability:compact(slice.sportSuitability[activity]),weather:Object.fromEntries(Object.entries(slice.weather||{}).map(([k,v])=>[k,compact(v)])),air:Object.fromEntries(Object.entries(slice.air||{}).map(([k,v])=>[k,compact(v)])),traffic:Object.fromEntries(Object.entries(slice.traffic||{}).map(([k,v])=>[k,compact(v)]))}:null,wearableHistory,preferences:preferences.slice(0,20)};
}
