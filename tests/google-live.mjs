import {test} from 'node:test';import assert from 'node:assert/strict';import {createGoogleLive} from '../src/google-live.js';
class Socket{
 static instances=[];readyState=1;bufferedAmount=0;sent=[];
 constructor(url){this.url=url;Socket.instances.push(this);queueMicrotask(()=>this.onopen?.());}
 send(raw){const m=JSON.parse(raw);this.sent.push(m);if(m.setup)queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({setupComplete:{}})}));}
 emit(message){return this.onmessage?.({data:JSON.stringify(message)});}
 close(){this.readyState=3;this.onclose?.({code:1000});}
}
const tokenFetch=async(url,options)=>new Response(JSON.stringify({token:'short-lived-test-token',setup:{model:'models/gemini-3.5-transcribe-live',generationConfig:{translationConfig:{targetLanguageCode:JSON.parse(options.body).target}}}}));
test('first voiced packet is sent at 50 ms without waiting for 100 ms',async()=>{
 Socket.instances=[];const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:()=>{},onFinal:()=>{},onError:e=>{throw e;}});
 try{
  live.push(new Float32Array(799).fill(.1));assert.equal(Socket.instances[0].sent.filter(m=>m.realtimeInput?.audio).length,0);
  live.push(new Float32Array(1).fill(.1));const frames=Socket.instances[0].sent.filter(m=>m.realtimeInput?.audio);
  assert.equal(frames.length,1);assert.equal(atob(frames[0].realtimeInput.audio.data).length,1600);
 }finally{await live.stop({flush:false});}
});
test('live client sends 16k PCM to one constrained Korean target for both source languages and never plays generated audio',async()=>{
 Socket.instances=[];const updates=[],finals=[],errors=[];
 const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:r=>updates.push(r),onFinal:r=>finals.push(r),onError:e=>errors.push(e)});
 try{
  assert.equal(Socket.instances.length,1);for(const s of Socket.instances){assert.ok(s.url.startsWith('wss://generativelanguage.googleapis.com/'));assert.ok(!s.url.includes('?key='));}
  live.push(new Float32Array(1600).fill(.1));assert.ok(Socket.instances.every(s=>s.sent.some(m=>m.realtimeInput?.audio?.mimeType==='audio/pcm;rate=16000')));
  const ko=Socket.instances.find(s=>s.sent[0].setup.generationConfig.translationConfig.targetLanguageCode==='ko');
  await ko.emit({serverContent:{inputTranscription:{text:'Please confirm.',languageCode:'en'}}});
  await ko.emit({serverContent:{outputTranscription:{text:'확인해 주세요.',languageCode:'ko'},modelTurn:{parts:[{inlineData:{data:'ignored audio'}}]}}});
  assert.equal(finals.length,1);assert.equal(finals[0].translation,'');assert.equal(finals[0].original,'Please confirm.');assert.equal(errors.length,0);assert.ok(updates.length>0);
  await ko.emit({serverContent:{inputTranscription:{text:'아직 승인하지 않았습니다.',languageCode:'ko'},outputTranscription:{text:'ignored Korean echo'}}});
  assert.equal(finals.length,2);assert.equal(finals[1].language,'ko-KR');assert.equal(finals[1].translation,'');
 }finally{await live.stop({flush:false});}
 assert.ok(Socket.instances.every(s=>s.readyState===3));
});
test('unexpected network loss reconnects automatically and closes all sockets on stop',async()=>{
 Socket.instances=[];const errors=[];const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:()=>{},onFinal:()=>{},onError:e=>errors.push(e)});
 Socket.instances[0].readyState=3;Socket.instances[0].onclose({code:1006});Socket.instances[0].onerror();
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(errors.length,0);assert.equal(Socket.instances.length,2);await live.stop({flush:false});assert.ok(Socket.instances.every(s=>s.readyState===3));
});
test('GoAway resumes only from a resumable handle and buffers audio while the new socket connects',async()=>{
 Socket.instances=[];const requests=[],errors=[];let releaseToken;
 const fetchImpl=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(body.resumeHandle)await new Promise(resolve=>{releaseToken=resolve;});return tokenFetch(url,options);};
 const live=await createGoogleLive({fetchImpl,Socket,onUpdate:()=>{},onFinal:()=>{},onError:e=>errors.push(e)});
 try{
  const previous=Socket.instances[0];await previous.emit({sessionResumptionUpdate:{resumable:true,newHandle:'test-resume-handle'}});
  await previous.emit({serverContent:{interimInputTranscription:{text:'Please review'}}});
  await previous.emit({sessionResumptionUpdate:{resumable:false}});
  await previous.emit({goAway:{timeLeft:'20s'}});assert.equal(requests.length,1);
  await previous.emit({sessionResumptionUpdate:{resumable:true,newHandle:'test-resume-handle'}});live.push(new Float32Array(1600).fill(.1));
  assert.equal(requests.at(-1).resumeHandle,'test-resume-handle');assert.equal(Socket.instances.length,1);
  releaseToken();await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(Socket.instances.length,2);const renewed=Socket.instances[1];assert.ok(renewed.sent.some(m=>m.realtimeInput?.audio));assert.equal(errors.length,0);
 }finally{await live.stop({flush:false});}
});
test('closing during token provisioning aborts the request without leaving a socket open',async()=>{
 Socket.instances=[];const controller=new AbortController();let aborted=0;
 const fetchImpl=(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted++;reject(new Error('cancelled'));},{once:true});});
 const pending=createGoogleLive({fetchImpl,Socket,signal:controller.signal,onUpdate:()=>{},onFinal:()=>{},onError:()=>{}});
 controller.abort();await assert.rejects(pending,/취소/);assert.equal(aborted,1);assert.equal(Socket.instances.length,0);
});

