import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedTranslations } from '../src/shared-translation.mjs';
import { MeetingEngine } from '../src/meeting-engine.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function scenario(run) {
  const originalFetch=globalThis.fetch, calls=[];
  globalThis.fetch=async (_url,options)=>{
    let stream;
    const call={signal:options.signal,body:JSON.parse(options.body),emit:event=>stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))};
    const response=new Response(new ReadableStream({start(controller){stream=controller;}}));
    call.end=()=>stream.close();
    call.complete=text=>{call.emit({type:'delta',text});call.emit({type:'done'});stream.close();};
    calls.push(call);return response;
  };
  const engine=new MeetingEngine();
  try { await run(engine,calls); } finally { engine.destroy();globalThis.fetch=originalFetch; }
}

test('record-button setup and first cloud translation require just the translation POST', async () => {
  await scenario(async (engine, calls) => {
    await engine.prepare('en-US', { verifyTranslation: false });
    assert.equal(calls.length, 0);
    const pending = engine.translate('Please send it by Friday.', 'en-US');
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.text, 'Please send it by Friday.');
    calls[0].complete('금요일까지 보내 주세요.');
    assert.equal((await pending).text, '금요일까지 보내 주세요.');
  });
});

test('cached previews preserve surrounding paragraph context and a whole-result hit wins', async () => {
  await scenario(async (engine, calls) => {
    const preview = 'The review is complete.';
    const tail = 'We have not approved the budget.\nIt still requires a signature. Please confirm.';
    const source = preview + ' ' + tail;
    const seed = engine.translateDraft(preview, 'en-US');
    await tick(); calls[0].complete('검토가 끝났습니다.'); await seed;
    const result = engine.translate(source, 'en-US');
    await tick();
    assert.deepEqual(calls.map(call => call.body.text), [preview, tail]);
    calls[1].complete('예산은 아직 승인되지 않았습니다.'); await result;
    const whole = engine.translateDraft(source, 'en-US');
    await tick(); calls[2].complete('문단 전체 번역'); await whole;
    assert.equal((await engine.translate(source, 'en-US')).text, '문단 전체 번역');
    assert.equal(calls.length, 3);
  });
});

test('identical simultaneous translations make one paid request and late subscribers receive current text',async()=>{
  await scenario(async(engine,calls)=>{
    const first=[],second=[],late=[];
    const a=engine.cloudChunk('Not approved.','en-US',{onText:text=>first.push(text)});
    const b=engine.cloudChunk('Not approved.','en-US',{onText:text=>second.push(text)});
    await tick();assert.equal(calls.length,1);
    calls[0].emit({type:'delta',text:'승인되지 '});await tick();
    const c=engine.cloudChunk('Not approved.','en-US',{onText:text=>late.push(text)});
    assert.deepEqual(late,['승인되지 ']);
    calls[0].complete('않았습니다.');
    const results=await Promise.all([a,b,c]);
    assert.ok(results.every(row=>row.text==='승인되지 않았습니다.'));
    assert.deepEqual(first,second);assert.deepEqual(first,late);
    assert.equal(calls.length,1);
  });
});

test('cancelling one consumer neither cancels nor blocks the other consumer',async()=>{
  await scenario(async(engine,calls)=>{
    const a=new AbortController(),b=new AbortController();
    const first=engine.cloudChunk('Review the contract.','en-US',{signal:a.signal});
    const second=engine.cloudChunk('Review the contract.','en-US',{signal:b.signal});
    const cancelled=assert.rejects(first,{name:'AbortError',code:'CANCELLED'});
    await tick();a.abort();await cancelled;
    assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);
    calls[0].complete('계약을 검토해 주세요.');
    assert.equal((await second).text,'계약을 검토해 주세요.');
  });
});

test('the last consumer cancellation aborts the provider and a later request starts independently',async()=>{
  await scenario(async(engine,calls)=>{
    const a=new AbortController(),b=new AbortController();
    const first=engine.cloudChunk('Test.','en-US',{signal:a.signal});
    const second=engine.cloudChunk('Test.','en-US',{signal:b.signal});
    const cancelled=Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
    await tick();a.abort();assert.equal(calls[0].signal.aborted,false);
    b.abort();await cancelled;assert.equal(calls[0].signal.aborted,true);
    const next=engine.cloudChunk('Test.','en-US');await tick();assert.equal(calls.length,2);
    calls[1].complete('새 번역');assert.equal((await next).text,'새 번역');
    // Even a transport that ignores AbortSignal cannot seed stale cached text.
    calls[0].complete('취소된 번역');await tick();
    assert.equal((await engine.cloudChunk('Test.','en-US')).text,'새 번역');
  });
});

test('draft, retry, timeout, task, reply count, glossary and context policies do not share active requests',async()=>{
  await scenario(async(engine,calls)=>{
    const options=[{}, {draft:true}, {retries:0}, {timeoutMs:6000}, {task:'speech'}, {replyCount:2}, {context:'Rental.'}, {glossary:'deposit = 계약금'}];
    const jobs=options.map(option=>engine.cloudChunk('Same source.','en-US',option));
    await tick();assert.equal(calls.length,options.length);
    calls.forEach((call,index)=>call.complete(`번역 ${index}`));
    const results=await Promise.all(jobs);
    assert.deepEqual(results.map(row=>row.text),options.map((_,index)=>`번역 ${index}`));
  });
});

