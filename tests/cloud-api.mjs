import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHandler, validateInput } from '../api/translate.js';
import { readSSE } from '../src/sse.mjs';

class Reply extends EventEmitter {
  headers = {}; body = ''; statusCode = 200;
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  write(value) { this.body += value; }
  end(value = '') { this.body += value; this.writableEnded = true; }
  flushHeaders() {}
}
const request = (body, extra = {}) => ({ method: 'POST', body, headers: { host: 'emt-theta.vercel.app', origin: 'https://emt-theta.vercel.app', 'content-type': 'application/json' }, ...extra });
const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

test('API rejects audio, arbitrary model/endpoint, oversized context and unsupported languages', () => {
  for (const input of [{ text: 'hello', language: 'en-US', audio: 'binary' }, { text: 'hello', language: 'en-US', model: 'arbitrary' }, { text: 'hello', language: 'fr' }, { text: 'hello', language: 'en-US', task: 'execute' }, { text: 'x'.repeat(1801), language: 'en-US' }, { text: 'hello', language: 'en-US', context: 'x'.repeat(3001) }]) assert.throws(() => validateInput(input));
});

test('missing key and foreign origin fail before any provider request', async () => {
  const handler = createHandler({ getKey: () => '', fetchImpl: () => { throw new Error('must not fetch'); } });
  const missing = new Reply(); await handler({ method: 'GET', headers: {} }, missing);
  assert.equal(missing.statusCode, 503); assert.equal(JSON.parse(missing.body).code, 'KEY_MISSING');
  const foreign = new Reply(); await handler(request({ text: 'hello', language: 'en-US' }, { headers: { host: 'emt-theta.vercel.app', origin: 'https://other.example' } }), foreign);
  assert.equal(foreign.statusCode, 403);
});

test('provider gets only text, no tools, no server-side interaction storage, key only in header', async () => {
  const calls = [];
  const handler = createHandler({ getKey: () => 'test-key', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return sse([{ event_type: 'step.delta', delta: { type: 'thought', text: 'hidden' } }, { event_type: 'step.delta', delta: { type: 'text', text: '아직 승인되지 ' } }, { event_type: 'step.delta', delta: { type: 'text', text: '않았습니다.' } }, { event_type: 'interaction.completed' }]);
  } });
  const reply = new Reply(); await handler(request({ text: 'Not approved.', language: 'en-US', context: 'A contract.', glossary: 'approval = 승인' }), reply);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.tools, undefined);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-key'); assert.ok(!calls[0].url.includes('test-key'));
  assert.equal(JSON.parse(body.input).transcript_to_translate, 'Not approved.');
  assert.ok(!reply.body.includes('test-key')); assert.ok(!reply.body.includes('hidden'));
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.deepEqual(events.filter(event => event.type === 'delta').map(event => event.text), ['아직 승인되지 ', '않았습니다.']);
  assert.equal(events.at(-1).type, 'done'); assert.equal(reply.headers['cache-control'], 'no-store');
});

test('unfinished provider stream is an error, not a successful partial translation', async () => {
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async () => sse([{ event_type: 'step.delta', delta: { type: 'text', text: 'partial' } }]) });
  const reply = new Reply(); await handler(request({ text: 'Hello', language: 'en-US' }), reply);
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.equal(events.at(-1).type, 'error'); assert.ok(!events.some(event => event.type === 'done'));
});

test('provider exceptions cannot expose credentials or raw provider messages', async () => {
  const handler = createHandler({ getKey: () => 'sensitive-test-key', fetchImpl: async () => { throw new Error('Google sensitive-test-key response'); } });
  const reply = new Reply(); await handler({ method: 'GET', headers: {} }, reply);
  assert.ok(!reply.body.includes('sensitive-test-key')); assert.equal(reply.statusCode, 503);
});

test('health checks probe real inference and reject depleted credits without metadata lookup', async () => {
  const calls = [];
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async (url, options) => { calls.push({url, options}); return new Response('{}', { status: 402 }); } });
  const reply = new Reply(); await handler({ method: 'GET', headers: {} }, reply);
  assert.equal(reply.statusCode, 402); assert.equal(JSON.parse(reply.body).code, 'CREDITS_EXHAUSTED');
  assert.match(JSON.parse(reply.body).error, /크레딧/); assert.ok(!JSON.parse(reply.body).ready);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/interactions$/);
  assert.equal(JSON.parse(calls[0].options.body).input, 'Hello.');
});

