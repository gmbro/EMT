import { useEffect, useRef, useState } from 'react';
import { MeetingEngine } from './meeting-engine.js';
import { createLocalRecognition } from './native-speech.mjs';
import { createAudioCapture } from './audio/capture.js';
import { MODEL_CATALOG } from './models/catalog.js';
import { withDeadline } from './deadline.mjs';
import { createLatestTaskRunner, mutateCaptionHistory } from './captions.mjs';

export function useMeeting() {
  const [language, setLanguage] = useState('en-US');
  const [source, setSource] = useState('microphone');
  const [portable, setPortable] = useState(false);
  const [speechProfile, setSpeechProfile] = useState('fast');
  const [preparing, setPreparing] = useState(false);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('처음 한 번 통역 모델을 준비해 주세요.');
  const [progress, setProgress] = useState(null);
  const [modelNames, setModelNames] = useState(null);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState('');
  const [partial, setPartial] = useState('');
  const [draftSample, setDraftSample] = useState(false);
  const [history, setHistory] = useState({ records: [], characterCount: 0, historyTrimmed: 0 });
  const [pending, setPending] = useState(0);
  const [speechPending, setSpeechPending] = useState(0);
  const [translationPending, setTranslationPending] = useState(0);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replies, setReplies] = useState([]);
  const [replyError, setReplyError] = useState('');
  const engine = useRef(null), capture = useRef(null), recognition = useRef(null);
  const startToken = useRef(0), epoch = useRef(0);
  const alive = useRef(true), active = useRef(false), preparingRef = useRef(false);
  const speechQueue = useRef(Promise.resolve()), translationQueue = useRef(Promise.resolve());
  const speechJobs = useRef(new Set()), translationJobs = useRef(new Set());
  const historyRef = useRef(history), readyRef = useRef(ready);
  historyRef.current = history; readyRef.current = ready;
  const progressFiles = useRef(new Map());
  const draftKey = useRef(null), partialRunner = useRef(null), partialAbort = useRef(null);
  const previewBusy = useRef(false), latestPreview = useRef(null), finalizedSegments = useRef(new Set());
  const samplePreviewToken = useRef(null);
  const stopRef = useRef(null), stopTask = useRef(null), clearing = useRef(false);

  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setElapsed(seconds => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [listening]);
  useEffect(() => () => {
    alive.current = false; epoch.current++; startToken.current++;
    partialRunner.current?.dispose(); partialAbort.current?.abort();
    recognition.current?.abort(); capture.current?.stop({ flush: false }); engine.current?.destroy();
  }, []);

  const mutateHistory = update => {
    if (!alive.current) return;
    setHistory(previous => {
      const next = mutateCaptionHistory(previous, update);
      historyRef.current = next;
      return next;
    });
  };
  function appendRecord(record) { mutateHistory(records => [...records, record].sort((a, b) => a.startedAt - b.startedAt)); }
  function updateRecord(id, update) { mutateHistory(records => records.map(record => record.id === id ? { ...record, ...update } : record)); }
  function syncPending() {
    if (!alive.current) return;
    setSpeechPending(speechJobs.current.size); setTranslationPending(translationJobs.current.size);
    setPending(speechJobs.current.size + translationJobs.current.size);
  }
  const isBusy = () => speechJobs.current.size > 0 || translationJobs.current.size > 0;
  const onProgress = ({ model, progress: update }) => {
    if (!alive.current) return;
    if (model === 'native') { setProgress(Math.min(99, Math.round(update.progress))); return; }
    if (update.status === 'progress' && update.total) {
      progressFiles.current.set(`${model}:${update.file}`, { loaded: update.loaded, total: update.total });
      const files = [...progressFiles.current.values()];
      setProgress(Math.min(99, Math.round(100 * files.reduce((n, file) => n + file.loaded, 0) / files.reduce((n, file) => n + file.total, 0))));
    }
    if (update.status === 'initiate') setPhase(`${MODEL_CATALOG[model]?.label || '기기'} 모델을 불러오고 있어요.`);
    if (update.status === 'ready') setPhase('모델을 메모리에 올리고 있어요. 잠시만 기다려 주세요.');
  };
  const callbacks = { onProgress, onStatus: message => alive.current && setPhase(message) };

  async function prepareFor(inputLanguage) {
    if (preparingRef.current || active.current || isBusy() || clearing.current || stopTask.current) return;
    const session = epoch.current;
    preparingRef.current = true;
    setError(''); setPreparing(true); setReady(false); setProgress(null); progressFiles.current.clear();
    try {
      if (!window.isSecureContext || !window.Worker || !window.WebAssembly) throw new Error('HTTPS와 WebAssembly를 지원하는 최신 브라우저에서 열어주세요.');
      engine.current ||= new MeetingEngine();
      const currentEngine = engine.current;
      const names = await currentEngine.prepare(inputLanguage, { source, portable, speechProfile, ...callbacks });
      if (!alive.current || session !== epoch.current || engine.current !== currentEngine) return;
      setModelNames(names); setReady(true); setProgress(100);
      setPhase('통역 준비 완료 · 마이크를 눌러 시작하세요.');
    } catch (failure) {
      if (!alive.current || session !== epoch.current) return;
      setError(`모델을 준비하지 못했어요. ${failure.message}`);
      engine.current?.destroy(); engine.current = null;
    } finally { preparingRef.current = false; if (alive.current) setPreparing(false); }
  }
  async function prepare() { return prepareFor(language); }

  function resetDraft() {
    draftKey.current = null; latestPreview.current = null;
    partialRunner.current?.invalidate(); partialAbort.current?.abort();
    if (alive.current) { setInterim(''); setPartial(''); setDraftSample(false); }
  }
  function translateDraft(text, inputLanguage, key) {
    if (!text.trim() || !engine.current?.nativeTranslators.has(inputLanguage)) return;
    if (!partialRunner.current) {
      partialRunner.current = createLatestTaskRunner({
        canRun: () => translationJobs.current.size === 0,
        run: async (task, emit) => {
          if (task.session !== epoch.current || task.key !== draftKey.current) return;
          const controller = new AbortController(); partialAbort.current = controller;
          try {
            return await task.engine.translateDraft(task.text, task.language, { signal: controller.signal, onText: emit });
          } finally { if (partialAbort.current === controller) partialAbort.current = null; }
        },
        publish: (text, task) => {
          if (typeof text === 'string' && alive.current && task.session === epoch.current && task.key === draftKey.current) setPartial(text);
        },
      });
    }
    partialRunner.current.submit({ text, language: inputLanguage, key, session: epoch.current, engine: engine.current });
  }
  function publishDraft(text, inputLanguage, key, sample = false) {
    if (draftKey.current !== key) { partialRunner.current?.invalidate(); partialAbort.current?.abort(); setPartial(''); }
    draftKey.current = key; setInterim(text); setDraftSample(sample);
    translateDraft(text, inputLanguage, key);
  }

  async function stop({ flush = true } = {}) {
    active.current = false; startToken.current++; samplePreviewToken.current = null;
    setListening(false); setStarting(false); setLevel(0); resetDraft();
    if (stopTask.current) {
      if (!flush) recognition.current?.abort();
      return stopTask.current;
    }
    setStopping(true);
    const task = (async () => {
      const rec = recognition.current;
      if (rec && flush) {
        await new Promise(resolve => {
          let timeout;
          const finish = () => { clearTimeout(timeout); if (recognition.current === rec) recognition.current = null; resolve(); };
          rec.onend = finish;
          timeout = setTimeout(() => { rec.abort(); finish(); }, 1500);
          try { rec.stop(); } catch { finish(); }
        });
      } else { recognition.current = null; rec?.abort(); }
      const current = capture.current; capture.current = null;
      await current?.stop({ flush });
    })();
    stopTask.current = task;
    try { await task; }
    finally { if (stopTask.current === task) stopTask.current = null; if (alive.current) setStopping(false); }
  }
  stopRef.current = stop;

  function updateSpeechDetails(result, currentEngine) {
    // A sample may use Whisper while the next live microphone session will
    // still use native recognition. Do not mislabel that native session.
    if (engine.current !== currentEngine || currentEngine.nativeSpeech || !result.label || !result.backend) return;
    setModelNames(previous => previous && { ...previous, speech: `${result.label} · ${result.backend}`, notice: result.notice || '' });
  }

  function handleFailure(failure, currentEngine) {
    if (!alive.current) return;
    setError(failure.localModelFatal
      ? '기기 모델이 중단됐어요. 표시된 원문은 유지됩니다. 통역을 다시 준비한 뒤 실패한 문장을 재시도해 주세요.'
      : `통역 중 오류가 발생했어요. ${failure.message}`);
    if (failure.localModelFatal && currentEngine && engine.current === currentEngine) {
      setReady(false); void stopRef.current?.({ flush: false });
      currentEngine.destroy(); engine.current = null;
    }
  }

  function queueTranslation(record, currentEngine = engine.current, session = epoch.current) {
    const job = record.id;
    if (translationJobs.current.has(job)) return translationQueue.current;
    translationJobs.current.add(job); syncPending();
    const queuedAt = performance.now();
    translationQueue.current = translationQueue.current.then(async () => {
      if (session !== epoch.current || !alive.current) return;
      updateRecord(record.id, { status: 'translating', error: '' });
      const started = performance.now();
      try {
        const result = await currentEngine.translate(record.original, record.language, { ...callbacks,
          onText: text => { if (session === epoch.current && typeof text === 'string') updateRecord(record.id, { translation: text }); },
        });
        if (session !== epoch.current || !alive.current) return;
        if (!result.text?.trim()) throw new Error('번역 결과가 비어 있어요. 이 문장을 다시 번역해 주세요.');
        const milliseconds = Math.round(performance.now() - (record.startedAt || started));
        updateRecord(record.id, { translation: result.text, status: 'complete', error: '', milliseconds,
          translationMilliseconds: Math.round(performance.now() - started), waitMilliseconds: Math.round(performance.now() - queuedAt) });
        setPhase(`최근 문장 처리 ${(milliseconds / 1000).toFixed(1)}초 · ${record.sample ? '예제 음성' : '기기 내 통역'}`);
      } catch (failure) {
        if (session !== epoch.current || !alive.current) return;
        updateRecord(record.id, { status: 'error', error: failure.message });
        handleFailure(failure, currentEngine);
      }
    }).finally(() => { translationJobs.current.delete(job); syncPending(); });
    return translationQueue.current;
  }

  function enqueue({ samples, text, duration = 0, sample = false, segmentKey, input = 'voice' }, inputLanguage = language) {
    const session = epoch.current, currentEngine = engine.current;
    const record = { id: crypto.randomUUID(), original: text?.trim() || '', translation: '', language: inputLanguage,
      duration, sample, input, status: 'translating', error: '', startedAt: performance.now() };
    if (segmentKey) {
      finalizedSegments.current.add(segmentKey);
      if (finalizedSegments.current.size > 100) finalizedSegments.current.delete(finalizedSegments.current.values().next().value);
      if (draftKey.current === segmentKey) resetDraft();
    }
    // A final native transcript is visible before waiting for any translation.
    if (record.original) {
      appendRecord(record); queueTranslation(record, currentEngine, session);
    } else if (samples) {
      const job = record.id; speechJobs.current.add(job); syncPending();
      speechQueue.current = speechQueue.current.then(async () => {
        if (session !== epoch.current || !alive.current) return;
        let inserted = false;
        const showOriginal = text => {
          if (session !== epoch.current || !alive.current || !text?.trim()) return;
          record.original = text.trim();
          if (!inserted) { appendRecord({ ...record, status: 'recognizing' }); inserted = true; }
          else updateRecord(record.id, { original: record.original });
        };
        try {
          const result = await currentEngine.transcribe(samples, inputLanguage, { onText: showOriginal });
          if (session !== epoch.current || !alive.current) return;
          updateSpeechDetails(result, currentEngine);
          if (!result.text?.trim()) {
            if (inserted) mutateHistory(records => records.filter(item => item.id !== record.id));
            return;
          }
          showOriginal(result.text);
          updateRecord(record.id, { status: 'translating' });
          queueTranslation(record, currentEngine, session);
        } catch (failure) {
          if (session !== epoch.current || !alive.current) return;
          if (inserted) updateRecord(record.id, { status: 'error', error: `음성 인식을 완료하지 못했어요. ${failure.message}` });
          handleFailure(failure, currentEngine);
        }
      }).finally(() => { speechJobs.current.delete(job); syncPending(); void drainPreview(); });
    }
    if ((speechJobs.current.size >= 4 || translationJobs.current.size >= 12) && active.current) {
      setError('통역할 문장이 밀려 잠시 듣기를 멈췄어요. 원문과 번역을 순서대로 마무리하고 있습니다. 처리 후 다시 시작해 주세요.');
      void stopRef.current?.();
    }
    return speechQueue.current;
  }

  function receiveNative(event, inputLanguage, key) {
    let finalText = '', liveText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += `${event.results[i][0].transcript} `;
      else liveText += event.results[i][0].transcript;
    }
    if (finalText.trim()) { resetDraft(); enqueue({ text: finalText }, inputLanguage); }
    if (liveText) publishDraft(liveText, inputLanguage, key);
    else if (draftKey.current === key) resetDraft();
  }

  function previewAllowed(task) {
    return alive.current && task.session === epoch.current && !finalizedSegments.current.has(task.key)
      && (task.sampleToken !== null ? task.sampleToken === startToken.current && samplePreviewToken.current === task.sampleToken : active.current);
  }
  function receivePreview(segment, inputLanguage, key, sampleToken = null) {
    const task = { ...segment, language: inputLanguage, key, session: epoch.current, engine: engine.current, sampleToken };
    if (!previewAllowed(task)) return;
    latestPreview.current = task;
    void drainPreview();
  }
  async function drainPreview() {
    if (previewBusy.current || speechJobs.current.size || !alive.current) return;
    const task = latestPreview.current; latestPreview.current = null;
    if (!task || !previewAllowed(task)) return;
    previewBusy.current = true;
    const publish = text => {
      if (previewAllowed(task) && text?.trim()) publishDraft(text.trim(), task.language, task.key, task.sampleToken !== null);
    };
    try {
      const result = await task.engine.transcribe(task.samples, task.language, { onText: publish });
      if (previewAllowed(task)) updateSpeechDetails(result, task.engine);
      publish(result.text);
    }
    catch (failure) { if (failure.localModelFatal && task.session === epoch.current) handleFailure(failure, task.engine); }
    finally { previewBusy.current = false; if (latestPreview.current) void drainPreview(); }
  }

  async function start() {
    if (!ready || starting || stopping || stopTask.current || clearing.current || replyBusy || active.current || isBusy()) return;
    const token = ++startToken.current, session = epoch.current;
    setStarting(true); setError(''); setElapsed(0); resetDraft();
    try {
      if (engine.current.nativeSpeech && source === 'microphone') {
        const rec = createLocalRecognition(engine.current.nativeSpeech);
        recognition.current = rec;
        rec.onresult = event => { if (recognition.current === rec && session === epoch.current) receiveNative(event, language, `native-${token}`); };
        rec.onend = () => {
          if (recognition.current !== rec || !active.current) return;
          try { rec.start(); } catch { setError('음성 인식을 다시 시작하지 못했어요. 듣기를 다시 눌러주세요.'); void stop(); }
        };
        rec.onerror = event => {
          if (recognition.current !== rec || event.error === 'no-speech' || event.error === 'aborted') return;
          setError(event.error === 'not-allowed' ? '사이트의 마이크 권한을 허용한 뒤 다시 눌러주세요.' : `브라우저 로컬 음성 인식을 시작하지 못했어요 (${event.error}). 설정에서 ‘호환 모델 사용’을 켜고 다시 준비해 주세요.`);
          void stop();
        };
        active.current = true; rec.start(); setListening(true);
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 마이크 입력을 지원하지 않아요.');
        const stream = source === 'meeting-tab'
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (token !== startToken.current) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error('회의 탭과 ‘탭 오디오 공유’를 함께 선택해 주세요.'); }
        active.current = true;
        const recorder = await createAudioCapture(stream, { maxSeconds: 6, silenceMs: 650,
          onSegment: segment => { if (session === epoch.current) enqueue({ ...segment, segmentKey: `${token}:${segment.segmentId}` }, language); },
          onPreview: segment => { if (session === epoch.current) receivePreview(segment, language, `${token}:${segment.segmentId}`); }, onLevel: setLevel,
          onError: failure => { setError(failure.message); void stopRef.current?.(); }, onEnded: () => void stopRef.current?.() });
        if (token !== startToken.current) { await recorder.stop({ flush: false }); return; }
        capture.current = recorder; setListening(true);
      }
    } catch (failure) {
      if (token !== startToken.current) return;
      active.current = false; setListening(false);
      setError(failure.name === 'NotAllowedError' ? '마이크 또는 탭 오디오 권한을 허용한 뒤 다시 눌러주세요.' : failure.message);
    } finally { if (token === startToken.current) setStarting(false); }
  }

  async function testSample() {
    if (!ready || active.current || starting || stopTask.current || clearing.current || isBusy()) return;
    const session = epoch.current, token = ++startToken.current;
    setError(''); setStarting(true); samplePreviewToken.current = token;
    let context, sampleCapture;
    try {
      setPhase('예제 음성으로 기기 내 통역을 확인하고 있어요.');
      await engine.current.client.request('prepare-speech', { speechProfile }, onProgress);
      const response = await fetch(`/samples/${language === 'ko-KR' ? 'ko' : 'en'}.wav`, { credentials: 'omit' });
      if (!response.ok) throw new Error('예제 음성을 불러오지 못했어요.');
      context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const audio = await context.decodeAudioData(await response.arrayBuffer());
      if (session !== epoch.current || token !== startToken.current) return;
      const fixture = context.createBuffer(1, audio.length + 24000, 16000);
      fixture.copyToChannel(audio.getChannelData(0), 0, 8000);
      sampleCapture = await createAudioCapture(null, { audioBuffer: fixture,
        onPreview: segment => receivePreview(segment, language, `${token}:${segment.segmentId}`, token), onSegment: segment => {
        if (session === epoch.current && token === startToken.current) enqueue({ ...segment, sample: true, segmentKey: `${token}:${segment.segmentId}` });
      }, onError: failure => { if (session === epoch.current) setError(failure.message); } });
      if (session !== epoch.current || token !== startToken.current) return;
      capture.current = sampleCapture;
      await withDeadline(() => sampleCapture.ended, 15000, '예제 음성 입력을 시작하지 못했어요. 버튼을 다시 눌러주세요.');
      await sampleCapture.stop(); capture.current = null;
      await speechQueue.current; await translationQueue.current;
    } catch (failure) { if (token === startToken.current && session === epoch.current) setError(failure.message); }
    finally {
      await sampleCapture?.stop({ flush: false });
      if (capture.current === sampleCapture) capture.current = null;
      await context?.close();
      if (samplePreviewToken.current === token) samplePreviewToken.current = null;
      if (token === startToken.current) setStarting(false);
    }
  }

  function changeLanguage(value) {
    if (!['en-US', 'ko-KR'].includes(value) || value === language || active.current || preparingRef.current || isBusy() || starting || stopping || replyBusy) return;
    setLanguage(value); setError(''); resetDraft(); setReplies([]);
    // The engine retains already prepared language pairs. Switching direction
    // only prepares the missing pair; it does not redownload the other one.
    if (readyRef.current) { setReady(false); void prepareFor(value); }
  }
  function changeSource(value) { if (active.current || preparingRef.current || isBusy() || starting || stopping) return; setSource(value); setReady(false); setError(''); }
  function changePortable(value) {
    if (active.current || preparingRef.current || isBusy() || starting || stopping) return;
    setPortable(value); setReady(false); engine.current?.destroy(); engine.current = null;
  }
  function changeSpeechProfile(value) {
    if (!['fast', 'quality'].includes(value) || active.current || preparingRef.current || isBusy() || starting || stopping) return;
    setSpeechProfile(value); setReady(false); setError(''); engine.current?.destroy(); engine.current = null;
  }
  async function clear() {
    if (clearing.current) return;
    clearing.current = true; epoch.current++; resetDraft();
    speechJobs.current.clear(); translationJobs.current.clear(); syncPending();
    try {
      await stop({ flush: false });
      if (!alive.current) return;
      const empty = { records: [], characterCount: 0, historyTrimmed: 0 };
      setHistory(empty); historyRef.current = empty;
      setReplies([]); setError(''); setElapsed(0); setReplyError('');
      engine.current?.clearReplies();
    } finally { clearing.current = false; }
  }
  function submitText(text) {
    if (!ready || preparingRef.current || clearing.current || stopTask.current || !text.trim() || text.length > 10000) return false;
    enqueue({ text, input: 'text' }, language); return true;
  }
  function retryRecord(id) {
    if (!ready || preparingRef.current || clearing.current || stopTask.current) return;
    const record = historyRef.current.records.find(record => record.id === id);
    if (!record || record.status !== 'error' || !record.original.trim()) return;
    updateRecord(id, { status: 'translating', error: '', translation: '' });
    return queueTranslation({ ...record, startedAt: performance.now() });
  }
  async function composeReply(text) {
    if (!ready || !text.trim() || replyBusy || active.current || isBusy()) return;
    const session = epoch.current; setReplyBusy(true); setReplyError('');
    try {
      const result = await engine.current.translate(text.trim(), 'ko-KR', callbacks);
      if (session === epoch.current) setReplies([{ en: result.text, ko: text.trim() }]);
    } catch (failure) { if (session === epoch.current) { setReplyError(failure.message); if (failure.localModelFatal) handleFailure(failure, engine.current); } }
    finally { setReplyBusy(false); }
  }
  async function suggestReplies(mode) {
    if (!ready || replyBusy || active.current || isBusy() || !history.records.length) return;
    const session = epoch.current; setReplyBusy(true); setReplyError('');
    try {
      const context = history.records.filter(record => record.language === language).slice(-8).map(record => record.original).join(' ');
      const result = await engine.current.suggest(context, mode, callbacks);
      if (session === epoch.current) setReplies(result);
    } catch (failure) { if (session === epoch.current) { setReplyError(failure.message); if (failure.localModelFatal) handleFailure(failure, engine.current); } }
    finally { setReplyBusy(false); }
  }

  return { language, draftLanguage: language, source, portable, speechProfile, preparing, ready, phase, progress, modelNames, error,
    listening, starting, stopping, level, elapsed, interim, partial, draftSample, records: history.records, characterCount: history.characterCount,
    charCount: history.characterCount, historyTrimmed: history.historyTrimmed, truncated: history.historyTrimmed > 0,
    pending, speechPending, translationPending, replies, replyBusy, replyError, canSuggest: ready && engine.current?.canSuggest,
    prepare, start, stop, testSample, changeLanguage, changeSource, changePortable, changeSpeechProfile, clear,
    composeReply, suggestReplies, submitText, retryRecord };
}
