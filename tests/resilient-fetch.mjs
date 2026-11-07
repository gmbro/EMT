import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchModelAsset } from '../src/models/resilient-fetch.mjs';

test('interrupted model stream resumes at delivered offset without duplicate bytes', async () => {
  const ranges = [], updates = []; let calls = 0;
  const fetchImpl = async (url, options) => {
    ranges.push(options.headers.get('Range'));
    if (++calls === 1) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, pull(controller) { controller.error(new TypeError('network error')); } }));
    return new Response(new Uint8Array([4, 5, 6]), { status: 206, headers: { 'Content-Range': 'bytes 3-5/6' } });
  };
  const response = await fetchModelAsset('https://example.com/model.onnx', {}, { bytes: 6, fetchImpl, onRetry: info => updates.push(info), wait: async () => {} });
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ranges, [null, 'bytes=3-']); assert.deepEqual(updates, [{ attempt: 1, offset: 3 }]);
  assert.equal(response.headers.get('content-length'), '6');
});

test('range-ignoring server cannot duplicate a partial model', async () => {
  let calls = 0;
  const fetchImpl = async () => ++calls === 1 ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); }, pull(c) { c.error(new Error('disconnect')); } })) : new Response(new Uint8Array([1, 2]));
  const response = await fetchModelAsset('https://example.com/model.onnx', {}, { bytes: 2, fetchImpl, wait: async () => {} });
  await assert.rejects(response.arrayBuffer(), error => error.code === 'INVALID_RANGE'); assert.equal(calls, 2);
});

test('connection failures retry twice and then expose a readable network error', async () => {
  let calls = 0;
  await assert.rejects(fetchModelAsset('https://example.com/model.onnx', {}, { bytes: 2, fetchImpl: async () => { calls++; throw new TypeError('Failed to fetch'); }, wait: async () => {} }), /네트워크/);
  assert.equal(calls, 3);
});

test('abort never retries a model download', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(fetchModelAsset('https://example.com/model.onnx', { signal: controller.signal }, { bytes: 2, fetchImpl: async () => { calls++; throw new DOMException('Aborted', 'AbortError'); }, wait: async () => {} }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});
