import {LOCAL_QWEN} from './qwen-live.mjs';
import {sentenceChunks} from './preview-policy.mjs';
import { validateReplyOptions, clarificationFallback } from './reply-options.mjs';
import { ModelClient } from './models/client.js';
import { MODEL_CATALOG } from './models/catalog.js';
import { prepareLocalSpeech } from './native-speech.mjs';
import { withDeadline } from './deadline.mjs';
import { translateNative } from './native-translation.mjs';
import { translationChunks } from './translation-chunks.mjs';
import { prepareCloudTranslation, translateCloud } from './cloud-translation.mjs';

const opposite = language => language === 'ko-KR' ? 'en-US' : 'ko-KR';

export class MeetingEngine {
  constructor({ translationMode = 'cloud' } = {}) { this.translationMode = translationMode; this.resultCache = new Map(); this.cacheEpoch = 0; this.controller = new AbortController(); this.nativeTranslators = new Map(); this.translationKinds = new Map(); this.translationPreparing = new Map(); this.destroyed = false; }
  get canDraftTranslate() { return this.translationMode === 'cloud' || this.nativeTranslators.size > 0; }
  get cloudSpeech() { return this.translationMode === 'cloud'; }
  get client() { return this.modelClient ||= new ModelClient(); }
  // Recognition must never sit behind a long translation in one worker queue.
  get translationClient() { return this.mtClient ||= new ModelClient(); }
  async prepare(language, { speechProvider='google', source = 'microphone', portable = false, speechProfile = 'fast', translationEnabled = true, onProgress, onStatus } = {}) {
    if (this.cloudSpeech) {
      const translation = translationEnabled ? await this.prepareTranslation(language, { onProgress, onStatus }) : '받아쓰기 전용';
      this.language = language;
      return { speech: LOCAL_QWEN ? 'Qwen3-ASR 1.7B · 이 컴퓨터' : speechProvider==='deepgram' ? 'Deepgram Nova-3 · 자동 화자 분리' : 'Google Gemini Live Transcribe', translation, cloudSpeech: true, notice: '' };
    }
    this.portable = portable;
    this.speechProfile = speechProfile;
    let speechNotice = '';
    const translation = this.prepareTranslation(language, { onProgress, onStatus });
    const speech = (async () => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.nativeSpeech = language !== 'auto' && !portable && speechProfile !== 'quality' && source === 'microphone'
        ? await prepareLocalSpeech(Recognition, language, state => onStatus?.(state.message), { availabilityTimeoutMs: 2500, installTimeoutMs: 8000 }) : null;
      if (this.nativeSpeech) return '브라우저 로컬 음성';
      onStatus?.('한국어·영어 공용 음성 모델을 기기에 준비하고 있어요.');
      const details = await this.client.request('prepare-speech', { speechProfile }, onProgress);
      speechNotice = details.notice || '';
      return `${details.label || (speechProfile === 'quality' ? 'Whisper Small' : 'Whisper Base')} · ${details.backend}`;
    })();
    const [speechName, translationName] = await Promise.all([speech, translation]);
    this.language = language;
    return { speech: speechName, translation: translationName, nativeSpeech: this.nativeSpeech, notice: speechNotice };
  }
  async prepareTranslation(language, { onProgress, onStatus } = {}) {
    if (this.translationKinds.has(language)) return this.translationKinds.get(language);
    if (this.translationPreparing.has(language)) return this.translationPreparing.get(language);
    const pending = this.createTranslation(language, { onProgress, onStatus });
    this.translationPreparing.set(language, pending);
    try { return await pending; }
    finally { this.translationPreparing.delete(language); }
  }
  async createTranslation(language, { onProgress, onStatus } = {}) {
    if (this.translationMode === 'cloud') {
      onStatus?.('Google Gemini 번역 연결을 확인하고 있어요. 번역 모델 다운로드는 필요 없어요.');
      this.cloudReady ||= withDeadline(() => prepareCloudTranslation({ signal: this.controller.signal }), 12000, '번역 서버 연결이 늦어지고 있어요. 네트워크를 확인하고 다시 준비해 주세요.');
      let details;
      try { details = await this.cloudReady; } catch (error) { this.cloudReady = null; throw error; }
      if (this.destroyed) throw new Error('통역 준비가 취소됐어요.');
      this.translationKinds.set(language, `Google Gemini · ${details.model}`);
      return this.translationKinds.get(language);
    }
    const sourceLanguage = language === 'ko-KR' ? 'ko' : 'en';
    const targetLanguage = language === 'ko-KR' ? 'en' : 'ko';
    if (!this.portable && window.Translator?.availability && window.Translator?.create) {
      try {
        const options = { sourceLanguage, targetLanguage };
        const status = await withDeadline(() => window.Translator.availability(options), 4000, '브라우저 번역 지원 확인 시간이 초과됐어요.');
        if (status !== 'unavailable') {
          onStatus?.('브라우저 로컬 번역 모델을 준비하고 있어요.');
          const translator = await withDeadline(() => window.Translator.create({ ...options, monitor(monitor) {
            monitor.addEventListener('downloadprogress', event => onProgress?.({ model: 'native', progress: { status: 'progress', progress: event.loaded * 100 } }));
          } }), 20000, '브라우저 번역 모델을 준비하지 못했어요.', translator => translator.destroy?.());
          if (this.destroyed) { translator.destroy?.(); throw new Error('통역 준비가 취소됐어요.'); }
          this.nativeTranslators.set(language, translator);
          this.translationKinds.set(language, '브라우저 기기 내 번역');
          return '브라우저 기기 내 번역';
        }
      } catch { /* Use the same-origin local model when the native API cannot start. */ }
    }
    if (this.destroyed) throw new Error('통역 준비가 취소됐어요.');
    const model = language === 'ko-KR' ? MODEL_CATALOG.koToEn : MODEL_CATALOG.multilingual;
    onStatus?.(`${model.label} 모델을 준비하고 있어요. 처음에는 약 ${Math.ceil(model.bytes / 1e6)}MB를 내려받습니다.`);
    const details = await this.translationClient.request('prepare-translation', { language }, onProgress);
    const name = `${details.label || model.label} · 기기 내 번역`;
    this.translationKinds.set(language, name);
    return name;
  }
  async transcribe(samples, language, { onText } = {}) {
    return this.client.request('transcribe', { samples, language, speechProfile: this.speechProfile }, undefined, update => onText?.(update.text));
  }
  clearCloudCache() { this.cacheEpoch++; this.resultCache.clear(); }
  async cloudChunk(text, language, options = {}) {
    const key = JSON.stringify([text,language,options.context||'',options.glossary||'',options.task||'translate']);
    const cached=this.resultCache.get(key), epoch=this.cacheEpoch;
    if(options.signal?.aborted)throw Object.assign(new Error('취소됨'),{name:'AbortError'});
    if(cached){options.onText?.(cached.text);return {...cached,reused:true};}
    const result=await translateCloud(text,language,options);
    if(epoch===this.cacheEpoch){this.resultCache.set(key,result);if(this.resultCache.size>160)this.resultCache.delete(this.resultCache.keys().next().value);}
    return result;
  }
  async translateDraft(text, language, { onText, signal, context, glossary } = {}) {
    if (this.translationMode === 'cloud') {
      const result=await this.cloudChunk(text,language,{onText,signal,context,glossary,draft:true,timeoutMs:6000});
      return result.text;
    }
    const translator = this.nativeTranslators.get(language);
    if (!translator) return null;
    return translateNative(translator, text, { onText, signal, timeoutMs: 4000 });
  }
  async translate(text, language, callbacks = {}) {
    await this.prepareTranslation(language, callbacks);
    if (this.translationMode === 'cloud') {
      const started = performance.now(), completed = [];
      let details;
      const sentences=sentenceChunks(text).flatMap(part=>translationChunks(part,1200));
      const reusable=sentences.some(part=>this.resultCache.has(JSON.stringify([part,language,callbacks.context||'',callbacks.glossary||'',callbacks.task||'translate'])));
      // Split finals only when that actually reuses an existing preview.
      // Otherwise one request is cheaper and retains whole-message context.
      for (const chunk of reusable?sentences:translationChunks(text,1200)) {
        if (!chunk.trim()) continue;
        details = await this.cloudChunk(chunk, language, { ...callbacks, signal: callbacks.signal || this.controller.signal,
          onText: draft => callbacks.onText?.([...completed, draft].join('\n')) });
        completed.push(details.text);
      }
      return { ...details, text: completed.join('\n'), milliseconds: Math.round(performance.now() - started) };
    }
    const native = this.nativeTranslators.get(language);
    const started = performance.now();
    const completed = [];
    for (const chunk of translationChunks(text, native ? 1200 : 350)) {
      if (!chunk.trim()) continue;
      const onText = draft => callbacks.onText?.([...completed, draft].join('\n'));
      const output = native
        ? await translateNative(native, chunk, { ...callbacks, onText })
        : (await this.translationClient.request('translate', { text: chunk, language }, callbacks.onProgress, update => onText(update.text))).text;
      if (!output?.trim()) throw new Error('번역 결과가 비어 있어요. 문장의 다시 번역을 눌러주세요.');
      completed.push(output.trim());
    }
    return { text: completed.join('\n'), milliseconds: Math.round(performance.now() - started) };
  }
  get canSuggest() { return this.translationMode === 'cloud' || Boolean(window.LanguageModel?.availability && window.LanguageModel?.create); }
  async suggest(context, mode, callbacks) {
    if (this.translationMode === 'cloud') {
      const result = await translateCloud((callbacks?.sourceEnglish || context).slice(-1800), 'en-US', { context: context.slice(-3000), glossary: callbacks?.glossary || '', signal: callbacks?.signal || this.controller.signal, task: 'replies', replyCount:callbacks?.replyCount || 1, retries:0 });
      const parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      const replies = parsed.replies?.filter(item => typeof item.ko === 'string' && typeof item.en === 'string' && item.ko.trim() && item.en.trim()).slice(0, callbacks?.replyCount || 1);
      if (replies?.length !== (callbacks?.replyCount || 1)) throw new Error('답변 가이드를 만들지 못했어요. 다시 준비해 주세요.');
      const safe=replies.filter(reply=>{try{validateReplyOptions([reply]);return true;}catch{return false;}});
      return safe.length?safe:[clarificationFallback(callbacks?.sourceEnglish||context)];
    }
    if (!this.canSuggest) throw new Error('이 브라우저는 자동 답변 제안을 지원하지 않아요. 아래에 한국어 답변을 쓰면 영어로 바꿀 수 있어요.');
    if (!this.replySession) {
      const options = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
      if (await withDeadline(() => window.LanguageModel.availability(options), 4000, '답변 모델 지원 확인 시간이 초과됐어요.') === 'unavailable') throw new Error('이 기기는 자동 답변 모델을 지원하지 않아요. 통역은 계속 사용할 수 있어요.');
      this.replySession = await withDeadline(() => window.LanguageModel.create(options), 30000, '답변 모델을 준비하지 못했어요. 통역은 계속 사용할 수 있어요.', session => session.destroy?.());
    }
    const english = this.language === 'en-US' ? context : (await this.translate(context, 'ko-KR', callbacks)).text;
    const tones = { '비즈니스': 'business meeting', '일상 대화': 'casual conversation', '면접': 'job interview', '여행': 'travel conversation' };
    const result = await withDeadline(() => this.replySession.prompt(`Suggest exactly two short English replies for this ${tones[mode] || 'meeting'} transcript. Do not invent commitments or facts. Return JSON only as {"replies":["...","..."]}. Transcript: ${english.slice(-1800)}`, {
      responseConstraint: { type: 'object', properties: { replies: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } }, required: ['replies'] },
    }), 30000, '답변 생성이 늦어져 중단했어요. 통역은 계속 사용할 수 있어요.').catch(error => { this.clearReplies(); throw error; });
    const parsed = JSON.parse(result);
    const replies = [];
    for (const en of (parsed.replies || []).filter(item => typeof item === 'string').slice(0, 2)) {
      const ko = (await this.translate(en, opposite('ko-KR'), callbacks)).text;
      replies.push({ en, ko });
    }
    return replies;
  }
  clearReplies() { this.replySession?.destroy?.(); this.replySession = null; }
  destroy() {
    this.destroyed = true;
    this.controller.abort();
    this.modelClient?.destroy();
    this.mtClient?.destroy();
    for (const translator of this.nativeTranslators.values()) translator.destroy?.();
    this.nativeTranslators.clear(); this.translationKinds.clear();
    this.clearReplies();
  }
}
