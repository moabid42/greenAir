import {test,expect} from '@playwright/test';
// Stubbed runtime exercises UI only; it is not model inference evidence.
test('local chat picker, streaming and conversation reset with stub runtime',async({page})=>{
  await page.route('**/wllama/index.js',route=>route.fulfill({contentType:'text/javascript',body:`export class Wllama {async loadModel(){} getChatTemplate(){return 'template'} getModelMetadata(){return {meta:{}}} async *createChatCompletion(){yield {choices:[{delta:{content:'A local'}}]};yield {choices:[{delta:{content:' test reply'}}]}} async exit(){}}`}));
  await page.addInitScript(() => { const hex='d724c7e98bf2b04dbd76e79311e1070dbb55cf62b2e4d21abd2f85fed0f50c7e'; Object.defineProperty(crypto.subtle,'digest',{value:async()=>Uint8Array.from(hex.match(/../g),x=>parseInt(x,16)).buffer}); });
  const bytes=Buffer.alloc(1024*1024);bytes.write('GGUF');
  await page.route('**/Qwen3-0.6B-Q5_K_M.gguf',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/octet-stream'},body:bytes}));
  await page.goto('/');await page.getByRole('button',{name:'AI Companion',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'Model & privacy'})).toBeVisible();
  await page.getByRole('button',{name:'Download & install model'}).click();
  await expect(page.getByText('Model ready; identity metadata incomplete.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Close settings'}).click();
  await page.locator('#chat-input').fill('Hello');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.ai-bubble.assistant')).toHaveText('A local test reply');
  await page.getByRole('button',{name:'Model settings'}).click();await page.getByRole('button',{name:'New chat'}).click();
  await expect(page.locator('.ai-bubble')).toHaveCount(0);
});
