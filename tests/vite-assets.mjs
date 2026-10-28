import assert from 'node:assert/strict';
import {mkdtemp, mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import {localWllamaAssets} from '../vite.config.js';
const root=await mkdtemp(join(tmpdir(),'ecomab-assets-'));
try{
 await mkdir(join(root,'wllama','wasm'),{recursive:true});await writeFile(join(root,'wllama','index.js'),'export const Wllama = 1;');await writeFile(join(root,'wllama','wasm','wllama.wasm'),'wasm');
 let handler;localWllamaAssets().configureServer({config:{publicDir:root},middlewares:{use(fn){handler=fn}}});
 async function request(url){let content='';let next=false;const res=new Writable({write(c,e,cb){content+=c;cb()}});res.headers={};res.setHeader=(k,v)=>res.headers[k]=v;const finished=new Promise(resolve=>res.on('finish',resolve));await handler({url,method:'GET'},res,()=>{next=true;res.end()});await finished;return {content,next,res}}
 const js=await request('/wllama/index.js?import');assert.match(js.content,/export const Wllama/);assert.match(js.res.headers['Content-Type'],/javascript/);assert.equal(js.next,false);
 const wasm=await request('/wllama/wasm/wllama.wasm');assert.equal(wasm.res.headers['Content-Type'],'application/wasm');
 assert.equal((await request('/wllama/other.js')).next,true);
 console.log('PASS: Vite serves local Wllama JS and WASM without module transformation');
}finally{await rm(root,{recursive:true,force:true})}
