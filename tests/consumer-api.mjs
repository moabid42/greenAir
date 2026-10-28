import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ConsumerClient,SnapshotStore,ConsumerEvents,validateSnapshot,utcHour,flagsInfo} from '../src/consumer-api.js';
import {SegmentOverlay} from '../src/segment-overlay.js';
const fixture=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const first=validateSnapshot(fixture('mock_scores_running_2026-10-29T13Z.json'));
const second=validateSnapshot(fixture('mock_scores_missing_previous_id_2026-10-29T14Z.json'));
assert.equal(first.scores['10235'][0],0);assert.equal(first.scores['999'],undefined);assert.deepEqual(flagsInfo(31),{rain:true,air:true,alert:true,interpolated:true,stale:true});
assert.equal(utcHour('2026-10-29T14:00:00+01:00'),'2026-10-29T13:00:00Z');
assert.notEqual(utcHour('2026-10-25T02:00:00+02:00'),utcHour('2026-10-25T02:00:00+01:00'));
assert.throws(()=>validateSnapshot({...first,profile:'strength'}));assert.throws(()=>validateSnapshot({...first,scores:{'1':[0,1.1,0]}}));
const calls=[];let bad=false;const client=new ConsumerClient('https://example.invalid',async url=>{calls.push(url);return bad?{ok:false,status:503,headers:{get:()=> '30'}}:{ok:true,json:async()=>first}});
const store=new SnapshotStore(client);let result=await store.select(first.profile,first.t);assert.equal(result.source_type,'live_forecast');bad=true;result=await store.select(first.profile,first.t);assert.equal(result.source_type,'stale_live');assert.equal(result.error.retryAfter,'30');result=await store.select('cycling',first.t);assert.equal(result.source_type,'illustrative');
await assert.rejects(()=>client.routeScore({profile:'running',t:first.t}));assert.ok(calls.every(x=>!x.includes('/route-score')));
const states=new Map(),sources=new Map(),layers=new Map();const map={getLayer:k=>layers.get(k),removeLayer:k=>layers.delete(k),getSource:k=>sources.get(k),removeSource:k=>sources.delete(k),addSource:(k,v)=>sources.set(k,v),getStyle:()=>({layers:[]}),addLayer:l=>layers.set(l.id,l),setFeatureState:(ref,v)=>{assert.equal(ref.sourceLayer,'segments');states.set(ref.id,v)},removeFeatureState:ref=>states.delete(ref.id)};
const overlay=new SegmentOverlay(map,client);overlay.switchBuild(first.build_id);assert.equal(overlay.apply(first),true);assert.equal(states.get(10235).score,0);assert.equal(overlay.apply({...second,build_id:'different'}),false);assert.equal(overlay.apply({...second,build_id:first.build_id}),true);assert.equal(states.has(10235),false);
let fake;class FakeEvents {constructor(){fake=this;this.handlers={}}addEventListener(name,fn){this.handlers[name]=fn}close(){this.closed=true}}
let notices=0;const events=new ConsumerEvents(client,{EventSourceClass:FakeEvents,onScores:()=>notices++});events.start();fake.handlers['scores.updated']({data:JSON.stringify({profile:first.profile,t:first.t})});assert.equal(notices,1);events.stop();assert.equal(fake.closed,true);
console.log('PASS: consumer validation, zero/missing, flags, DST, stale fallback, segment joins and event cleanup');

// Out-of-order responses cannot overwrite a newer selection.
const pending=[];const raceStore=new SnapshotStore({scores:(p,t)=>new Promise(resolve=>pending.push({p,t,resolve}))});
const old=raceStore.select(first.profile,first.t);const fresh=raceStore.select(second.profile,second.t);
pending[1].resolve(second);assert.equal((await fresh).data.t,second.t);pending[0].resolve(first);assert.equal(await old,null);
const limited=new ConsumerClient('https://example.invalid',async()=>({ok:false,status:413,headers:{get:()=>null}}));
await assert.rejects(()=>limited.segments([9,49,10,50]),e=>e.status===413);
console.log('PASS: request race protection and bounded area failure');
