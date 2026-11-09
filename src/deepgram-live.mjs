import {detectCaptionLanguage} from './meeting-archive.mjs';
import {createPCMFramer} from './live-captions.mjs';
import {createSpeechHealth} from './speech-health.mjs';

export function speakerSegments(alternative,language) {
  const groups=[];
  const words = alternative.words?.length ? alternative.words : (alternative.transcript || '').trim().split(/\s+/).map(word => ({word}));
  const utteranceLanguage = alternative.languages?.length === 1 ? alternative.languages[0] : '';
  for(const word of words) {
    const text=(word.punctuated_word||word.word||'').trim();
    if(!text)continue;
    const code=(word.language || utteranceLanguage).toLowerCase().split('-')[0];
    if (code && code !== 'ko' && code !== 'en') continue;
    // Streaming hypotheses can omit language tags or temporarily mislabel a word.
    if (/[^\p{Script=Latin}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]/u.test(text)) continue;
    const lang=code==='ko'?'ko-KR':code==='en'?'en-US':detectCaptionLanguage(text,language);
    const speaker=Number.isInteger(word.speaker)?word.speaker:null;
    let group=groups.at(-1);
    if(!group||group.speaker!==speaker||group.language!==lang) {
      group={speaker,language:lang,original:''};
      groups.push(group);
    }
    group.original+=(group.original?' ':'')+text;
  }
  return groups;
}

export async function createDeepgramLive({onUpdate,onFinal,onDiscard,onError,onStatus,signal,language='auto',allocateSpeaker,Socket=WebSocket}) {
  const health=createSpeechHealth();
  let socket,provisional,closed=false,stopping=false,ready=false,retries=[],labels=new Map();
  let backlog=[],seen=new Set(),finish,watchdog,recovery,timedOut=false;
  function publish(group,pending) {
    provisional ||= {id:crypto.randomUUID(),createdAt:Date.now(),startedAt:performance.now(),input:'voice',live:true,speechModel:'nova-3'};
    let speakerId='';
    if(group.speaker!==null){
      if(!labels.has(group.speaker))labels.set(group.speaker,allocateSpeaker());
      speakerId=labels.get(group.speaker);
    }
    provisional={...provisional,original:group.original,language:group.language,speakerId,sourcePending:pending};
    onUpdate({...provisional});
    if(!pending){onFinal({...provisional});provisional=null;}
  }
  function preservePartial(){
    if(provisional){onFinal({...provisional,incomplete:true,sourcePending:true});provisional=null;}
  }
  function receive(event) {
    if(closed)return;
    let result;
    try {result=JSON.parse(event.data);}catch{return;}
    if(result.type!=='Results')return;
    const alt=result.channel?.alternatives?.[0];
    if(!alt)return;
    if (alt.transcript?.trim()) {
      health.response();
      if(timedOut){timedOut=false;onStatus('');}
    }
    const groups=speakerSegments(alt,language);
    if(result.is_final){
      const key=result.start+':'+result.duration;
      if(seen.has(key))return;
      seen.add(key);
    }
    if (!groups.length) {
      if (provisional) onDiscard?.(provisional.id);
      provisional=null;
      return;
    }
    if (result.is_final) {
      for(const group of groups)publish(group,false);
    }else{
      publish(groups[0],true);
    }
  }
  function dispose(){
    closed=true;ready=false;clearInterval(watchdog);clearTimeout(recovery);
    signal?.removeEventListener('abort',abort);
    socket?.close();backlog=[];finish?.();
  }
  function abort(){dispose();}
  function fail(message){if(closed)return;preservePartial();dispose();onError(new Error(message));}
  function reconnect(){
    if(closed||stopping)return;
    ready=false;preservePartial();labels=new Map();seen=new Set();
    retries=retries.filter(at=>Date.now()-at<60000);
    if(retries.length>=2){fail('음성 연결이 반복해서 중단되었습니다. 다시 연결해 주세요.');return;}
    retries.push(Date.now());onStatus('음성 연결 복구 중 · 끊긴 구간은 누락될 수 있습니다.');
    recovery=setTimeout(()=>connect().catch(()=>reconnect()),500*retries.length);
  }
  async function connect(){
    const response=await fetch('/api/live-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'deepgram'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
    const data=await response.json();
    if(!response.ok||!data.token)throw new Error(data.error||'Deepgram 음성 인증에 실패했습니다.');
    if(closed||stopping)throw new Error('음성 연결이 취소되었습니다.');
    const params=new URLSearchParams({model:'nova-3',language:language==='auto'?'multi':language.split('-')[0],diarize_model:'latest',interim_results:'true',punctuate:'true',encoding:'linear16',sample_rate:'16000',channels:'1'});
    if (language === 'auto') {
      params.append('language_hint','en');
      params.append('language_hint','ko');
    }
    const ws=new Socket('wss://api.deepgram.com/v1/listen?'+params,['bearer',data.token]);
    socket=ws;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>ws.close(),10000);
      ws.onmessage=receive;
      ws.onopen=()=>{
        clearTimeout(timer);ready=true;health.response();
        for(const frame of backlog)ws.send(frame);backlog=[];
        onStatus('');resolve();
      };
      ws.onclose=()=>{
        clearTimeout(timer);
        if(!ready)reject(new Error('Deepgram 음성 연결을 열 수 없습니다.'));
        if(stopping)finish?.();
        else if(ready&&!closed)reconnect();
      };
    });
  }
  const framer=createPCMFramer(samples=>{
    const pcm=Int16Array.from(samples,s=>Math.round(Math.max(-1,Math.min(1,s))*32767));
    if(samples.some(s=>Math.abs(s)>0.012))health.voice();
    if(ready&&socket.readyState===1){
      if(socket.bufferedAmount>640000){fail('오디오 전송이 지연되었습니다. 네트워크를 확인해 주세요.');return;}
      socket.send(pcm);
    }else if(backlog.length<120)backlog.push(pcm);
    else fail('복구 대기 시간이 초과되었습니다. 다시 연결해 주세요.');
  });
  signal?.addEventListener('abort',abort,{once:true});
  try{await connect();}catch(error){dispose();throw error;}
  watchdog=setInterval(()=>{
    if(!ready||stopping)return;
    const action=health.check();
    if(action==='finalize'){timedOut=true;onStatus('음성 입력이 있지만 받아쓰기가 지연됩니다.');socket.send(JSON.stringify({type:'Finalize'}));}
    if(action==='recover')socket.close();
  },1000);
  return {push(samples){if(!closed&&!stopping)framer.push(samples);},async stop({flush=true}={}){
    if(closed)return;
    stopping=true;
    try{if(flush&&ready&&socket.readyState===1){
      framer.flush();
      await new Promise(resolve=>{const t=setTimeout(resolve,3000);finish=()=>{clearTimeout(t);resolve();};socket.send(JSON.stringify({type:'CloseStream'}));});
    }
    if(flush)preservePartial();}finally{dispose();}
  }};
}
