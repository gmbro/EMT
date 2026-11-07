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
    if (calls.length === 1) return new Response('{}');
    return sse([{ event_type: 'step.delta', delta: { type: 'thought', text: 'hidden' } }, { event_type: 'step.delta', delta: { type: 'text', text: '아직 승인되지 ' } }, { event_type: 'step.delta', delta: { type: 'text', text: '않았습니다.' } }, { event_type: 'interaction.completed' }]);
  } });
  const reply = new Reply(); await handler(request({ text: 'Not approved.', language: 'en-US', context: 'A contract.', glossary: 'approval = 승인' }), reply);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.tools, undefined);
  assert.equal(calls[1].options.headers['x-goog-api-key'], 'test-key'); assert.ok(!calls[1].url.includes('test-key'));
  assert.equal(JSON.parse(body.input).transcript_to_translate, 'Not approved.');
  assert.ok(!reply.body.includes('test-key')); assert.ok(!reply.body.includes('hidden'));
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.deepEqual(events.filter(event => event.type === 'delta').map(event => event.text), ['아직 승인되지 ', '않았습니다.']);
  assert.equal(events.at(-1).type, 'done'); assert.equal(reply.headers['cache-control'], 'no-store');
});

test('unfinished provider stream is an error, not a successful partial translation', async () => {
  let calls = 0;
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async () => ++calls === 1 ? new Response('{}') : sse([{ event_type: 'step.delta', delta: { type: 'text', text: 'partial' } }]) });
  const reply = new Reply(); await handler(request({ text: 'Hello', language: 'en-US' }), reply);
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.equal(events.at(-1).type, 'error'); assert.ok(!events.some(event => event.type === 'done'));
});

test('provider exceptions cannot expose credentials or raw provider messages', async () => {
  const handler = createHandler({ getKey: () => 'sensitive-test-key', fetchImpl: async () => { throw new Error('Google sensitive-test-key response'); } });
  const reply = new Reply(); await handler({ method: 'GET', headers: {} }, reply);
  assert.ok(!reply.body.includes('sensitive-test-key')); assert.equal(reply.statusCode, 503);
});

test('readable model metadata does not mark depleted inference credits ready', async () => {
  let calls = 0;
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async () => ++calls === 1 ? new Response('{}') : new Response('{}', { status: 402 }) });
  const reply = new Reply(); await handler({ method: 'GET', headers: {} }, reply);
  assert.equal(reply.statusCode, 402); assert.equal(JSON.parse(reply.body).code, 'CREDITS_EXHAUSTED');
  assert.match(JSON.parse(reply.body).error, /크레딧/); assert.ok(!JSON.parse(reply.body).ready);
});

test('verified health checks are cached without repeatedly billing for a probe', async () => {
  let calls = 0;
  const handler = createHandler({ getKey: () => 'test', fetchImpl: async () => { calls++; return new Response('{}'); } });
  for (let i = 0; i < 2; i++) { const reply = new Reply(); await handler({ method: 'GET', headers: {} }, reply); assert.equal(reply.statusCode, 200); }
  assert.equal(calls, 2, 'one metadata call and one harmless inference probe');
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
    return calls.length === 1 ? new Response('{}') : sse([{ event_type: 'step.delta', delta: { type: 'text', text: '{"replies":[{"ko":"조금 더 설명해 주시겠어요?","en":"Could you clarify that?"}]}' } }, { event_type: 'interaction.completed' }]);
  } });
  const reply = new Reply(); await handler(request({ text: 'Could you share the review process?', language: 'en-US', context: 'We have not approved the contract.', task: 'replies' }), reply);
  const sent = JSON.parse(calls[1].options.body), input = JSON.parse(sent.input);
  assert.equal(input.latest_english_turn, 'Could you share the review process?');
  assert.equal(input.prior_context, 'We have not approved the contract.');
  assert.equal(input.transcript_to_translate, undefined); assert.equal(sent.tools, undefined);
  assert.equal(sent.store, false); assert.match(sent.system_instruction, /Never invent/);
  const events = []; for await (const event of readSSE(new Response(reply.body).body)) events.push(event);
  assert.equal(events.at(-1).type, 'done');
});

test('business speech uses separate task and preserves commitment constraints without changing reply generation',async()=>{
 const calls=[];const handler=createHandler({getKey:()=> 'test',fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?new Response('{}'):sse([{event_type:'step.delta',delta:{type:'text',text:'We have not approved it yet.'}},{event_type:'interaction.completed'}]);}});
 const reply=new Reply();await handler(request({text:'아직 승인하지 않았습니다.',language:'ko-KR',task:'speech',context:'Contract review.'}),reply);
 const sent=JSON.parse(calls[1].options.body);assert.match(sent.system_instruction,/easy to say aloud/);assert.match(sent.system_instruction,/Never invent/);assert.equal(JSON.parse(sent.input).transcript_to_translate,'아직 승인하지 않았습니다.');assert.equal(sent.store,false);
 assert.throws(()=>validateInput({text:'Hello',language:'en-US',task:'speech'}));
});

test('terminal event usage is whitelisted and succeeds without waiting for transport close',async()=>{
  let n=0,cancelled=false;
  const handler=createHandler({getKey:()=> 'test',fetchImpl:async()=>++n===1?new Response('{}'):new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: step.delta\ndata: {"delta":{"type":"text","text":"완료"}}\n\nevent: interaction.complete\ndata: {"interaction":{"usage":{"total_input_tokens":25,"total_output_tokens":5,"private":"never echo"}}}\n\n'));},cancel(){cancelled=true;}}))});
  const reply=new Reply();await handler(request({text:'Done.','language':'en-US'}),reply);
  assert.equal(cancelled,true);assert.match(reply.body,/total_input_tokens/);assert.ok(!reply.body.includes('never echo'));
});
