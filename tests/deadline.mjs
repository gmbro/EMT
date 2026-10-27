import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline } from '../src/deadline.mjs';
import { ModelClient } from '../src/models/client.js';
import { MeetingEngine } from '../src/meeting-engine.js';

test('native API deadline disposes a model that finishes after timeout', async () => {
  let finish;
  let disposed = false;
  const promise = new Promise(resolve => { finish = resolve; });
  await assert.rejects(withDeadline(() => promise, 5, 'timeout', model => { disposed = model.dispose; }), /timeout/);
  finish({ dispose: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, true);
});

test('native API deadline preserves success and original errors', async () => {
  assert.equal(await withDeadline(() => 42, 100, 'timeout'), 42);
  await assert.rejects(withDeadline(() => Promise.reject(new Error('original')), 100, 'timeout'), /original/);
});

class FakeWorker {
  constructor() { FakeWorker.last = this; }
  postMessage(message) { this.message = message; }
  terminate() { this.terminated = true; }
}

test('a failed model worker rejects both pending and all future requests', async () => {
  const previous = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const client = new ModelClient();
    const pending = client.request('prepare-speech');
    FakeWorker.last.onerror();
    await assert.rejects(pending, error => error.localModelFatal === true);
    await assert.rejects(client.request('transcribe'), error => error.localModelFatal === true);
    assert.equal(client.pending.size, 0);
    assert.equal(FakeWorker.last.terminated, true);
  } finally { globalThis.Worker = previous; }
});

test('worker results settle and release pending requests', async () => {
  const previous = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const client = new ModelClient();
    const pending = client.request('prepare-speech');
    const worker = FakeWorker.last;
    worker.onmessage({ data: { id: worker.message.id, event: 'result', value: 'ready' } });
    assert.equal(await pending, 'ready');
    assert.equal(client.pending.size, 0);
    client.destroy();
  } finally { globalThis.Worker = previous; }
});

test('selected-language native translation is ready without reply AI or the other speech pack', async () => {
  const previous = globalThis.window;
  const requested = [];
  class Recognition {
    constructor() { this.processLocally = false; }
    static async available(options) { requested.push(options); return 'available'; }
    static async install() { throw new Error('must not install an available pack'); }
  }
  globalThis.window = {
    SpeechRecognition: Recognition,
    Translator: { availability: async () => 'available', create: async () => ({ translate: async text => text, destroy() {} }) },
  };
  try {
    const engine = new MeetingEngine();
    const result = await engine.prepare('en-US');
    assert.ok(result.nativeSpeech);
    assert.equal(engine.canSuggest, false);
    assert.ok(requested.every(options => options.langs.length === 1 && options.langs[0] === 'en-US' && options.processLocally === true));
    assert.equal(engine.nativeTranslators.has('ko-KR'), false);
    engine.destroy();
  } finally { globalThis.window = previous; }
});

test('cancelled preparation destroys a late native translator without starting a fallback worker', async () => {
  const previous = globalThis.window;
  let resolveModel, disposed = false;
  const created = new Promise(resolve => { resolveModel = resolve; });
  globalThis.window = { Translator: { availability: async () => 'available', create: () => created } };
  try {
    const engine = new MeetingEngine();
    const pending = engine.prepareTranslation('en-US');
    await new Promise(resolve => setImmediate(resolve));
    engine.destroy();
    resolveModel({ destroy() { disposed = true; } });
    await assert.rejects(pending, /취소/);
    assert.equal(disposed, true);
    assert.equal(engine.nativeTranslators.size, 0);
    assert.equal(engine.modelClient, undefined);
    assert.equal(engine.mtClient, undefined);
  } finally { globalThis.window = previous; }
});
