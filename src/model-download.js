// Unsloth Qwen3-0.6B Q5_K_M, pinned to an immutable repository revision.
export const MODEL_URL='https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/541d985dbfcdc61a64f8b441419e7c0e126bb6e2/Qwen3-0.6B-Q5_K_M.gguf';
export const MODEL_SHA256='d724c7e98bf2b04dbd76e79311e1070dbb55cf62b2e4d21abd2f85fed0f50c7e';
export const MODEL_NAME='Qwen3-0.6B-Q5_K_M.gguf';
export const AI_DISK_LIMIT=1024**3;
const MAX_MODEL_BYTES=600*1024**2;
export async function verifyModel(file, expected=MODEL_SHA256, cryptoProvider=globalThis.crypto){
  if(file.size<1024*1024||file.size>MAX_MODEL_BYTES)throw Error('Downloaded model has an unexpected size.');
  const digest=await cryptoProvider.subtle.digest('SHA-256',await file.arrayBuffer());
  const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==expected)throw Error('Model integrity check failed.');
  return file;
}
export class ModelInstaller {
  constructor({storage=globalThis.navigator?.storage,fetcher=(...args)=>globalThis.fetch(...args),cryptoProvider=globalThis.crypto}={}){this.storage=storage;this.fetcher=fetcher;this.crypto=cryptoProvider}
  async directory(){if(!this.storage?.getDirectory||!this.crypto?.subtle)throw Error('This browser does not support private model storage or integrity checks.');return (await this.storage.getDirectory()).getDirectoryHandle('ecomab-ai',{create:true})}
  async existing(){const dir=await this.directory();try{const handle=await dir.getFileHandle(MODEL_NAME);return await verifyModel(await handle.getFile(),MODEL_SHA256,this.crypto)}catch(e){if(e.name==='NotFoundError')return null;await dir.removeEntry(MODEL_NAME).catch(()=>{});return null}}
  async remove(){const dir=await this.directory();try{await dir.removeEntry(MODEL_NAME)}catch(e){if(e.name!=='NotFoundError')throw e}}
  async install({signal,onProgress=()=>{}}={}){
    const dir=await this.directory();let used=0;for await(const [name,handle] of dir.entries()){if(handle.kind==='file'&&name!==MODEL_NAME)used+=(await handle.getFile()).size}
    if(used+MAX_MODEL_BYTES>AI_DISK_LIMIT)throw Error('Not enough space within the 1 GiB AI storage limit.');
    const estimate=await this.storage.estimate();if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)&&estimate.quota-estimate.usage<MAX_MODEL_BYTES+64*1024**2)throw Error('Not enough available browser storage for the model.');
    const response=await this.fetcher(MODEL_URL,{signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok||!response.body)throw Error(`Model download failed (HTTP ${response.status}).`);
    const total=Number(response.headers.get('content-length'))||0;if(total>MAX_MODEL_BYTES||used+total>AI_DISK_LIMIT)throw Error('Model exceeds the storage limit.');
    const handle=await dir.getFileHandle(MODEL_NAME,{create:true});let writer,complete=false;
    try{writer=await handle.createWritable();const reader=response.body.getReader();let size=0;try{while(true){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_MODEL_BYTES||used+size>AI_DISK_LIMIT)throw Error('Model exceeds the storage limit.');await writer.write(value);onProgress(size,total)}}finally{reader.releaseLock()}await writer.close();writer=null;if(signal?.aborted)throw new DOMException('Cancelled','AbortError');onProgress(size,total,'verify');const file=await verifyModel(await handle.getFile(),MODEL_SHA256,this.crypto);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');complete=true;return file}finally{if(writer)await writer.abort().catch(()=>{});if(!complete)await dir.removeEntry(MODEL_NAME).catch(()=>{})}
  }
}
