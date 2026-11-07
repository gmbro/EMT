import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenLive} from '../src/qwen-live.mjs';
const sse=text=>new Response(`data: ${JSON.stringify({type:'delta',text})}\n\ndata: ${JSON.stringify({type:'done',text})}\n\n`);
test('Qwen starts at 800 ms, then coalesces drafts while retaining the final audio',async()=>{
 const sizes=[],finals=[];let release;
 const first=new Promise(resolve=>{release=resolve;});
 const live=await createQwenLive({onUpdate:()=>{},onFinal:r=>finals.push(r),onError:e=>{throw e;},fetchImpl:async(_p,o)=>{
  if(!o?.body)return Response.json({ready:true});
  sizes.push(Buffer.from(JSON.parse(o.body).pcm,'base64').length/2);
  if(sizes.length===1)await first;
  return sse('Could you send the agenda?');
 }});
 live.push(new Float32Array(11200).fill(.1));assert.deepEqual(sizes,[]);
 live.push(new Float32Array(1600).fill(.1));assert.deepEqual(sizes,[12800]);
 live.push(new Float32Array(48000).fill(.1));
 const stopped=live.stop();release();await stopped;
 assert.deepEqual(sizes,[12800,60800]);assert.equal(finals.length,1);
});
test('Qwen uses only local endpoint, streams updates and preserves separate final records',async()=>{
 const finals=[],updates=[],requests=[];
 const live=await createQwenLive({onUpdate:r=>updates.push(r),onFinal:r=>finals.push(r),onError:e=>{throw e;},fetchImpl:async(path,options)=>{
  assert.equal(path,'/api/qwen');if(!options?.body)return Response.json({ready:true});
  requests.push(JSON.parse(options.body));return sse(requests.length===1?'Hello there.':'회의를 시작합니다.');
 }});
 live.push(new Float32Array(16000).fill(.1));live.push(new Float32Array(11200));
 await new Promise(r=>setTimeout(r,10));
 live.push(new Float32Array(16000).fill(.1));await live.stop();
 assert.equal(finals.length,2);assert.notEqual(finals[0].id,finals[1].id);assert.equal(finals[1].language,'ko-KR');assert.ok(updates.some(r=>r.sourcePending));assert.ok(finals.every(r=>r.speechModel==='Qwen3-ASR-1.7B'));
});
test('unavailable Qwen fails explicitly without any cloud fallback',async()=>{
 const paths=[];await assert.rejects(createQwenLive({fetchImpl:async path=>{paths.push(path);return Response.json({error:'loading'},{status:503});}}),/loading/);assert.deepEqual(paths,['/api/qwen']);
});
test('redecoded prefixes do not erase displayed words; final corrections remain authoritative',async()=>{
 const updates=[],finals=[];let calls=0;
 const live=await createQwenLive({onUpdate:r=>updates.push(r.original),onFinal:r=>finals.push(r.original),onError:e=>{throw e;},fetchImpl:async(_p,o)=>{
  if(!o?.body)return Response.json({ready:true});calls++;
  if(calls===1)return sse('We can approve');
  return new Response(['We',' can','not approve.'].map(text=>`data: ${JSON.stringify({type:'delta',text})}\n\n`).join('')+'data: {"type":"done","text":"We cannot approve."}\n\n');
 }});
 live.push(new Float32Array(12800).fill(.1));await new Promise(r=>setTimeout(r,5));
 await live.stop();assert.ok(!updates.includes('We'));assert.ok(!updates.includes('We can'));
 assert.deepEqual(finals,['We cannot approve.']);assert.equal(updates.at(-1),'We cannot approve.');
});
test('stop without flushing does not send queued microphone samples',async()=>{
 let posts=0;const live=await createQwenLive({onUpdate:()=>{},onFinal:()=>{},onError:()=>{},fetchImpl:async(_p,o)=>{if(o?.body)posts++;return Response.json({ready:true});}});
 live.push(new Float32Array(3200).fill(.1));await live.stop({flush:false});assert.equal(posts,0);
});
test('provider inference errors are reported without fabricating a final transcript',async()=>{
 const errors=[],finals=[];const live=await createQwenLive({onUpdate:()=>{},onFinal:r=>finals.push(r),onError:e=>errors.push(e.message),fetchImpl:async(_p,o)=>o?.body?new Response('data: {"type":"error","message":"inference failed"}\n\n'):Response.json({ready:true})});
 live.push(new Float32Array(16000).fill(.1));await live.stop();assert.deepEqual(errors,['inference failed']);assert.equal(finals.length,0);
});
