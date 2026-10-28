import assert from 'node:assert/strict';
import {BrowserInferenceEngine,VisibleText,validateModel,inspectQwenMetadata} from '../src/local-inference.js';
const data=new Uint8Array(1024*1024);data.set([71,71,85,70]);const file=new File([data],'qwen.gguf');
await validateModel(file);await assert.rejects(validateModel(new File([data],'bad.txt')));await assert.rejects(validateModel(new File(['not GGUF'],'bad.gguf')));
const filter=new VisibleText();assert.equal(filter.push('<thi'),'');assert.equal(filter.push('nk>secret</thi'),'');assert.equal(filter.push('nk>Hello'),'Hello');assert.equal(filter.push('! ',true),'Hello! ');
let exited=false,options,params;
class FakeWllama{async loadModel(files,opts){assert.equal(files[0],file);params=opts}getChatTemplate(){return 'template'}getModelMetadata(){return {meta:{'general.name':'test'}}}async createChatCompletion(o){options=o;return (async function*(){yield {choices:[{delta:{content:'<think>secret</think>Hello'}}]};yield {choices:[{delta:{content:' world'}}]}})()}async exit(){exited=true}}
const engine=new BrowserInferenceEngine(async()=>({Wllama:FakeWllama}));await engine.load(file);let text='';assert.equal(await engine.generate([{role:'user',content:'hi'}],x=>text=x),'Hello world');assert.equal(text,'Hello world');assert.equal(options.chat_template_kwargs.enable_thinking,false);assert.equal(options.max_tokens,96);assert.equal(params.n_ctx,2048);await engine.unload();assert.equal(exited,true);
console.log('PASS: GGUF header validation, reasoning filtering and mocked streaming engine lifecycle');

assert.deepEqual(inspectQwenMetadata({meta:{'general.architecture':'qwen3','general.file_type':'17'},hparams:{nLayer:28,nEmbd:1024}}),{architectureConfirmed:true,sizeConfirmed:true,quantizationConfirmed:true});
assert.throws(()=>inspectQwenMetadata({meta:{'general.architecture':'llama'}}));
assert.throws(()=>inspectQwenMetadata({meta:{'general.file_type':'15'}}));
const stray=new VisibleText();assert.equal(stray.push('</thi'),'');assert.equal(stray.push('nk>Answer',true),'Answer');
console.log('PASS: Qwen3 metadata checks and split reasoning delimiters');
const attempts=[];let cleanup=0;
class FakeGpuRuntime extends FakeWllama {async loadModel(files,opts){attempts.push(opts.n_gpu_layers);if(opts.n_gpu_layers)throw Error('GPU allocation failed')}async exit(){cleanup++}}
const gpuEngine=new BrowserInferenceEngine(async()=>({Wllama:FakeGpuRuntime}),{gpu:{requestAdapter:async()=>({})}});
const fallback=await gpuEngine.load(file);assert.deepEqual(attempts,[999,0]);assert.equal(fallback.backend,'cpu_fallback');assert.equal(cleanup,1);await gpuEngine.unload();
class GpuSuccess extends FakeWllama {async loadModel(files,opts){assert.equal(opts.n_gpu_layers,999)}}
const gpuSuccess=new BrowserInferenceEngine(async()=>({Wllama:GpuSuccess}),{gpu:{requestAdapter:async()=>({})}});assert.equal((await gpuSuccess.load(file)).backend,'gpu_requested');await gpuSuccess.unload();
console.log('PASS: GPU request and CPU fallback on allocation failure (mock runtime)');
const logs=[];const logger={info:(...x)=>logs.push(x.join(' ')),warn:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))};
class FailedRuntime extends FakeWllama {async createChatCompletion(){throw new Error('secret question and sensor values')}}
const failedEngine=new BrowserInferenceEngine(async()=>({Wllama:FailedRuntime}),{logger});await failedEngine.load(file);await assert.rejects(()=>failedEngine.generate([{role:'user',content:'secret question'}],()=>{}));await failedEngine.unload();assert.ok(logs.some(x=>x.includes('Generation failed')));assert.ok(logs.every(x=>!x.includes('secret question')));
console.log('PASS: generation failure logging excludes private content');
let terminated=false;
class HungRuntime extends FakeWllama {async createChatCompletion(){return {[Symbol.asyncIterator](){return {next:()=>new Promise(()=>{})}}}}async exit(){terminated=true}}
const hung=new BrowserInferenceEngine(async()=>({Wllama:HungRuntime}),{logger});await hung.load(file);
const pending=hung.generate([{role:'user',content:'test'}],()=>{});await new Promise(resolve=>setTimeout(resolve,0));hung.stop();
await assert.rejects(Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('Cancellation timed out')),500))]),e=>e.name==='AbortError');
assert.equal(terminated,true);assert.equal(hung.runtime,null);assert.equal(hung.busy,false);
console.log('PASS: stopping a stalled generation terminates the worker and settles the request');
