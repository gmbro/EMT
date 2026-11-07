import {readSSE} from './sse.mjs';
import {detectCaptionLanguage} from './meeting-archive.mjs';
export const LOCAL_QWEN = typeof __LOCAL_QWEN__!=='undefined' && __LOCAL_QWEN__;
export async function createQwenLive({onUpdate,onFinal,onError,signal,language='auto',fetchImpl=fetch}){
 const health=await fetchImpl('/api/qwen',{signal});const state=await health.json();
 if(!health.ok||!state.ready)throw new Error(state.error||'Qwen 모델을 준비하지 못했어요.');
 let frames=[],length=0,quiet=0,voiced=false,record=null,busy=false,closed=false,stopping=false,pending=[],previewAt=0;
 const controller=new AbortController();
 const displayed=new Map();
 const cancel=()=>{closed=true;frames=[];pending=[];displayed.clear();controller.abort();signal?.removeEventListener('abort',cancel);};signal?.addEventListener('abort',cancel,{once:true});
 const failure=error=>{if(closed)return;cancel();onError(error);};
 const copy=()=>{const pcm=new Int16Array(length);let at=0;for(const frame of frames){for(let n=0;n<frame.length;n++)pcm[at++]=Math.round(Math.max(-1,Math.min(1,frame[n]))*32767);}return pcm;};
 const encode=pcm=>{const bytes=new Uint8Array(pcm.length*2),view=new DataView(bytes.buffer);for(let i=0;i<pcm.length;i++)view.setInt16(i*2,pcm[i],true);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
 async function drain(){
  if(busy||closed||!pending.length)return;busy=true;const task=pending.shift();
  try{
   const response=await fetchImpl('/api/qwen',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({pcm:encode(task.pcm),language})});
   if(!response.ok){const error=await response.json();throw new Error(error.error||'Qwen 연결 오류');}
   let text='',done=false;
   const emit=()=>{
    const value=text.trim(),previous=displayed.get(task.record.id);
    if(closed||!value||previous?.startsWith(value))return;
    // A repeated decode starts from token one. Keep the displayed hypothesis
    // until it catches up or actually revises words, avoiding flicker and
    // cancellation of a useful translation merely because a prefix replays.
    displayed.set(task.record.id,value);
    onUpdate({...task.record,original:value,language:language==='auto'?detectCaptionLanguage(text):language,sourcePending:true});
   };
   for await(const event of readSSE(response.body)){
    if(event.type==='error')throw new Error(event.message);
    if(event.type==='delta'){text+=event.text;emit();}
    if(event.type==='done'){text=event.text??text;done=true;break;}
   }
   if(!done)throw new Error('Qwen 응답이 끝까지 도착하지 않았어요.');
   if(!closed&&text.trim()){
    const result={...task.record,original:text.trim(),language:language==='auto'?detectCaptionLanguage(text):language,sourcePending:!task.final};
    if(task.final){onUpdate(result);onFinal(result);displayed.delete(task.record.id);}else emit();
   }
  }catch(error){if(!closed)failure(error);}finally{busy=false;void drain();}
 }
 const enqueue=final=>{
  if(!record||length<320)return;
  // Replace superseded drafts, but never discard a final segment.
  pending=pending.filter(t=>t.final||t.record.id!==record.id);
  pending.push({pcm:copy(),record:{...record},final});
  if(pending.length>6){failure(new Error('Qwen 처리 속도가 음성을 따라가지 못해 중단했어요.'));return;}
  void drain();
 };
 const finish=()=>{if(voiced)enqueue(true);frames=[];length=0;quiet=0;voiced=false;record=null;previewAt=0;};
 return {push(samples){
  if(closed||stopping)return;
  // Bound chunks even if the caller sends a large audio buffer.
  for(let start=0;start<samples.length;start+=1600){const part=samples.slice(start,start+1600);const rms=Math.sqrt(part.reduce((sum,n)=>sum+n*n,0)/part.length);const voice=rms>=.003;
   if(!voiced&&!voice){frames.push(part);length+=part.length;while(length>6400){length-=frames.shift().length;}continue;}
   if(!voiced){voiced=true;record={id:crypto.randomUUID(),createdAt:Date.now(),startedAt:performance.now(),translation:'',input:'voice',live:true,speechModel:'Qwen3-ASR-1.7B'};}
   frames.push(part);length+=part.length;quiet=voice?0:quiet+part.length;
   if(quiet>=11200||length>=128000){finish();continue;}
   // Two early snapshots, then the normal 1.5 s cadence. Coalescing above
   // bounds work if inference cannot keep up; final audio is always retained.
   if(previewAt===0?length>=12800:length-previewAt>=(previewAt<25600?12800:24000)){enqueue(false);previewAt=length;}
  }
 },async stop({flush=true}={}){
  if(closed)return;stopping=true;if(flush)finish();else{cancel();return;}
  const until=Date.now()+45000;
  while(!closed&&(busy||pending.length)&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
  if(!closed&&(busy||pending.length))failure(new Error('Qwen 마무리 처리가 지연됐어요.'));
  cancel();signal?.removeEventListener('abort',cancel);
 }};
}
