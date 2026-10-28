import {cp,readFile,access} from 'node:fs/promises';
const root='node_modules/@wllama/wllama';
try {
  const pkg=JSON.parse(await readFile(root+'/package.json','utf8'));
  if(pkg.version!=='3.8.1')throw Error(`Expected version 3.8.1, found ${pkg.version}`);
  await access(root+'/esm/index.js');await access(root+'/esm/wasm/wllama.wasm');
  await cp(root+'/esm','public/wllama',{recursive:true});
  console.log('Copied local Wllama 3.8.1 assets to public/wllama');
} catch(e) { console.error('Install @wllama/wllama@3.8.1 first:',e.message);process.exitCode=1; }
