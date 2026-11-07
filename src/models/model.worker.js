import { env, pipeline, WhisperTextStreamer, TextStreamer } from '@huggingface/transformers';
import { MODEL_CATALOG, MODEL_ASSETS } from './catalog.js';
import { localModelURL, speechConfiguration } from './model-policy.mjs';
import { fetchModelAsset } from './resilient-fetch.mjs';
import { whisperAutoLanguageOptions } from '../speech-language.mjs';

// Models/runtime are same-origin static files. No inference HTTP endpoint exists.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = true;
env.useWasmCache = false;
// Transformers v4's ORT WebGPU backend calls webgpuInit, provided by the
// matching asyncify build. The legacy JSEP module only exposes jsepInit.
// The fast speech path runs on CPU. Load its smaller CPU runtime regardless
// of WebGPU availability; only the optional GPU path needs asyncify.
env.backends.onnx.wasm.wasmPaths = { mjs: '/runtime/ort-wasm-simd-threaded.mjs', wasm: '/runtime/ort-wasm-simd-threaded.wasm' };
// Four-thread initialization stalled in the target embedded browser with both
// runtime builds. The dedicated single-thread worker was verified to start.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
const localFetch = self.fetch.bind(self);
const prefixes = Object.values(MODEL_CATALOG).map(model => `/models/${model.localId}/`);
const assetSizes = new Map(Object.entries(MODEL_CATALOG).flatMap(([key, model]) => MODEL_ASSETS[key].map(asset => [`/models/${model.localId}/${asset.path}`, asset.bytes])));
let requestId;
env.fetch = (input, options = {}) => {
  try {
    const url = localModelURL(input, self.location.origin, prefixes, options.method || input?.method || 'GET');
    const id = requestId;
    return fetchModelAsset(url.href, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer' }, { bytes: assetSizes.get(url.pathname), fetchImpl: localFetch,
      onRetry: retry => self.postMessage({ id, event: 'progress', model: 'speech', progress: { status: 'download-retry', ...retry } }),
    });
  } catch (error) { return Promise.reject(error); }
};

const instances = new Map();
let queue = Promise.resolve();
let speechConfig;
let gpuUnavailable = false;

function progress(id, model, update) {
  self.postMessage({ id, event: 'progress', model, progress: update });
}

async function load(key, task, id, { device = 'wasm', dtype = 'q8' } = {}) {
  const instanceKey = `${key}:${device}`;
  if (!instances.has(instanceKey)) {
    const model = MODEL_CATALOG[key];
    const instance = await pipeline(task, model.localId, {
      dtype, device, local_files_only: true,
      progress_callback: update => progress(id, key, update),
    });
    instances.set(instanceKey, instance);
  }
  return instances.get(instanceKey);
}

async function prepareSpeech(profile, id) {
  let hasGPU = false;
  if (profile === 'quality' && !gpuUnavailable && navigator.gpu?.requestAdapter) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      hasGPU = Boolean(adapter && adapter.limits.maxBufferSize >= 256 * 1024 * 1024);
    } catch { /* A CPU model is still entirely on-device. */ }
  }
  let config = speechConfiguration(profile, hasGPU);
  if (config.device === 'webgpu') env.backends.onnx.wasm.wasmPaths = { mjs: '/runtime/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/runtime/ort-wasm-simd-threaded.asyncify.wasm' };
  if (speechConfig && (speechConfig.key !== config.key || speechConfig.device !== config.device)) {
    await instances.get(`${speechConfig.key}:${speechConfig.device}`)?.dispose();
    instances.delete(`${speechConfig.key}:${speechConfig.device}`);
  }
  try { await load(config.key, 'automatic-speech-recognition', id, config); }
  catch (error) {
    if (config.device !== 'webgpu') throw error;
    gpuUnavailable = true;
    progress(id, config.key, { status: 'backend-fallback', message: 'GPU 모델을 사용할 수 없어 Whisper Small을 CPU로 준비하고 있어요.' });
    config = speechConfiguration(profile, false);
    await load(config.key, 'automatic-speech-recognition', id, config);
  }
  speechConfig = config;
  const model = MODEL_CATALOG[config.key];
  return { model: config.key, label: config.label, notice: config.notice, backend: config.device === 'webgpu' ? 'WebGPU' : 'WASM',
    threads: config.device === 'wasm' ? env.backends.onnx.wasm.numThreads : undefined,
    bytes: model.downloadBytes?.[config.device] || model.bytes };
}

