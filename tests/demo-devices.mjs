import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DemoDevices} from '../src/demo-devices.js';
const memory={};const storage={getItem:k=>memory[k]??null,setItem:(k,v)=>memory[k]=v};
const fetcher=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL('../public/'+url,import.meta.url)))});
const tasks=new Set();const devices=new DemoDevices(storage,fetcher,{schedule:fn=>(tasks.add(fn),fn),cancel:fn=>tasks.delete(fn)});
await devices.connect('whoop-demo-01'); await devices.connect('applewatch-demo-01');
assert.deepEqual(devices.list().map(d=>d.samples.length),[1,1]);
for(const task of [...tasks]) task();assert.deepEqual(devices.list().map(d=>d.samples.length),[2,2]);
devices.disconnect('whoop-demo-01'); for(const task of [...tasks])task();
assert.deepEqual(devices.list().map(d=>d.samples.length),[2,3]);assert.equal(devices.list()[0].connected,false);
devices.forget('applewatch-demo-01');for(const task of [...tasks])task();
assert.equal(new DemoDevices(storage,fetcher).list()[1].samples.length,0);assert.equal(devices.list()[0].samples.length,2);
await assert.rejects(devices.connect('unknown'));
console.log('PASS: independent timed playback, retained history and erase after reload');

// Browser fetch requires the global receiver; test the default path as well as injection.
const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async function(url){assert.equal(this,globalThis);return fetcher(url)};
  const defaultFetcherDevices=new DemoDevices(storage,undefined,{schedule:fn=>fn,cancel:()=>{}});
  await defaultFetcherDevices.connect('whoop-demo-01');
  assert.equal(defaultFetcherDevices.list()[0].connected,true);
  defaultFetcherDevices.disconnect('whoop-demo-01');
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: default fetch uses the browser global receiver');

// Browser timer cancellation also requires its global receiver.
const originalClearInterval=globalThis.clearInterval;
try {
  let cancelled=false;
  globalThis.clearInterval=function(id){assert.equal(this,globalThis);assert.equal(id,42);cancelled=true};
  const browserTimers=new DemoDevices(storage,fetcher,{schedule:()=>42});
  await browserTimers.connect('whoop-demo-01');
  browserTimers.disconnect('whoop-demo-01');
  assert.equal(cancelled,true);
  assert.equal(browserTimers.list()[0].connected,false);
  assert.ok(browserTimers.list()[0].samples.length);
} finally {globalThis.clearInterval=originalClearInterval;}
console.log('PASS: default timer cancellation uses the browser global receiver');