test('verified health checks are cached without repeatedly billing for a probe', async () => {
  let time = 1000; const calls = [];
  const handler = createHandler({ getKey: () => 'test', now: () => time, fetchImpl: async (url, options) => { calls.push({url, options}); return new Response('{}'); } });
  for (let i = 0; i < 2; i++) { const reply = new Reply(); await handler({ method: 'GET', headers: {} }, reply); assert.equal(reply.statusCode, 200); }
  assert.equal(calls.length, 1, 'one harmless inference probe, no metadata call');
  const sent = JSON.parse(calls[0].options.body);
  assert.match(calls[0].url, /\/interactions$/); assert.equal(sent.stream, false); assert.equal(sent.store, false);
  assert.equal(sent.model, 'gemini-3.5-flash-lite'); assert.equal(sent.generation_config.thinking_level, 'minimal');
  time += 60001;
  const refreshed = new Reply(); await handler({ method: 'GET', headers: {} }, refreshed);
  assert.equal(refreshed.statusCode, 200); assert.equal(calls.length, 2);
});

test('a successful reply or speech request cannot replace verification of the translation route', async () => {
  for (const task of ['replies', 'speech']) {
    const calls=[];
    const handler=createHandler({getKey:()=> 'test',now:()=>1000,fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push(body);
      return body.stream
        ? sse([{event_type:'step.delta',delta:{type:'text',text:'Completed output.'}},{event_type:'interaction.completed'}])
        : new Response('{}');
    }});
    const completed=new Reply();
    await handler(request({task,text:task==='speech'?'아직 승인하지 않았습니다.':'Could you explain the review?',language:task==='speech'?'ko-KR':'en-US'}),completed);
    assert.equal(completed.statusCode,200);assert.match(completed.body,/"type":"done"/);
    const health=new Reply();await handler({method:'GET',headers:{}},health);
    assert.equal(health.statusCode,200);assert.equal(calls.length,2,`${task} must not verify another task's route`);
    assert.equal(calls[1].stream,false);assert.equal(calls[1].model,'gemini-3.5-flash-lite');assert.equal(calls[1].input,'Hello.');
    const cached=new Reply();await handler({method:'GET',headers:{}},cached);
    assert.equal(cached.statusCode,200);assert.equal(calls.length,2,'the actual translation probe is then cached');
  }
});

test('SSE UTF-8 characters survive split chunks and CRLF framing', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"delta","text":"한글😀"}\r\n\r\ndata: {"type":"done"}\n\n');
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } });
  const events = []; for await (const event of readSSE(stream)) events.push(event);
  assert.deepEqual(events, [{ type: 'delta', text: '한글😀' }, { type: 'done' }]);
});

test('Google terminal DONE marker does not turn a completed translation into an error', async () => {
  const stream = new Response('event: step.delta\ndata: {"delta":{"type":"text","text":"안녕"}}\n\nevent: done\ndata: [DONE]\n\n').body;
  const events = []; for await (const event of readSSE(stream)) events.push(event);
  assert.deepEqual(events, [{ delta: { type: 'text', text: '안녕' } }]);
});


test('reply guides receive only the latest English turn and quoted context, with no tool access', async () => {
  const calls = [];
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return sse([{ event_type: 'step.delta', delta: { type: 'text', text: '{"replies":[{"ko":"조금 더 설명해 주시겠어요?","en":"Could you clarify that?"}]}' } }, { event_type: 'interaction.completed' }]);
  } });
  const reply = new Reply(); await handler(request({ text: 'Could you share the review process?', language: 'en-US', context: 'We have not approved the contract.', task: 'replies' }), reply);
  const sent = JSON.parse(calls[0].options.body), input = JSON.parse(sent.input);
  assert.equal(input.latest_english_turn, 'Could you share the review process?');
  assert.equal(input.prior_context, 'We have not approved the contract.');
  assert.equal(input.transcript_to_translate, undefined); assert.equal(sent.tools, undefined);
  assert.equal(sent.store, false); assert.match(sent.system_instruction, /Never invent/);
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.equal(events.at(-1).type, 'done');
});

test('business speech uses separate task and preserves commitment constraints without changing reply generation',async()=>{
 const calls=[];const handler=createHandler({getKey:()=> 'test',fetchImpl:async(url,options)=>{calls.push({url,options});return sse([{event_type:'step.delta',delta:{type:'text',text:'We have not approved it yet.'}},{event_type:'interaction.completed'}]);}});
 const reply=new Reply();await handler(request({text:'아직 승인하지 않았습니다.',language:'ko-KR',task:'speech',context:'Contract review.'}),reply);
 const sent=JSON.parse(calls[0].options.body);assert.match(sent.system_instruction,/easy to say aloud/);assert.match(sent.system_instruction,/Never invent/);assert.equal(JSON.parse(sent.input).transcript_to_translate,'아직 승인하지 않았습니다.');assert.equal(sent.store,false);
 assert.throws(()=>validateInput({text:'Hello',language:'en-US',task:'speech'}));
});

