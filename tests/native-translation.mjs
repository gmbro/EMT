import test from 'node:test';
import assert from 'node:assert/strict';
import { translateNative } from '../src/native-translation.mjs';

test('translation deltas become cumulative text before completion', async () => {
  const updates = [];
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const translator = { translateStreaming: () => new ReadableStream({
    async start(controller) { controller.enqueue('내일 '); await wait; controller.enqueue('회의해요.'); controller.close(); },
  }) };
  const result = translateNative(translator, 'Meet tomorrow.', { onText: text => updates.push(text) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, ['내일 ']);
  release();
  assert.equal(await result, '내일 회의해요.');
  assert.deepEqual(updates, ['내일 ', '내일 회의해요.']);
});

test('stalled draft aborts native operation and ignores late output', async () => {
  let signal, finish;
  const updates = [];
  const translator = { translate: (_, options) => {
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  } };
  await assert.rejects(translateNative(translator, 'Hello', { onText: text => updates.push(text), timeoutMs: 5 }), /늦어졌어요/);
  assert.equal(signal.aborted, true);
  finish('안녕하세요');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

test('clearing drafts aborts pending translation promptly', async () => {
  const controller = new AbortController();
  const pending = translateNative({ translate: () => new Promise(() => {}) }, 'Hello', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('empty translation is a visible failure instead of a blank success', async () => {
  await assert.rejects(translateNative({ translate: async () => '  ' }, 'Hello'), /비어/);
});
