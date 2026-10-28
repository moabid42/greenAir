// Local development-only proxy. Never expose the provider key to the browser.
export function cloudProxy({getKey,fetcher=(...args)=>globalThis.fetch(...args)}={}){
  return async (req,res,next)=>{
    if(new URL(req.url,'http://localhost').pathname!=='/api/ai/chat')return next();
    const send=(code,body)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))};
    const remote=req.socket.remoteAddress;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return send(403,{error:'Cloud AI is available only on the local development server.'});
    let origin;try{origin=new URL(req.headers.origin)}catch{return send(403,{error:'Invalid request origin.'})}
    if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.host!==req.headers.host)return send(403,{error:'Invalid request origin.'});
    if(req.method!=='POST')return send(405,{error:'Method not allowed.'});
    const key=getKey();if(!key)return send(503,{error:'OPENROUTER_API_KEY is not configured on the local server.'});
    let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>24000)return send(413,{error:'Message is too large.'})}const body=JSON.parse(raw);if(!Array.isArray(body.messages)||body.messages.length!==2||body.messages[0].role!=='system'||body.messages[1].role!=='user'||body.messages.some(m=>typeof m.content!=='string'||m.content.length>10000))return send(400,{error:'Invalid chat request.'});
      const response=await fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'recursive/flint-v1.0:free',messages:body.messages,max_tokens:1024,stream:false}),signal:AbortSignal.timeout(120000)});
      if(!response.ok)return send(response.status,{error:`OpenRouter request failed (HTTP ${response.status}). Check the key, model availability and rate limits.`});
      const data=await response.json();const text=data.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim()){const reason=data.choices?.[0]?.finish_reason;const usage=data.usage?.completion_tokens_details?.reasoning_tokens;console.warn('[EcoMAB AI] OpenRouter returned no visible answer.',{finishReason:typeof reason==='string'?reason:'unknown',reasoningTokens:Number.isFinite(usage)?usage:null});return send(502,{error:`OpenRouter returned no visible answer (finish: ${typeof reason==='string'&&/^[a-z_]+$/.test(reason)?reason:'unknown'}; reasoning tokens: ${Number.isFinite(usage)?usage:'unknown'}).`})}return send(200,{text});
    }catch(e){if(!res.headersSent)return send(502,{error:e.name==='TimeoutError'?'OpenRouter request timed out.':'Cloud request failed. Check the local server and network connection.'})}
  };
}
