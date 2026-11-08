import test from 'node:test';
import assert from 'node:assert/strict';
import {speakerSegments,createDeepgramLive} from '../src/deepgram-live.mjs';

test('language switch keeps the voice; same-language speaker switch starts another segment',()=>{
  const words=[['Hello','en',0],['네','ko',0],['맞습니다','ko',1],['Thanks','en',0]].map(([word,language,speaker])=>({word,language,speaker}));
  assert.deepEqual(speakerSegments({words},'auto').map(s=>[s.original,s.speaker,s.language]),[
    ['Hello',0,'en-US'],['네',0,'ko-KR'],['맞습니다',1,'ko-KR'],['Thanks',0,'en-US']]);
});

test('interim becomes the first final row, repeated finals do not duplicate speaker turns',async t=>{
  let ws;
  class Socket {
    constructor(){ws=this;this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.onopen();});}
    close(){this.readyState=3;this.onclose?.();}
    send(){}
  }
  t.mock.method(globalThis,'fetch',async()=>Response.json({token:'temporary'}));
  const rows=new Map(),finals=[];
  let speaker=0;
  const live=await createDeepgramLive({Socket,onUpdate:r=>rows.set(r.id,r),onFinal:r=>finals.push(r),onStatus:()=>{},onError:assert.fail,allocateSpeaker:()=>String.fromCharCode(65+speaker++)});
  try{
    const emit=final=>ws.onmessage({data:JSON.stringify({type:'Results',is_final:final,start:0,duration:1,channel:{alternatives:[{transcript:'Yes 네',words:[{word:'Yes',speaker:0},{word:'네',speaker:1}]}]}})});
    emit(false);emit(true);emit(true);
    assert.equal(rows.size,2);assert.deepEqual(finals.map(r=>[r.original,r.speakerId]),[['Yes','A'],['네','B']]);
  }finally{await live.stop({flush:false});}
});
