import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {cloudProxy} from '../cloud-proxy.js';
import {CloudInferenceEngine} from '../src/cloud-inference.js';
const messages=[{role:'system',content:'rules'},{role:'user',content:'hello'}];let upstream;
const proxy=cloudProxy({getKey:()=> 'server-key',fetcher:async(url,opts)=>{upstream={url,opts};return {ok:true,json:async()=>({choices:[{message:{content:'Hello'}}]})}}});
async function call(origin='http://localhost:5173',address='127.0.0.1'){const req=Readable.from([JSON.stringify({messages})]);req.url='/api/ai/chat';req.method='POST';req.headers={origin,host:'localhost:5173'};req.socket={remoteAddress:address};const res={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};await proxy(req,res,()=>{});return res}
const response=await call();assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),{text:'Hello'});assert.equal(JSON.parse(upstream.opts.body).model,'recursive/flint-v1.0:free');assert.equal(JSON.parse(upstream.opts.body).max_tokens,1024);assert.equal(response.body.includes('server-key'),false);
assert.equal((await call('https://evil.example')).statusCode,403);assert.equal((await call('http://localhost:5173','10.0.0.5')).statusCode,403);
let captured;const client=new CloudInferenceEngine(async(url,opts)=>{captured={url,opts};return {ok:true,json:async()=>({text:'Hi'})}});assert.equal(await client.generate(messages,()=>{}),'Hi');assert.equal(captured.url,'/api/ai/chat');
console.log('PASS: local cloud proxy routing, origin protection, key isolation and mocked response');
let warning;
const originalWarn=console.warn;console.warn=(...args)=>{warning=args};
try {
 const emptyProxy=cloudProxy({getKey:()=> 'server-key',fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'',reasoning:'private content'}}],usage:{completion_tokens_details:{reasoning_tokens:105}}})})});
 const req=Readable.from([JSON.stringify({messages})]);Object.assign(req,{url:'/api/ai/chat',method:'POST',headers:{origin:'http://localhost:5173',host:'localhost:5173'},socket:{remoteAddress:'127.0.0.1'}});
 const res={setHeader(){},end(body){this.body=body}};await emptyProxy(req,res,()=>{});assert.equal(res.statusCode,502);assert.match(res.body,/finish: length; reasoning tokens: 105/);assert.equal(JSON.stringify(warning).includes('private content'),false);
} finally {console.warn=originalWarn}
console.log('PASS: empty reasoning-only responses provide safe diagnostics');
