import { defineConfig, loadEnv } from 'vite';
import {cloudProxy} from './cloud-proxy.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Serve the two local runtime assets before Vite's module transform middleware.
// Production builds already copy public/ verbatim.
export function localWllamaAssets(){
  const assets=new Map([
    ['/wllama/index.js',['wllama/index.js','text/javascript; charset=utf-8']],
    ['/wllama/wasm/wllama.wasm',['wllama/wasm/wllama.wasm','application/wasm']]
  ]);
  return {name:'local-wllama-assets',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const path=new URL(req.url,'http://localhost').pathname;const asset=assets.get(path);
    if(!asset || !['GET','HEAD'].includes(req.method))return next();
    const file=resolve(server.config.publicDir,asset[0]);
    try{const info=await stat(file);if(!info.isFile())return next();res.statusCode=200;res.setHeader('Content-Type',asset[1]);res.setHeader('Content-Length',info.size);if(req.method==='HEAD')return res.end();createReadStream(file).on('error',()=>res.destroy()).pipe(res)}catch(e){if(e.code==='ENOENT')return next();next(e)}
  })}};
}
export default defineConfig(({mode})=>{const env=loadEnv(mode,process.cwd(),'');return {
  plugins:[localWllamaAssets(),{name:'local-cloud-ai',configureServer(server){server.middlewares.use(cloudProxy({getKey:()=>process.env.OPENROUTER_API_KEY||env.OPENROUTER_API_KEY}))}}],
  esbuild: false,
  build: { target: 'esnext', minify: false, cssMinify: false }
}});
