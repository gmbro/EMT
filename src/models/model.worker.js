import { env, pipeline } from '@huggingface/transformers';
import { MODEL_CATALOG } from './catalog.js';

// Model files and the runtime are static assets on this website. Inference never
// has an HTTP endpoint, and this worker cannot fetch user-supplied URLs.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = true;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = { mjs: '/runtime/ort-wasm-simd-threaded.jsep.mjs', wasm: '/runtime/ort-wasm-simd-threaded.jsep.wasm' };
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
env.backends.onnx.wasm.proxy = false;
const localFetch = self.fetch.bind(self);
const prefixes = Object.values(MODEL_CATALOG).map(model => `/models/${model.localId}/`);
env.fetch = (input, options = {}) => {
  const url = new URL(input, self.location.origin);
  if (url.origin !== self.location.origin || url.search || !prefixes.some(prefix => url.pathname.startsWith(prefix)) || !['GET', 'HEAD'].includes(options.method || 'GET')) {
    return Promise.reject(new Error('Only static local model files may be requested.'));
  }
  return localFetch(url.href, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer' });
};

const instances = new Map();
let queue = Promise.resolve();

async function load(key, task, id) {
  if (!instances.has(key)) {
    const model = MODEL_CATALOG[key];
    const instance = await pipeline(task, model.localId, {
      dtype: 'q8', device: 'wasm', local_files_only: true,
      progress_callback: progress => self.postMessage({ id, event: 'progress', model: key, progress }),
    });
    instances.set(key, instance);
  }
  return instances.get(key);
}

async function handle({ id, action, payload }) {
  const started = performance.now();
  if (action === 'prepare-speech') {
    await load('speech', 'automatic-speech-recognition', id);
    return { backend: 'WASM', threads: env.backends.onnx.wasm.numThreads };
  }
  if (action === 'prepare-translation') {
    const key = instances.has('multilingual') || payload.language === 'en-US' ? 'multilingual' : 'koToEn';
    if (key === 'multilingual' && instances.has('koToEn')) {
      await instances.get('koToEn').dispose(); instances.delete('koToEn');
    }
    await load(key, 'translation', id);
    return { key, bytes: MODEL_CATALOG[key].bytes };
  }
  if (action === 'transcribe') {
    const recognizer = await load('speech', 'automatic-speech-recognition', id);
    const result = await recognizer(payload.samples, {
      language: payload.language === 'ko-KR' ? 'korean' : 'english',
      task: 'transcribe', return_timestamps: false, max_new_tokens: 128,
      num_beams: 1, do_sample: false,
    });
    return { text: result.text.trim(), milliseconds: Math.round(performance.now() - started) };
  }
  if (action === 'translate') {
    const key = instances.has('multilingual') || payload.language === 'en-US' ? 'multilingual' : 'koToEn';
    const translator = await load(key, 'translation', id);
    const result = await translator(payload.text, {
      ...(key === 'multilingual' ? { src_lang: payload.language === 'ko-KR' ? 'ko' : 'en', tgt_lang: payload.language === 'ko-KR' ? 'en' : 'ko' } : {}),
      max_new_tokens: 192, num_beams: 1, do_sample: false,
    });
    return { text: result[0].translation_text.trim(), milliseconds: Math.round(performance.now() - started) };
  }
  throw new Error('Unknown local model operation.');
}

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { self.postMessage({ id: data.id, event: 'result', value: await handle(data) }); }
    catch (error) { self.postMessage({ id: data.id, event: 'error', message: error.message || '기기 모델 실행에 실패했어요.' }); }
  });
};
