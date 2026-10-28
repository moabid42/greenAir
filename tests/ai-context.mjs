import assert from 'node:assert/strict';
import {AI_DISK_LIMIT,fitsAiBudget,buildTurnContext} from '../src/ai-context.js';
let n=0;const fetchLatest=async()=>({timeSlices:[{time:'t',sportSuitability:{running:{value:++n,mode:'demo'}},weather:{},air:{},traffic:{}}]});
const device={name:'WHOOP (Demo)',connected:false,samples:[{timestamp:'2026-10-29T15:00:00+01:00',heartRateBpm:140}]};
const args={fetchLatest,time:'t',activity:'running',devices:[device],allowWearables:true};
assert.equal((await buildTurnContext(args)).environmental.suitability.value,1);
const next=await buildTurnContext(args);assert.equal(next.environmental.suitability.value,2);assert.equal(next.wearableHistory[0].status,'disconnected');
assert.deepEqual((await buildTurnContext({...args,devices:[]})).wearableHistory,[]);
assert.deepEqual((await buildTurnContext({...args,allowWearables:false})).wearableHistory,[]);
assert.equal(fitsAiBudget({model:AI_DISK_LIMIT}),true);assert.equal(fitsAiBudget({model:AI_DISK_LIMIT,history:1}),false);assert.equal(fitsAiBudget({model:-1}),false);
console.log('PASS: fresh ephemeral context, wearable permission and disk budget arithmetic');

const two=[device,{id:'applewatch-demo-01',name:'Apple Watch',connected:false,samples:[{timestamp:'2026-10-29T15:00:00+01:00',heartRateBpm:90}]}];
const permitted=await buildTurnContext({...args,devices:two,allowedDeviceIds:['applewatch-demo-01']});
assert.equal(permitted.wearableHistory.length,1);assert.equal(permitted.wearableHistory[0].device,'Apple Watch');
