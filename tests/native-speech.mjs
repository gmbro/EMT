import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocalSpeechSupport, prepareLocalSpeech, createLocalRecognition } from '../src/native-speech.mjs';

function mockRecognition({ available, install = async () => true, localProperty = true } = {}) {
  const calls = [];
  class Recognition {
    constructor() { if (localProperty) this.processLocally = false; }
    static async available(options) { calls.push(['available', structuredClone(options)]); return available(options); }
    static async install(options) { calls.push(['install', structuredClone(options)]); return install(options); }
  }
  return { Recognition, calls };
}

test('dictation readiness for the selected language avoids any installation', async () => {
  const { Recognition, calls } = mockRecognition({ available: async () => 'available' });
  const prepared = await prepareLocalSpeech(Recognition, 'ko-KR');
  assert.equal(prepared.language, 'ko-KR');
  assert.equal(prepared.quality, 'dictation');
  assert.deepEqual(calls, [['available', { langs: ['ko-KR'], processLocally: true, quality: 'dictation' }]]);
});

test('downloadable dictation uses identical options in availability, install, and confirmation', async () => {
  let installed = false;
  const { Recognition, calls } = mockRecognition({
    available: async () => installed ? 'available' : 'downloadable',
    install: async () => { installed = true; return true; },
  });
  const events = [];
  const prepared = await prepareLocalSpeech(Recognition, 'en-US', event => events.push(event));
  assert.equal(prepared.status, 'available');
  const options = { langs: ['en-US'], processLocally: true, quality: 'dictation' };
  assert.deepEqual(calls, [['available', options], ['install', options], ['available', options]]);
  assert.deepEqual(events.map(event => event.phase), ['checking', 'downloading', 'ready']);
});

test('unsupported dictation falls back to default capability while keeping local processing', async () => {
  const { Recognition, calls } = mockRecognition({ available: async options => options.quality ? 'unavailable' : 'available' });
  const prepared = await prepareLocalSpeech(Recognition, 'ko-KR');
  assert.equal('quality' in prepared, false);
  assert.deepEqual(calls, [
    ['available', { langs: ['ko-KR'], processLocally: true, quality: 'dictation' }],
    ['available', { langs: ['ko-KR'], processLocally: true }],
  ]);
});

test('unavailable capabilities never trigger install or remote processing', async () => {
  const { Recognition, calls } = mockRecognition({ available: async () => 'unavailable' });
  assert.equal(await prepareLocalSpeech(Recognition, 'ko-KR'), null);
  assert.equal(calls.filter(([method]) => method === 'install').length, 0);
  assert.ok(calls.every(([, options]) => options.processLocally === true && options.langs.length === 1 && options.langs[0] === 'ko-KR'));
});

test('failure to download preferred quality can recover using the default model', async () => {
  const { Recognition, calls } = mockRecognition({
    available: async options => options.quality ? 'downloadable' : 'available',
    install: async () => false,
  });
  const prepared = await prepareLocalSpeech(Recognition, 'en-US');
  assert.ok(prepared);
  assert.equal(prepared.options.quality, undefined);
  assert.equal(calls.filter(([method]) => method === 'install').length, 1);
});

test('English can be ready while Korean is unavailable', async () => {
  const { Recognition, calls } = mockRecognition({ available: async options => options.langs[0] === 'en-US' ? 'available' : 'unavailable' });
  assert.equal(await getLocalSpeechSupport(Recognition, 'ko-KR'), null);
  assert.equal((await getLocalSpeechSupport(Recognition, 'en-US')).status, 'available');
  assert.ok(calls.every(([, options]) => options.langs.length === 1));
});

test('older APIs rejecting the quality member can still use a local default pack', async () => {
  const { Recognition } = mockRecognition({ available: async options => {
    if (options.quality) throw new TypeError('Unknown quality');
    return 'available';
  } });
  const prepared = await getLocalSpeechSupport(Recognition, 'en-US');
  assert.equal(prepared.status, 'available');
  assert.equal(prepared.options.quality, undefined);
});

test('native instances are configured for local, continuous interim recognition', async () => {
  const { Recognition } = mockRecognition({ available: async () => 'available' });
  const prepared = await prepareLocalSpeech(Recognition, 'en-US');
  const recognition = createLocalRecognition(prepared);
  assert.equal(recognition.processLocally, true);
  assert.equal(recognition.lang, 'en-US');
  assert.equal(recognition.quality, 'dictation');
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
});

test('an old recognizer cannot fake local processing through an expando', async () => {
  const { Recognition } = mockRecognition({ available: async () => 'available', localProperty: false });
  const candidate = await getLocalSpeechSupport(Recognition, 'en-US');
  assert.throws(() => createLocalRecognition(candidate), /기기 내 처리/);
  assert.equal(await prepareLocalSpeech(Recognition, 'en-US'), null);
});

test('a hung browser availability call is bounded and returns fallback', async () => {
  const { Recognition } = mockRecognition({ available: () => new Promise(() => {}) });
  const started = Date.now();
  assert.equal(await prepareLocalSpeech(Recognition, 'ko-KR', undefined, { availabilityTimeoutMs: 5 }), null);
  assert.ok(Date.now() - started < 200);
});

test('a hung install is bounded and does not claim readiness', async () => {
  const { Recognition } = mockRecognition({ available: async () => 'downloadable', install: () => new Promise(() => {}) });
  assert.equal(await prepareLocalSpeech(Recognition, 'ko-KR', undefined, { installTimeoutMs: 5 }), null);
});

test('abort propagates rather than being mistaken for unsupported hardware', async () => {
  const { Recognition } = mockRecognition({ available: () => new Promise(() => {}) });
  const controller = new AbortController();
  const result = prepareLocalSpeech(Recognition, 'ko-KR', undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});
