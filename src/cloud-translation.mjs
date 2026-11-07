import { readSSE } from './sse.mjs';
import { recordRequest } from './request-metrics.mjs';
const failure = (message, code, extra={}) => Object.assign(new Error(message), {code,...extra});
export const retryable = error => ['NETWORK','TIMEOUT','INCOMPLETE_STREAM','PROVIDER_UNAVAILABLE','RATE_LIMITED'].includes(error.code);
export function retryDelay(value, now = Date.now()) {
  if(!value)return 0;
  const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-now)||0;
}
const wait = (ms,signal) => new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(failure('번역을 취소했어요.','CANCELLED',{name:'AbortError'}));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
});
export async function prepareCloudTranslation({ signal } = {}) {
  let response;
  try { response = await fetch('/api/translate', { credentials: 'omit', cache: 'no-store', signal }); }
  catch { throw new Error('번역 서버에 연결하지 못했어요. 네트워크 연결 후 다시 준비해 주세요.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ready) throw new Error(body.error || '번역 서버를 준비하지 못했어요. 다시 시도해 주세요.');
  return body;
}
export async function translateCloud(text, language, options = {}) {
  const { signal, retries = options.draft ? 0 : 2, onRetry, sleep = wait } = options;
  for(let attempt=0;;attempt++) {
    try { return await request(text,language,{...options,attempt}); }
    catch(error) {
      // Respect long Retry-After without holding a live translation slot for a minute.
      if((typeof navigator!=='undefined'&&navigator.onLine===false) || signal?.aborted || !retryable(error) || attempt>=Math.min(2,retries) || error.retryAfterMs>10000)throw error;
      const delay=Math.max(error.retryAfterMs||0,[1000,3000][attempt])+Math.floor(Math.random()*150);
      onRetry?.({attempt:attempt+1,delay,code:error.code});
      await sleep(delay,signal);
    }
  }
}
async function request(text, language, { onText, context = '', glossary = '', signal, draft = false, task = 'translate', replyCount=1, timeoutMs = 28000, attempt=0 } = {}) {
  const controller=new AbortController(); let timedOut=false, metadata={}, firstTokenMs=null, status='error', code;
  const started=performance.now(), abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;abort();},timeoutMs);
  try {
    const response=await fetch('/api/translate',{method:'POST',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,language,context:context.slice(-3000),glossary:glossary.slice(0,2000),draft,task,...(task==='replies'?{replyCount}:{})})});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw failure(body.error||'번역 요청을 처리하지 못했어요.',body.code || (response.status===429?'RATE_LIMITED':response.status>=500?'PROVIDER_UNAVAILABLE':'INVALID_REQUEST'),{retryAfterMs:retryDelay(response.headers.get('Retry-After')),status:response.status});}
    let output='',done=false;
    for await(const event of readSSE(response.body)) {
      if(event.type==='delta'){firstTokenMs ??= Math.round(performance.now()-started);output+=event.text;onText?.(output,{attempt});}
      if(event.type==='error')throw failure(event.message,event.code||'PROVIDER_UNAVAILABLE',{retryAfterMs:event.retryAfterMs||0});
      if(event.type==='done'){
        if(typeof event.text==='string'){output=event.text;onText?.(output,{attempt});}
        metadata=event;done=true;break; // Terminal event is sufficient; do not await a hanging connection EOF.
      }
    }
    if(!done||!output.trim())throw failure('번역 응답이 끝까지 도착하지 않았어요. 표시된 내용은 유지됩니다.','INCOMPLETE_STREAM');
    status='complete';return {...metadata,text:output.trim(),milliseconds:Math.round(performance.now()-started)};
  }catch(error){
    const mapped=controller.signal.aborted ? failure(timedOut?'번역 응답 시간이 초과됐어요.':'번역을 취소했어요.',timedOut?'TIMEOUT':'CANCELLED',{name:timedOut?'TimeoutError':'AbortError'})
      :error instanceof TypeError ? failure('번역 네트워크 연결이 끊겼어요. 원문은 유지됩니다.','NETWORK') :error;
    code=mapped.code||'INVALID_RESPONSE';throw mapped;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);
    recordRequest({task:draft?'preview':task,status,code,attempt,milliseconds:Math.round(performance.now()-started),firstTokenMs,usage:metadata.usage});
  }
}
