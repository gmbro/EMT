import test from 'node:test';
import assert from 'node:assert/strict';
import { speechConfiguration, localModelURL } from '../src/models/model-policy.mjs';
import { MODEL_CATALOG, MODEL_ASSETS } from '../src/models/catalog.js';

test('quality uses Turbo q4 GPU and explicitly discloses Small CPU fallback', () => {
  const gpu = speechConfiguration('quality', true);
  const cpu = speechConfiguration('quality', false);
  assert.equal(gpu.key, 'speechTurbo'); assert.equal(cpu.key, 'speechQuality');
  assert.equal(gpu.dtype, 'q4'); assert.match(cpu.label, /GPU 미지원/); assert.ok(cpu.notice);
  assert.equal(cpu.profile, 'quality');
  assert.equal(cpu.device, 'wasm'); assert.equal(cpu.dtype, 'q8');
  assert.equal(speechConfiguration('fast', true).key, 'speech');
});

test('model requests reject arbitrary origins, traversal, query content, and uploads', () => {
  const origin = 'https://example.com'; const prefixes = ['/models/whisper/'];
  assert.equal(localModelURL('/models/whisper/config.json', origin, prefixes).pathname, '/models/whisper/config.json');
  for (const url of ['https://remote.example/models/whisper/config.json', '/models/whisper/../../transcript', '/models/whisper/config.json?audio=content', '/models/another/config.json']) {
    assert.throws(() => localModelURL(url, origin, prefixes));
  }
  assert.throws(() => localModelURL('/models/whisper/config.json', origin, prefixes, 'POST'));
});

test('every model asset has an immutable revision, byte size, and integrity hash', () => {
  for (const [key, model] of Object.entries(MODEL_CATALOG)) {
    assert.match(model.revision, /^[a-f0-9]{40}$/);
    assert.equal(model.bytes, MODEL_ASSETS[key].reduce((sum, asset) => sum + asset.bytes, 0));
    for (const asset of MODEL_ASSETS[key]) {
      assert.ok(asset.bytes > 0); assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.ok(!asset.path.includes('..'));
    }
  }
});

test('stream updates neither resolve nor remove the in-flight model request', async () => {
  const oldWorker = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage(message) { this.sent = message; }
    terminate() {}
  };
  try {
    const { ModelClient } = await import('../src/models/client.js');
    const client = new ModelClient(); const updates = []; let resolved = false;
    const pending = client.request('transcribe', {}, undefined, update => updates.push(update.text)).then(value => { resolved = true; return value; });
    worker.onmessage({ data: { id: worker.sent.id, event: 'update', stage: 'transcript', text: 'Could you' } });
    await Promise.resolve();
    assert.equal(resolved, false); assert.equal(client.pending.size, 1); assert.deepEqual(updates, ['Could you']);
    worker.onmessage({ data: { id: worker.sent.id, event: 'result', value: { text: 'Could you help?' } } });
    assert.deepEqual(await pending, { text: 'Could you help?' }); assert.equal(client.pending.size, 0);
    client.destroy();
  } finally { globalThis.Worker = oldWorker; }
});