test('terminal event usage is whitelisted and succeeds without waiting for transport close',async()=>{
  let cancelled=false;
  const handler=createHandler({getKey:()=> 'test',fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: step.delta\ndata: {"delta":{"type":"text","text":"완료"}}\n\nevent: interaction.complete\ndata: {"interaction":{"usage":{"total_input_tokens":25,"total_output_tokens":5,"private":"never echo"}}}\n\n'));},cancel(){cancelled=true;}}))});
  const reply=new Reply();await handler(request({text:'Done.','language':'en-US'}),reply);
  assert.equal(cancelled,true);assert.match(reply.body,/total_input_tokens/);assert.ok(!reply.body.includes('never echo'));
});

test('translation starts inference directly and task-specific models keep minimal thinking off reply guides', async () => {
  const calls = [];
  const handler = createHandler({ getKey: () => 'test-key', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return sse([{ event_type: 'step.delta', delta: { type: 'text', text: 'Output' } }, { event_type: 'interaction.completed' }]);
  } });
  for (const input of [
    { text: 'Not approved.', language: 'en-US', task: 'translate' },
    { text: '아직 승인하지 않았습니다.', language: 'ko-KR', task: 'speech' },
    { text: 'Could you explain the review?', language: 'en-US', task: 'replies' },
  ]) {
    const reply = new Reply(); await handler(request(input), reply);
    assert.equal(reply.statusCode, 200); assert.match(reply.body, /"type":"done"/);
  }
  assert.equal(calls.length, 3, 'each task makes exactly one inference call and no metadata request');
  assert.ok(calls.every(call => call.url === 'https://generativelanguage.googleapis.com/v1beta/interactions'));
  const sent = calls.map(call => JSON.parse(call.options.body));
  assert.deepEqual(sent.map(body => [body.model, body.generation_config.thinking_level]), [
    ['gemini-3.5-flash-lite', 'minimal'], ['gemini-3.5-flash-lite', 'minimal'], ['gemini-3.8-flash', 'low'],
  ]);
});

test('only a missing inference model falls back before any text has streamed', async () => {
  const calls = [];
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response('{}', { status: 404 });
    return sse([{ event_type: 'step.delta', delta: { type: 'text', text: '확인했습니다.' } }, { event_type: 'interaction.completed' }]);
  } });
  const reply = new Reply(); await handler(request({ text: 'Confirmed.', language: 'en-US' }), reply);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(calls.map(call => JSON.parse(call.options.body).model), ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
  assert.ok(calls.every(call => call.options.method === 'POST' && call.url.endsWith('/interactions')));
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.deepEqual(events.filter(event => event.type === 'delta').map(event => event.text), ['확인했습니다.']);
  assert.equal(events.at(-1).model, 'gemini-3.6-flash');
});

test('credentials, credit, rate-limit and server failures do not trigger duplicate fallback inference', async () => {
  for (const status of [400, 401, 402, 403, 429, 503]) {
    let calls = 0;
    const handler = createHandler({ getKey: () => 'private-key', fetchImpl: async () => {
      calls++; return new Response('{"error":"private-key provider details"}', { status });
    } });
    const reply = new Reply(); await handler(request({ text: 'Hello.', language: 'en-US' }), reply);
    assert.equal(calls, 1, `HTTP ${status} must not try a second model`);
    assert.ok(reply.statusCode >= 400); assert.ok(!reply.body.includes('private-key'));
    assert.ok(!reply.headers['content-type']?.includes('text/event-stream'));
  }
});

test('model-order override cannot send an arbitrary model to Google', async () => {
  const calls = [];
  const handler = createHandler({ getKey: () => 'test', modelOrder: ['attacker-model', 'gemini-3.6-flash'], fetchImpl: async (url, options) => {
    calls.push(JSON.parse(options.body));
    return sse([{ event_type: 'step.delta', delta: { type: 'text', text: '번역' } }, { event_type: 'interaction.completed' }]);
  } });
  const reply = new Reply(); await handler(request({ text: 'Hello.', language: 'en-US' }), reply);
  assert.equal(reply.statusCode, 200); assert.deepEqual(calls.map(body => body.model), ['gemini-3.6-flash']);
  assert.equal(calls[0].generation_config.thinking_level, 'minimal');
});
