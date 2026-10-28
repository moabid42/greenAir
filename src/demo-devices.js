// Fixed, synthetic scenario. Browser history stays local and is never uploaded.
const definitions = {
  'whoop-demo-01': {name:'WHOOP', file:'whoop_demo_2026-10-29.json'},
  'applewatch-demo-01': {name:'Apple Watch', file:'apple_watch_demo_2026-10-29.json'}
};
export class DemoDevices {
  constructor(storage, fetcher = (...args) => globalThis.fetch(...args), options = {}) {
    this.storage=storage || globalThis.localStorage || {getItem:()=>null,setItem:()=>{throw Error('Local storage unavailable')}};
    this.fetcher=fetcher; this.key='ecomab-demo-devices-v4'; this.timers=new Map(); this.generation=new Map();
    this.schedule=options.schedule || ((fn)=>setInterval(fn,3000)); this.cancel=options.cancel || ((id)=>globalThis.clearInterval(id)); this.onChange=options.onChange || (()=>{});
    // Playback cannot remain connected across a page reload.
    const data=this.read(); for(const record of Object.values(data)) record.connected=false;
    if(Object.keys(data).length) this.write(data);
  }
  read() { try { const x=JSON.parse(this.storage.getItem(this.key)||'{}'); return x && typeof x==='object' ? x : {}; } catch { return {}; } }
  write(data) { this.storage.setItem(this.key,JSON.stringify(data)); }
  list() { const data=this.read(); return Object.entries(definitions).map(([id,info])=>({id,...info,connected:false,samples:[],...data[id]})); }
  async connect(id) {
    if (!definitions[id]) throw Error('Unknown sample device');
    this.disconnect(id); const generation=this.generation.get(id);
    const response=await this.fetcher('fixtures/'+definitions[id].file); if(!response.ok) throw Error('Sample session unavailable');
    const fixture=await response.json(); if(fixture.deviceId!==id || !Array.isArray(fixture.samples)) throw Error('Invalid sample session');
    if(this.generation.get(id)!==generation) return;
    const data=this.read(); data[id]={connected:true,samples:data[id]?.samples || []}; this.write(data);
    let index=0;
    const step=()=>{
      const current=this.read(); if(!current[id]?.connected || this.generation.get(id)!==generation) return;
      const sample=fixture.samples[index++];
      if(sample && !current[id].samples.some(x=>x.timestamp===sample.timestamp)) current[id].samples.push(sample);
      this.write(current); this.onChange();
      if(index>=fixture.samples.length){current[id].summary=fixture.summary || null;this.write(current);this.onChange();this.cancel(this.timers.get(id));this.timers.delete(id);}
    };
    step(); if(index<fixture.samples.length) this.timers.set(id,this.schedule(step));
  }
  disconnect(id) { this.generation.set(id,(this.generation.get(id)||0)+1); if(this.timers.has(id)){this.cancel(this.timers.get(id));this.timers.delete(id);} const data=this.read(); if(data[id]) {data[id].connected=false; this.write(data);} }
  forget(id) { this.disconnect(id); const data=this.read(); delete data[id]; this.write(data); }
}
