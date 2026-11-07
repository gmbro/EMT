import { createSpeechHealth, createSilenceGate } from './speech-health.mjs';
import { recordAudioUsage } from './request-metrics.mjs';
import { createStreamingTranscript } from './streaming-transcript.mjs';
import { createPCMFramer, pcm16Base64 } from './live-captions.mjs';
const WS_ENDPOINT='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function createGoogleLive({onUpdate,onFinal,onError,sample=false,signal,fetchImpl=fetch,Socket=WebSocket,language='auto',vocabulary=[],rotateAfterMs=480000,onStatus=()=>{},now=()=>performance.now(),scheduleWatch=setInterval,cancelWatch=clearInterval}) {
  const channels=[], setupCancels=new Set(),preRoll=[];
  const health=createSpeechHealth({now}), metricId=crypto.randomUUID();
  let capturedSamples=0,sentSamples=0,reconnections=0,usageReports=0;
  const report=()=>recordAudioUsage(metricId,{capturedSeconds:capturedSamples/16000,sentSeconds:sentSamples/16000,reconnections,usageReports});
  let watchdog,stopTask,closed=false,finishing=false,failureSent=false,lastText=performance.now(),lastVoice=0,firstFrame=0;
  const fail=message=>{if(closed||finishing||failureSent)return;failureSent=true;for(const c of channels)c.assembler.flush();report();onError(new Error(message));};
  const abort=()=>{report();closed=true;cancelWatch(watchdog);for(const cancel of setupCancels)cancel();setupCancels.clear();for(const c of channels){clearTimeout(c.renewTimer);c.assembler.dispose();c.buffer.length=0;c.socket?.close();}};
  const timed=record=>({...record,liveFirstSourceStreamMs:Math.round(record.startedAt-firstFrame),liveFirstTranslationStreamMs:record.liveFirstTranslationMs===undefined?undefined:Math.round(record.startedAt-firstFrame+record.liveFirstTranslationMs),liveLastVoiceStreamMs:lastVoice?Math.round(lastVoice-firstFrame):undefined});
  async function connect(channel) {
    const requestController=new AbortController(), cancelFetch=()=>requestController.abort();
    signal?.addEventListener('abort',cancelFetch,{once:true});
    const deadline=setTimeout(cancelFetch,12000);let response,credential;
    try { response=await fetchImpl('/api/live-token',{method:'POST',credentials:'omit',signal:requestController.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({target:channel.target,language,vocabulary,...(channel.resumeHandle?{resumeHandle:channel.resumeHandle}:{})})});credential=await response.json().catch(()=>({})); }
    catch { throw new Error(signal?.aborted?'음성 연결이 취소됐어요.':'음성 인증 연결 시간이 초과됐어요. 다시 시작해 주세요.'); }
    finally { clearTimeout(deadline);signal?.removeEventListener('abort',cancelFetch); }
    if(!response.ok)throw new Error(credential.error||'Google 음성 연결을 시작하지 못했어요.');
    if(closed)throw new Error('음성 연결이 취소됐어요.');
    const socket=new Socket(`${WS_ENDPOINT}?access_token=${encodeURIComponent(credential.token)}`);
    channel.socket=socket; channel.connectedAt=performance.now();
    await new Promise((resolve,reject)=>{
      let ready=false;
      const cancelSetup=()=>{clearTimeout(timer);setupCancels.delete(cancelSetup);reject(new Error('음성 연결이 취소됐어요.'));};
      const timer=setTimeout(()=>{setupCancels.delete(cancelSetup);reject(new Error('실시간 음성 연결 시간이 초과됐어요. 다시 시작해 주세요.'));},12000);
      setupCancels.add(cancelSetup);
      const setupFailure=(recoverable=false)=>{clearTimeout(timer);setupCancels.delete(cancelSetup);if(!ready)reject(new Error('Google 실시간 음성 연결을 열지 못했어요.'));else if(!channel.reconnecting){if(recoverable)void renew(channel,!channel.canResume);else fail('음성 연결이 끊겼어요. 시작을 눌러 다시 연결해 주세요.');}};
      socket.onopen=()=>socket.send(JSON.stringify({setup:credential.setup}));
      let messageQueue=Promise.resolve();
      socket.onmessage=event=>messageQueue=messageQueue.then(async()=>{
        if(channel.socket!==socket||closed)return;
        try{
          const message=JSON.parse(typeof event.data==='string'?event.data:await event.data.text());
          if(message.setupComplete){clearTimeout(timer);setupCancels.delete(cancelSetup);ready=true;resolve();}
          if(message.error){setupFailure();return;}
          if(message.sessionResumptionUpdate){const u=message.sessionResumptionUpdate;channel.canResume=Boolean(u.resumable&&u.newHandle);if(channel.canResume)channel.resumeHandle=u.newHandle;if(channel.renewRequested&&channel.canResume)void renew(channel);}
          if(message.usageMetadata){usageReports++;report();}
          if(message.serverContent){const c=message.serverContent;if(c.inputTranscription?.text||c.interimInputTranscription?.text||c.outputTranscription?.text){lastText=performance.now();health.response();}channel.assembler.receive(c);if(c.turnComplete){channel.assembler.flush();health.response();}}
          if(message.goAway){channel.renewRequested=true;const ms=Math.max(1000,(parseFloat(message.goAway.timeLeft)||20)*1000-2000);clearTimeout(channel.renewTimer);channel.renewTimer=setTimeout(()=>void renew(channel,!channel.canResume),ms);if(channel.canResume)void renew(channel);else if(channel.assembler.idle)void renew(channel,true);}
        }catch{setupFailure();}
      });
      socket.onerror=()=>setupFailure(true);
      socket.onclose=()=>{if(!ready)cancelSetup();else if(channel.socket===socket&&!closed&&!finishing&&!channel.reconnecting){if(channel.canResume)void renew(channel);else setupFailure(true);}};
    });
  }
  async function renew(channel,fresh=false) {
    if(closed||finishing||channel.reconnecting||!fresh&&!channel.canResume)return;
    channel.reconnects=channel.reconnects.filter(at=>performance.now()-at<60000);
    if(channel.reconnects.length>=2){fail('음성 연결이 반복해서 끊겨 전송을 멈췄어요. 네트워크를 확인해 주세요.');return;}
    channel.reconnects.push(performance.now());reconnections++;channel.reconnecting=true;onStatus('음성 연결을 복구하고 있어요.');channel.renewRequested=false;clearTimeout(channel.renewTimer);channel.socket.close();if(fresh){channel.assembler.flush();channel.resumeHandle=undefined;channel.buffer.push(...preRoll);}
    try {await connect(channel);if(closed)return;for(const message of channel.buffer){channel.socket.send(message);const data=JSON.parse(message).realtimeInput?.audio?.data;if(data)sentSamples+=atob(data).length/2;}channel.buffer.length=0;channel.reconnecting=false;health.response();onStatus(fresh?'음성 연결을 복구했어요. 끊긴 구간의 원문을 확인해 주세요.':'');}
    catch{channel.buffer.length=0;channel.reconnecting=false;fail('음성 연결을 갱신하지 못했어요. 표시된 원문은 남아 있으니 다시 시작해 주세요.');}
  }
  if(signal?.aborted)throw new Error('음성 연결이 취소됐어요.');
  signal?.addEventListener('abort',abort,{once:true});
  try {
    for(const target of ['ko']){
      const channel={target,buffer:[],reconnects:[],reconnecting:false,canResume:false};
      channel.assembler=createStreamingTranscript({sample,language,onUpdate:r=>onUpdate(timed(r)),onFinal:r=>onFinal(timed(r))});
      channels.push(channel);
    }
    await Promise.all(channels.map(connect));
    if(closed)throw new Error('음성 연결이 취소됐어요.');
  }catch(error){abort();signal?.removeEventListener('abort',abort);throw error;}
  const send=pcm=>{
    if(closed)return;
    if(!firstFrame){firstFrame=performance.now();lastText=firstFrame;}
    
    const message=JSON.stringify({realtimeInput:{audio:{data:pcm16Base64(pcm),mimeType:'audio/pcm;rate=16000'}}});
    preRoll.push(message);if(preRoll.length>20)preRoll.shift();
    for(const c of channels){
      if(c.reconnecting){if(c.buffer.length>=240){fail('음성 연결 갱신이 늦어져 전송을 멈췄어요. 다시 시작해 주세요.');return;}c.buffer.push(message);continue;}
      if(c.socket.readyState!==1){fail('음성 연결이 끊겼어요. 다시 시작해 주세요.');return;}
      if(c.socket.bufferedAmount>512000){fail('네트워크가 느려 음성 전송을 멈췄어요. 다시 시작해 주세요.');return;}
      c.socket.send(message);sentSamples+=pcm.length;
    }
  };
  const endAudio=()=>{for(const c of channels){const message=JSON.stringify({realtimeInput:{audioStreamEnd:true}});if(c.reconnecting)c.buffer.push(message);else if(c.socket.readyState===1)c.socket.send(message);}};
  const gate=createSilenceGate({send,end:endAudio});
  // 50 ms packets reduce capture buffering; keep the same 1 s replay and
  // 12 s reconnect capacities above. PCM duration (and audio billing) is unchanged.
  const framer=createPCMFramer(pcm=>{capturedSamples+=pcm.length;const {voiced}=gate.push(pcm);if(voiced){lastVoice=performance.now();health.voice();}},800);
  watchdog=scheduleWatch(()=>{
    report();if(finishing||closed)return;
    for(const channel of channels)if(performance.now()-channel.connectedAt>rotateAfterMs && channel.assembler.idle && performance.now()-lastVoice>1500)void renew(channel,true);
    const action=health.check();
    if(action==='finalize')endAudio();
    if(action==='recover')for(const channel of channels)void renew(channel,!channel.canResume);
  },1000);
  return {push:samples=>framer.push(samples),async stop({flush=true}={}){
    if(stopTask)return stopTask;if(closed)return;
    stopTask=(async()=>{finishing=true;cancelWatch(watchdog);framer.flush();
      if(flush){endAudio();await pause(700);for(let n=0;n<18&&channels.some(c=>!c.assembler.idle)&&!closed;n++)await pause(100);for(const c of channels)c.assembler.flush();}
      abort();signal?.removeEventListener('abort',abort);
    })();return stopTask;
  }};
}
