// Shared browser engine boundary. No model or conversation is transmitted.
export async function validateModel(file){
  if(!file || !/\.gguf$/i.test(file.name))throw Error('Choose a .gguf model file.');
  if(file.size<1024*1024 || file.size>2*1024**3)throw Error('The file must be a GGUF model between 1 MiB and 2 GiB.');
  const bytes=new Uint8Array(await file.slice(0,4).arrayBuffer());
  if(String.fromCharCode(...bytes)!=='GGUF')throw Error('This file does not have a GGUF header.');
}
// Withhold partial tags and everything inside thinking blocks while streaming.
export class VisibleText {
  constructor(){this.buffer='';this.hidden=false;this.output=''}
  push(chunk,final=false){
    this.buffer+=chunk;
    while(this.buffer){
      const tags=this.hidden?['</think>']:['<think>','</think>'];
      const matches=tags.map(tag=>({tag,at:this.buffer.indexOf(tag)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at);
      if(matches.length){const {tag,at}=matches[0];if(!this.hidden)this.output+=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+tag.length);this.hidden=tag==='<think>';continue}
      let keep=0;if(!final)for(const tag of tags)for(let n=1;n<tag.length;n++)if(this.buffer.endsWith(tag.slice(0,n)))keep=Math.max(keep,n);
      if(!this.hidden)this.output+=this.buffer.slice(0,this.buffer.length-keep);
      this.buffer=this.buffer.slice(this.buffer.length-keep);break;
    }
    if(final)this.buffer='';return this.output;
  }
}
// Fail on contradicting metadata; missing quantization metadata is disclosed, not guessed.
export function inspectQwenMetadata(metadata){
  const meta=metadata?.meta||{}, h=metadata?.hparams||{};
  const arch=meta['general.architecture'];
  if(arch && String(arch).toLowerCase()!=='qwen3')throw Error('This model is not Qwen3. Choose Qwen3-0.6B Q5_K_M.');
  if(h.nLayer && h.nLayer!==28 || h.nEmbd && h.nEmbd!==1024)throw Error('Model dimensions do not match Qwen3-0.6B.');
  const type=meta['general.file_type'];
  if(type!=null && String(type)!=='17')throw Error('The GGUF quantization is not Q5_K_M.');
  return {architectureConfirmed:!!arch, sizeConfirmed:!!h.nLayer&&!!h.nEmbd, quantizationConfirmed:type!=null};
}
export class BrowserInferenceEngine {
  constructor(loader=()=>{const modulePath='/wllama/index.js';return import(/* @vite-ignore */ modulePath)}, {gpu=globalThis.navigator?.gpu,logger=console}={}){this.loader=loader;this.gpu=gpu;this.logger=logger;this.runtime=null;this.abort=null;this.busy=false;this.backend='unloaded'}
  async load(file){
    this.logger.info('[EcoMAB AI] Model load started.');
    await validateModel(file);if(!globalThis.WebAssembly)throw Error('WebAssembly is unavailable in this browser.');
    let Wllama;try{({Wllama}=await this.loader())}catch{throw Error('Local inference assets are missing. Install @wllama/wllama@3.8.1 and run npm run setup:ai, then reload.')}
    let gpuAvailable=false;try{gpuAvailable=!!(await this.gpu?.requestAdapter())}catch{/* CPU fallback */}
    const create=()=>new Wllama({default:'/wllama/wasm/wllama.wasm'},{suppressNativeLog:true,logger:{debug(){},log(){},warn(){},error(){}}});
    const options={n_ctx:2048,n_threads:1,n_parallel:1,jinja:true};
    let instance=create(),backend=gpuAvailable?'gpu_requested':'cpu';this.runtime=instance;this.logger.info('[EcoMAB AI] Loading runtime:',backend);
    try{
      try{await instance.loadModel([file],{...options,n_gpu_layers:gpuAvailable?999:0})}
      catch(e){if(!gpuAvailable)throw e;this.logger.warn('[EcoMAB AI] GPU load failed; retrying on CPU. Error type:',e?.name||'Error');await instance.exit().catch(()=>{});instance=create();this.runtime=instance;backend='cpu_fallback';await instance.loadModel([file],{...options,n_gpu_layers:0})}
      if(!instance.getChatTemplate())throw Error('The model has no embedded chat template.');
      const metadata=instance.getModelMetadata();const verification=inspectQwenMetadata(metadata);this.backend=backend;
      this.logger.info('[EcoMAB AI] Model loaded. Backend:',backend);return {metadata,verification,backend};
    }catch(e){this.logger.error('[EcoMAB AI] Model load failed. Error type:',e?.name||'Error');await instance.exit().catch(()=>{});this.runtime=null;this.backend='unloaded';throw e}
  }
  async generate(messages,onText,{onStatus=()=>{}}={}){
    if(!this.runtime||this.busy)throw Error('Model is not ready.');
    this.busy=true;this.abort=new AbortController();const filter=new VisibleText();const started=Date.now();let chunks=0;
    this.logger.info('[EcoMAB AI] Generation started. Backend:',this.backend,'Max output tokens:',96);
    const timer=setInterval(()=>{const elapsed=Math.round((Date.now()-started)/1000);this.logger.info('[EcoMAB AI] Generation pending:',elapsed+'s,',chunks,'stream chunks received.');onStatus({elapsed,chunks})},10000);
    const signal=this.abort.signal;let onAbort;const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('Generation stopped','AbortError'));signal.addEventListener('abort',onAbort,{once:true})});
    try{
      const stream=await Promise.race([this.runtime.createChatCompletion({messages,stream:true,abortSignal:signal,max_tokens:96,temperature:0.6,chat_template_kwargs:{enable_thinking:false}}),cancelled]);
      const iterator=stream[Symbol.asyncIterator]();while(true){const next=await Promise.race([iterator.next(),cancelled]);if(next.done)break;const chunk=next.value;chunks++;if(chunks===1)this.logger.info('[EcoMAB AI] First stream chunk after',Math.round((Date.now()-started)/1000),'seconds.');const text=chunk.choices?.[0]?.delta?.content;if(typeof text==='string')onText(filter.push(text));}
      const answer=filter.push('',true);onText(answer);this.logger.info('[EcoMAB AI] Generation completed:',Math.round((Date.now()-started)/1000)+'s,',chunks,'stream chunks.');return answer;
    }catch(e){if(e?.name==='AbortError')this.logger.info('[EcoMAB AI] Generation cancelled.');else this.logger.error('[EcoMAB AI] Generation failed. Error type:',e?.name||'Error');throw e}
    finally{signal.removeEventListener('abort',onAbort);clearInterval(timer);this.busy=false;this.abort=null}
  }
  stop(){if(this.abort){this.logger.info('[EcoMAB AI] Stop requested; unloading the model to interrupt the worker.');this.abort.abort();const instance=this.runtime;this.runtime=null;this.backend='unloaded';if(instance)void instance.exit().catch(()=>this.logger.warn('[EcoMAB AI] Worker shutdown failed.'))}}
  async unload(){this.stop();if(this.runtime){await this.runtime.exit();this.runtime=null;this.backend='unloaded'}}
}