function streaming(id, stage, tokenizer, isSpeech = false) {
  let text = '';
  const Streamer = isSpeech ? WhisperTextStreamer : TextStreamer;
  return new Streamer(tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: piece => {
      text += piece;
      self.postMessage({ id, event: 'update', stage, text: text.trim() });
    },
  });
}

async function handle({ id, action, payload }) {
  requestId = id;
  const started = performance.now();
  if (action === 'prepare-speech') return prepareSpeech(payload.speechProfile || (speechConfig?.profile || 'fast'), id);
  if (action === 'prepare-translation') {
    const key = instances.has('multilingual:wasm') || payload.language === 'en-US' ? 'multilingual' : 'koToEn';
    if (key === 'multilingual' && instances.has('koToEn:wasm')) {
      await instances.get('koToEn:wasm').dispose(); instances.delete('koToEn:wasm');
    }
    await load(key, 'translation', id);
    return { key, label: MODEL_CATALOG[key].label, backend: 'WASM', bytes: MODEL_CATALOG[key].bytes };
  }
  if (action === 'transcribe') {
    const desiredProfile = payload.speechProfile || (speechConfig?.profile || 'fast');
    if (!speechConfig || speechConfig.profile !== desiredProfile) await prepareSpeech(desiredProfile, id);
    let detectedLanguage = payload.language;
    const recognize = async () => {
      const recognizer = await load(speechConfig.key, 'automatic-speech-recognition', id, speechConfig);
      return recognizer(payload.samples, {
        ...(payload.language === 'auto' ? whisperAutoLanguageOptions(recognizer.model.generation_config, language => { detectedLanguage = language; }) : { language: payload.language === 'ko-KR' ? 'korean' : 'english' }),
        task: 'transcribe', return_timestamps: false, max_new_tokens: 192,
        num_beams: 1, do_sample: false,
        streamer: streaming(id, 'transcript', recognizer.tokenizer, true),
      });
    };
    let result;
    try { result = await recognize(); }
    catch (error) {
      if (speechConfig.device !== 'webgpu') throw error;
      // One bounded local retry after device loss. Clearly disclose the CPU
      // model through progress and the result; audio always remains local.
      gpuUnavailable = true;
      progress(id, speechConfig.key, { status: 'backend-fallback', message: 'GPU 연결이 끊겨 Whisper Small을 CPU에서 다시 실행하고 있어요.' });
      try { await instances.get(`${speechConfig.key}:webgpu`)?.dispose(); } catch { /* The GPU may already be lost. */ }
      instances.delete(`${speechConfig.key}:webgpu`); speechConfig = null;
      await prepareSpeech(desiredProfile, id);
      result = await recognize();
    }
    return { text: result.text.trim(), language: detectedLanguage, milliseconds: Math.round(performance.now() - started), backend: speechConfig.device, model: speechConfig.key, label: speechConfig.label, notice: speechConfig.notice };
  }
  if (action === 'translate') {
    const key = instances.has('multilingual:wasm') || payload.language === 'en-US' ? 'multilingual' : 'koToEn';
    const translator = await load(key, 'translation', id);
    const result = await translator(payload.text, {
      ...(key === 'multilingual' ? { src_lang: payload.language === 'ko-KR' ? 'ko' : 'en', tgt_lang: payload.language === 'ko-KR' ? 'en' : 'ko' } : {}),
      max_new_tokens: 256, num_beams: 1, do_sample: false,
      streamer: streaming(id, 'translation', translator.tokenizer),
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
