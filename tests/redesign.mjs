import test from 'node:test';
import assert from 'node:assert/strict';
import {translateCloud,retryDelay} from '../src/cloud-translation.mjs';
import {meetingContext,isGuideMoment} from '../src/meeting-context.mjs';
import {MeetingEngine} from '../src/meeting-engine.js';
import {createStreamingTranscript} from '../src/streaming-transcript.mjs';
import {readSSE} from '../src/sse.mjs';
const response=events=>new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
async function mockFetch(fn,run){const old=globalThis.fetch;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=old;}}
test('transcription-only preparation does not call Gemini or require its key',async()=>{
 await mockFetch(async()=>{throw Error('must not call a remote API');},async()=>{
  const engine=new MeetingEngine();
  const result=await engine.prepare('auto',{translationEnabled:false});
  assert.equal(result.translation,'받아쓰기 전용');assert.equal(engine.translationKinds.size,0);
  engine.destroy();
 });
});

test('terminal done succeeds immediately even if the transport never closes',async()=>{
  let cancelled=false;
  await mockFetch(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"완료"}\n\ndata: {"type":"done"}\n\n'));},cancel(){cancelled=true;}})),async()=>{
    const r=await translateCloud('Done.','en-US',{timeoutMs:100,retries:0});assert.equal(r.text,'완료');assert.equal(cancelled,true);
  });
});
test('truncated stream retries at most twice and does not silently accept partial output',async()=>{
  let calls=0;const attempts=[];
  await mockFetch(async()=>{calls++;return response([{type:'delta',text:'부분'}]);},async()=>{
    await assert.rejects(translateCloud('Unfinished.','en-US',{sleep:async()=>{},onRetry:r=>attempts.push(r.attempt)}),e=>e.code==='INCOMPLETE_STREAM');
    assert.equal(calls,3);assert.deepEqual(attempts,[1,2]);
  });
});
test('network failure recovers while permanent billing/auth errors never retry',async()=>{
  let calls=0;
  await mockFetch(async()=>{if(++calls===1)throw new TypeError('network');return response([{type:'delta',text:'복구'},{type:'done'}]);},async()=>assert.equal((await translateCloud('Retry.','en-US',{sleep:async()=>{}})).text,'복구'));
  assert.equal(calls,2);
  for(const [status,code] of [[402,'CREDITS_EXHAUSTED'],[403,'PROVIDER_REJECTED']]){
    calls=0;await mockFetch(async()=>{calls++;return new Response(JSON.stringify({error:'blocked',code}),{status});},async()=>await assert.rejects(translateCloud('No.','en-US',{sleep:async()=>{}}),e=>e.code===code));assert.equal(calls,1);
  }
});
test('Retry-After is respected; long limits release a live request instead of spinning',async()=>{
  assert.equal(retryDelay('60'),60000);assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:10 GMT',0),10000);
  let calls=0;await mockFetch(async()=>{calls++;return new Response('{"code":"RATE_LIMITED"}',{status:429,headers:{'Retry-After':'60'}});},async()=>await assert.rejects(translateCloud('No.','en-US',{sleep:()=>{throw Error('must not wait');}}),e=>e.retryAfterMs===60000));assert.equal(calls,1);
});
test('user cancellation is distinct from timeout and never retried',async()=>{
  await mockFetch(async(_url,options)=>new Promise((_resolve,reject)=>{const abort=()=>reject(new DOMException('abort','AbortError'));if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort);}),async()=>{
    await assert.rejects(translateCloud('Test','en-US',{timeoutMs:5,retries:0}),e=>e.code==='TIMEOUT');
    const c=new AbortController();c.abort();await assert.rejects(translateCloud('Test','en-US',{signal:c.signal}),e=>e.code==='CANCELLED');
  });
});
test('completed preview is reused only with identical context and glossary and is cleared between meetings',async()=>{
  let calls=0;
  await mockFetch(async()=>{calls++;return response([{type:'delta',text:'번역'},{type:'done'}]);},async()=>{
    const engine=new MeetingEngine();engine.translationKinds.set('en-US','test');
    const options={context:'Contract.',glossary:'deposit = 계약금'};
    await engine.translateDraft('No agreement.','en-US',options);await engine.translate('No agreement.','en-US',options);assert.equal(calls,1);
    await engine.translate('No agreement.','en-US',{...options,context:'Rental.'});assert.equal(calls,2);
    await engine.translate('No agreement.','en-US',{...options,glossary:'deposit = 보증금'});assert.equal(calls,3);
    engine.clearCloudCache();await engine.translate('No agreement.','en-US',options);assert.equal(calls,4);engine.destroy();
  });
});
test('context keeps relevant source facts and complete qualifiers without repeating translations or draft speech',()=>{
  const rows=Array.from({length:10},(_,i)=>({createdAt:i+1,original:`Meeting item ${i}.`,translation:'DO NOT SEND TRANSLATION',status:'complete'}));
  rows[0].original='Security approval is required before the pilot.';rows[9].original='We have not approved the contract.';
  const result=meetingContext(rows,{text:'security approval',guide:true});
  assert.match(result,/Security approval/);assert.match(result,/not approved/);assert.doesNotMatch(result,/DO NOT SEND/);
  assert.equal(isGuideMoment('Could you confirm the conditions?'),true);assert.equal(isGuideMoment('Thank you.'),false);
});
test('a multi-sentence provider chunk becomes separate stable bilingual pairs without loss',()=>{
  const finals=[];const a=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r)});
  a.receive({inputTranscription:{text:'First sentence. Second sentence. Third sentence.'}});
  assert.equal(finals.length,3);assert.equal(finals.map(r=>r.original).join(' '),'First sentence. Second sentence. Third sentence.');assert.equal(new Set(finals.map(r=>r.id)).size,3);
});
test('provider event-name framing works without event_type in JSON',async()=>{
  const events=[];for await(const e of readSSE(new Response('event: interaction.complete\ndata: {"interaction":{"usage":{"total_input_tokens":10}}}\n\n').body,{eventTypes:true}))events.push(e);
  assert.equal(events[0].event_type,'interaction.complete');assert.equal(events[0].interaction.usage.total_input_tokens,10);
});

