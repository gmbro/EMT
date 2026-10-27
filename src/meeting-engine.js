import { ModelClient } from './models/client.js';
import { MODEL_CATALOG } from './models/catalog.js';
import { prepareLocalSpeech } from './native-speech.mjs';
import { withDeadline } from './deadline.mjs';
import { translateNative } from './native-translation.mjs';
import { translationChunks } from './translation-chunks.mjs';

const opposite = language => language === 'ko-KR' ? 'en-US' : 'ko-KR';

export class MeetingEngine {
  constructor() { this.nativeTranslators = new Map(); this.translationKinds = new Map(); this.translationPreparing = new Map(); this.destroyed = false; }
  get client() { return this.modelClient ||= new ModelClient(); }
  // Recognition must never sit behind a long translation in one worker queue.
  get translationClient() { return this.mtClient ||= new ModelClient(); }
  async prepare(language, { source = 'microphone', portable = false, speechProfile = 'fast', onProgress, onStatus } = {}) {
    this.portable = portable;
    this.speechProfile = speechProfile;
    let speechNotice = '';
    const translation = this.prepareTranslation(language, { onProgress, onStatus });
    const speech = (async () => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.nativeSpeech = !portable && speechProfile !== 'quality' && source === 'microphone'
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
  async translateDraft(text, language, { onText, signal } = {}) {
    const translator = this.nativeTranslators.get(language);
    if (!translator) return null;
    return translateNative(translator, text, { onText, signal, timeoutMs: 4000 });
  }
  async translate(text, language, callbacks = {}) {
    await this.prepareTranslation(language, callbacks);
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
  get canSuggest() { return Boolean(window.LanguageModel?.availability && window.LanguageModel?.create); }
  async suggest(context, mode, callbacks) {
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
    this.modelClient?.destroy();
    this.mtClient?.destroy();
    for (const translator of this.nativeTranslators.values()) translator.destroy?.();
    this.nativeTranslators.clear(); this.translationKinds.clear();
    this.clearReplies();
  }
}