test('a stalled stream is nudged then resumed without treating idle time as failure',async()=>{
 Socket.instances=[];let time=0,tick;const errors=[],statuses=[];
 const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:()=>{},onFinal:()=>{},onError:e=>errors.push(e),onStatus:s=>statuses.push(s),now:()=>time,scheduleWatch:fn=>{tick=fn;return 1;},cancelWatch:()=>{}});
 try{
  time=120000;live.push(new Float32Array(1600).fill(.1));tick();assert.equal(errors.length,0);assert.equal(Socket.instances.length,1);
  time+=12000;live.push(new Float32Array(1600).fill(.1));tick();assert.ok(!Socket.instances[0].sent.some(m=>m.realtimeInput?.audioStreamEnd));
  time+=12000;live.push(new Float32Array(1600).fill(.1));tick();await new Promise(r=>setTimeout(r,5));assert.equal(Socket.instances.length,2);assert.equal(errors.length,0);assert.ok(statuses.some(s=>s.includes('복구')));
 }finally{await live.stop({flush:false});}
});
test('turn completion commits an authoritative tail without punctuation',async()=>{
 Socket.instances=[];const finals=[];const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:()=>{},onFinal:r=>finals.push(r),onError:()=>{}});
 try{await Socket.instances[0].emit({serverContent:{inputTranscription:{text:'We have not approved'},turnComplete:true}});assert.equal(finals.length,1);assert.equal(finals[0].original,'We have not approved');assert.equal(finals[0].sourcePending,false);}finally{await live.stop({flush:false});}
});

test('GoAway during a long unfinished phrase renews without a resume handle before expiry',async()=>{
 Socket.instances=[];const errors=[],finals=[],statuses=[];
 const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:()=>{},onFinal:r=>finals.push(r),onError:e=>errors.push(e.message),onStatus:s=>statuses.push(s)});
 try{
  live.push(new Float32Array(1600).fill(.1));
  await Socket.instances[0].emit({serverContent:{inputTranscription:{text:'We have not approved the contract'}}});
  await Socket.instances[0].emit({goAway:{timeLeft:'3s'}});
  await new Promise(r=>setTimeout(r,1100));
  assert.equal(errors.length,0);assert.equal(Socket.instances.length,2);
  assert.equal(finals[0].original,'We have not approved the contract');
  assert.ok(Socket.instances[1].sent.some(m=>m.realtimeInput?.audio));
  assert.ok(statuses.some(s=>s.includes('복구')));
 }finally{await live.stop({flush:false});}
});

test('quiet pauses keep their audio frames and never terminate a live audio stream',async()=>{
 Socket.instances=[];const live=await createGoogleLive({fetchImpl:tokenFetch,Socket,onUpdate:()=>{},onFinal:()=>{},onError:assert.fail});
 try{
  live.push(new Float32Array(1600).fill(.05));live.push(new Float32Array(32000));live.push(new Float32Array(1600).fill(.05));
  const messages=Socket.instances[0].sent;
  assert.equal(messages.filter(m=>m.realtimeInput?.audio).length,44);
  assert.ok(!messages.some(m=>m.realtimeInput?.audioStreamEnd));
 }finally{await live.stop({flush:false});}
});