test('reply guide rejects invented commitments while accepting specific conditional clarification',async()=>{
  const {validateReplyOptions}=await import('../src/reply-options.mjs');
  assert.throws(()=>validateReplyOptions([{ko:'검토 후 승인할 수 있습니다.',en:'We can approve after the review.'}]));
  assert.throws(()=>validateReplyOptions([{ko:'알려드리겠습니다.',en:'I will update you.'}]));
  assert.equal(validateReplyOptions([{ko:'보안 검토 기간도 포함되나요?',en:'Does the estimate include the security review?'}]).length,1);
});

test('a 30-minute-equivalent accelerated transcript retains all 1800 source sentences and stable IDs',()=>{
  const finals=[];let time=0;
  const a=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r),now:()=>time});
  for(let i=0;i<1800;i++){time+=1000;a.receive({interimInputTranscription:{text:`Record ${i} is not`}});a.receive({inputTranscription:{text:`Record ${i} is not approved.`}});}
  assert.equal(finals.length,1800);assert.equal(new Set(finals.map(r=>r.id)).size,1800);
  for(let i=0;i<1800;i++)assert.equal(finals[i].original,`Record ${i} is not approved.`);
});
test('stopping preserves punctuation-free confirmed words separately from speculative trailing words',()=>{
  const finals=[];const a=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r)});
  a.receive({inputTranscription:{text:'Thank you'}});a.receive({interimInputTranscription:{text:'for your'}});a.flush();
  assert.equal(finals[0].original,'Thank you');assert.equal(finals[0].sourcePending,false);
  assert.equal(finals[1].original,'for your');assert.equal(finals[1].sourcePending,true);assert.notEqual(finals[0].id,finals[1].id);
});
test('a supported prerequisite is not incorrectly blocked as a future promise',async()=>{
 const {validateReplyOptions}=await import('../src/reply-options.mjs');
 assert.equal(validateReplyOptions([{ko:'보안 검토가 완료되어야 진행할 수 있습니다.',en:'The security review must be completed before implementation.'}]).length,1);
});

test('multi-sentence previews use one request and the identical final reuses its translation',async()=>{
 const sent=[];
 await mockFetch(async(_url,options)=>{sent.push(JSON.parse(options.body).text);return response([{type:'delta',text:'번역'},{type:'done'}]);},async()=>{
   const engine=new MeetingEngine();engine.translationKinds.set('en-US','test');
   await engine.translateDraft('We have not approved. Please review','en-US',{});
   await engine.translateDraft('We have not approved. Please review the contract.','en-US',{});
   await engine.translate('We have not approved. Please review the contract.','en-US',{});
   assert.deepEqual(sent,['We have not approved. Please review','We have not approved. Please review the contract.']);engine.destroy();
 });
});

test('unsafe generated guide becomes a labelled contextual question without another paid request',async()=>{
 let calls=0;
 await mockFetch(async()=>{calls++;return response([{type:'delta',text:JSON.stringify({replies:[{ko:'보내드리겠습니다.',en:'I will send the agenda.'}]})},{type:'done'}]);},async()=>{
  const engine=new MeetingEngine();const replies=await engine.suggest('agenda','비즈니스',{sourceEnglish:'Could you send the agenda?'});
  assert.equal(calls,1);assert.equal(replies[0].fallback,true);assert.match(replies[0].en,/agenda/);assert.doesNotMatch(replies[0].en,/I will/);engine.destroy();
 });
});

test('a final without cached previews keeps multiple sentences in one paid request',async()=>{
 let calls=0;
 await mockFetch(async()=>{calls++;return response([{type:'delta',text:'완료'},{type:'done'}]);},async()=>{
  const engine=new MeetingEngine();engine.translationKinds.set('en-US','test');
  await engine.translate('Please review the contract. We have not approved it.','en-US',{});
  assert.equal(calls,1);engine.destroy();
 });
});