test('clearing a meeting cancels its subscribers and old completion cannot overwrite the new meeting cache',async()=>{
  await scenario(async(engine,calls)=>{
    const old=engine.cloudChunk('A shared sentence.','en-US');
    const stopped=assert.rejects(old,{name:'AbortError'});
    await tick();engine.clearCloudCache();await stopped;
    assert.equal(calls[0].signal.aborted,true);
    const fresh=engine.cloudChunk('A shared sentence.','en-US');await tick();
    calls[1].complete('현재 회의 번역');await fresh;
    calls[0].complete('이전 회의 번역');await tick();
    assert.equal((await engine.cloudChunk('A shared sentence.','en-US')).text,'현재 회의 번역');
    assert.equal(calls.length,2);
  });
});

test('destroy rejects active consumers and cannot create a new network request',async()=>{
  await scenario(async(engine,calls)=>{
    const job=engine.cloudChunk('Pending.','en-US');const stopped=assert.rejects(job,{name:'AbortError'});
    await tick();engine.destroy();await stopped;
    assert.equal(calls[0].signal.aborted,true);
    await assert.rejects(engine.cloudChunk('Pending.','en-US'),{name:'AbortError'});
    calls[0].complete('오래된 번역');await tick();assert.equal(engine.resultCache.size,0);assert.equal(calls.length,1);
  });
});


test('an incomplete shared stream rejects every consumer and is never cached',async()=>{
  await scenario(async(engine,calls)=>{
    const first=engine.cloudChunk('Keep the negation.','en-US',{retries:0});
    const second=engine.cloudChunk('Keep the negation.','en-US',{retries:0});
    const rejected=Promise.all([assert.rejects(first,e=>e.code==='INCOMPLETE_STREAM'),assert.rejects(second,e=>e.code==='INCOMPLETE_STREAM')]);
    await tick();assert.equal(calls.length,1);calls[0].emit({type:'delta',text:'불완전'});calls[0].end();await rejected;
    assert.equal(engine.resultCache.size,0);
    const next=engine.cloudChunk('Keep the negation.','en-US',{retries:0});await tick();calls[1].complete('부정을 유지합니다.');
    assert.equal((await next).text,'부정을 유지합니다.');assert.equal(calls.length,2);
  });
});

test('shared retries notify every consumer and a late joiner cannot replay the failed attempt',async()=>{
  const shared=createSharedTranslations(),events=[],first=[],second=[];let publication,complete;
  const start=(_signal,publish)=>{publication=publish;return new Promise(resolve=>complete=resolve);};
  const a=shared.run('same',start,{onText:(text,meta)=>first.push([text,meta.attempt]),onRetry:info=>events.push(['a',info.attempt])});
  const b=shared.run('same',start,{onText:(text,meta)=>second.push([text,meta.attempt]),onRetry:info=>events.push(['b',info.attempt])});
  await tick();publication.onText('first partial',{attempt:0});publication.onRetry({attempt:1,delay:1000});
  const late=[];const c=shared.run('same',start,{onText:(text,meta)=>late.push([text,meta.attempt]),onRetry:info=>events.push(['c',info.attempt])});
  assert.deepEqual(late,[]);assert.deepEqual(events,[['a',1],['b',1],['c',1]]);
  publication.onText('retried translation',{attempt:1});complete({text:'retried translation'});await Promise.all([a,b,c]);
  assert.deepEqual(first,second);assert.deepEqual(late,[['retried translation',1]]);
});

test('a consumer cancelled by another stream listener receives no later publication',async()=>{
 const shared=createSharedTranslations(),controller=new AbortController(),seen=[];let publish,finish;
 const start=(_signal,events)=>{publish=events;return new Promise(resolve=>finish=resolve);};
 const first=shared.run('shared',start,{onText:()=>controller.abort()});
 const second=shared.run('shared',start,{signal:controller.signal,onText:text=>seen.push(text)});
 const cancelled=assert.rejects(second,{name:'AbortError'});
 await tick();publish.onText('current output');await cancelled;
 assert.deepEqual(seen,[]);finish({text:'current output'});await first;
});


test('a late subscriber cancelling itself during retry replay receives no text replay',async()=>{
  const shared=createSharedTranslations(),controller=new AbortController(),seen=[];let publish,finish,starts=0;
  const start=(_signal,events)=>{starts++;publish=events;return new Promise(resolve=>finish=resolve);};
  const first=shared.run('same',start);await tick();
  publish.onRetry({attempt:1,delay:1000});publish.onText('current retry output',{attempt:1});
  const late=shared.run('same',start,{signal:controller.signal,onRetry:()=>controller.abort(),onText:text=>seen.push(text)});
  await assert.rejects(late,{name:'AbortError'});assert.deepEqual(seen,[]);assert.equal(starts,1);
  finish({text:'current retry output'});assert.equal((await first).text,'current retry output');
});

test('clearing all consumers during retry replay prevents text replay and leaves the next request independent',async()=>{
  const shared=createSharedTranslations(),seen=[];let publish,finish,providerSignal,starts=0;
  const start=(signal,events)=>{starts++;providerSignal=signal;publish=events;return new Promise(resolve=>finish=resolve);};
  const first=shared.run('same',start),firstCancelled=assert.rejects(first,{name:'AbortError'});await tick();
  publish.onRetry({attempt:1,delay:1000});publish.onText('old retry output',{attempt:1});
  const late=shared.run('same',start,{onRetry:()=>shared.clear(),onText:text=>seen.push(text)});
  await Promise.all([firstCancelled,assert.rejects(late,{name:'AbortError'})]);
  assert.deepEqual(seen,[]);assert.equal(providerSignal.aborted,true);assert.equal(starts,1);
  finish({text:'old retry output'});await tick();
  const next=shared.run('same',start);await tick();assert.equal(starts,2);finish({text:'new output'});
  assert.equal((await next).text,'new output');
});
