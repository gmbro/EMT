import { useEffect, useRef, useState } from 'react';
import { MeetingEngine } from './meeting-engine.js';
import { createLocalRecognition } from './native-speech.mjs';
import { createAudioCapture } from './audio/capture.js';
import { MODEL_CATALOG } from './models/catalog.js';
import { withDeadline } from './deadline.mjs';

export function useMeeting() {
  const [language, setLanguage] = useState('ko-KR');
  const [source, setSource] = useState('microphone');
  const [portable, setPortable] = useState(false);
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
  const [records, setRecords] = useState([]);
  const [pending, setPending] = useState(0);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replies, setReplies] = useState([]);
  const [replyError, setReplyError] = useState('');
  const engine = useRef(null);
  const capture = useRef(null);
  const recognition = useRef(null);
  const startToken = useRef(0);
  const alive = useRef(true);
  const active = useRef(false);
  const epoch = useRef(0);
  const queue = useRef(Promise.resolve());
  const pendingCount = useRef(0);
  const progressFiles = useRef(new Map());
  const partialTimer = useRef(null);
  const partialVersion = useRef(0);
  const partialBusy = useRef(false);
  const stopRef = useRef(null);

  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setElapsed(seconds => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [listening]);
  useEffect(() => () => {
    alive.current = false; epoch.current++; startToken.current++;
    clearTimeout(partialTimer.current);
    recognition.current?.abort();
    capture.current?.stop({ flush: false });
    engine.current?.destroy();
  }, []);

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

  async function prepare() {
    if (preparing || active.current || pendingCount.current) return;
    setError(''); setPreparing(true); setReady(false); setProgress(null); progressFiles.current.clear();
    try {
      if (!window.isSecureContext || !window.Worker || !window.WebAssembly) throw new Error('HTTPS와 WebAssembly를 지원하는 최신 브라우저에서 열어주세요.');
      engine.current ||= new MeetingEngine();
      const names = await engine.current.prepare(language, { source, portable, ...callbacks });
      setModelNames(names); setReady(true); setProgress(100);
      setPhase('통역 준비 완료 · 마이크를 눌러 시작하세요.');
    } catch (failure) {
      setError(`모델을 준비하지 못했어요. ${failure.message}`);
      engine.current?.destroy(); engine.current = null;
    } finally { if (alive.current) setPreparing(false); }
  }

  async function stop({ flush = true } = {}) {
    active.current = false; startToken.current++;
    setListening(false); setStarting(false); setLevel(0); setInterim(''); setPartial('');
    partialVersion.current++; clearTimeout(partialTimer.current);
    const rec = recognition.current;
    if (rec && flush) {
      setStopping(true);
      await new Promise(resolve => {
        let timeout;
        const finish = () => { clearTimeout(timeout); if (recognition.current === rec) recognition.current = null; resolve(); };
        rec.onend = finish;
        timeout = setTimeout(() => { rec.abort(); finish(); }, 1500);
        try { rec.stop(); } catch { finish(); }
      });
      setStopping(false);
    } else { recognition.current = null; rec?.abort(); }
    const current = capture.current; capture.current = null;
    await current?.stop({ flush });
  }
  stopRef.current = stop;

  function enqueue({ samples, text, duration = 0, sample = false }, inputLanguage = language) {
    const session = epoch.current;
    const currentEngine = engine.current;
    const capturedAt = performance.now();
    pendingCount.current++; setPending(pendingCount.current);
    queue.current = queue.current.then(async () => {
      if (session !== epoch.current) return;
      const start = performance.now();
      if (samples) setInterim('기기에서 음성을 인식하고 있어요…');
      const original = text || (await currentEngine.transcribe(samples, inputLanguage)).text;
      if (!original.trim() || session !== epoch.current) return;
      setInterim(original); setPartial('');
      const result = await currentEngine.translate(original, inputLanguage, callbacks);
      if (session !== epoch.current) return;
      const record = { id: crypto.randomUUID(), original, translation: result.text, language: inputLanguage, duration, sample,
        milliseconds: Math.round(performance.now() - start), waitMilliseconds: Math.round(performance.now() - capturedAt) };
      setRecords(previous => [...previous, record]); setInterim('');
      setPhase(`최근 문장 처리 ${(record.milliseconds / 1000).toFixed(1)}초 · 음성 ${duration ? `${duration.toFixed(1)}초` : '실시간 전사'}`);
    }).catch(failure => {
      if (session !== epoch.current) return;
      setError(`기기 내 통역 중 오류가 발생했어요. ${failure.message}`);
      setReady(false); epoch.current++;
      void stopRef.current?.({ flush: false });
      currentEngine.destroy(); engine.current = null;
    }).finally(() => {
      pendingCount.current--; if (alive.current) { setPending(pendingCount.current); if (!pendingCount.current) setInterim(''); }
    });
    if (pendingCount.current >= 4 && active.current) {
      setError('이 기기에서 음성 처리 속도가 듣기 속도를 따라가지 못해 잠시 멈췄어요. 쌓인 문장을 처리한 뒤 짧게 끊어서 다시 말해 주세요.');
      void stopRef.current?.();
    }
    return queue.current;
  }

  function receiveNative(event, inputLanguage) {
    let finalText = '', liveText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      else liveText += event.results[i][0].transcript;
    }
    setInterim(liveText); setPartial(''); partialVersion.current++; clearTimeout(partialTimer.current);
    if (finalText) enqueue({ text: finalText }, inputLanguage);
    // Interim translation only uses an already-ready native translator, so a
    // speculative phrase cannot queue model downloads ahead of final speech.
    const translator = engine.current.nativeTranslators.get(inputLanguage);
    if (liveText && translator && !pendingCount.current && !partialBusy.current) {
      const version = partialVersion.current;
      partialTimer.current = setTimeout(async () => {
        partialBusy.current = true;
        try {
          const output = await translator.translate(liveText);
          if (version === partialVersion.current && active.current) setPartial(output);
        } catch { /* A final result will retry through the normal error path. */ }
        finally { partialBusy.current = false; }
      }, 350);
    }
  }

  async function start() {
    if (!ready || starting || stopping || replyBusy || active.current || pendingCount.current) return;
    const token = ++startToken.current;
    setStarting(true); setError(''); setElapsed(0);
    try {
      if (engine.current.nativeSpeech && source === 'microphone') {
        const rec = createLocalRecognition(engine.current.nativeSpeech);
        recognition.current = rec;
        rec.onresult = event => { if (recognition.current === rec) receiveNative(event, language); };
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
        const recorder = await createAudioCapture(stream, { onSegment: segment => enqueue(segment, language), onLevel: setLevel,
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
    if (!ready || active.current || pendingCount.current) return;
    const session = epoch.current;
    const token = ++startToken.current;
    setError(''); setStarting(true);
    let context;
    let sampleCapture;
    try {
      setPhase('예제 음성으로 기기 내 통역을 확인하고 있어요.');
      await engine.current.client.request('prepare-speech', {}, onProgress);
      const response = await fetch(`/samples/${language === 'ko-KR' ? 'ko' : 'en'}.wav`, { credentials: 'omit' });
      if (!response.ok) throw new Error('예제 음성을 불러오지 못했어요.');
      context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const audio = await context.decodeAudioData(await response.arrayBuffer());
      if (session !== epoch.current || token !== startToken.current) return;
      // Use the live worklet/VAD/queue without a cross-context MediaStream
      // roundtrip, which would unnecessarily resample the 16 kHz fixture.
      sampleCapture = await createAudioCapture(null, { audioBuffer: audio, onSegment: segment => {
        if (session === epoch.current && token === startToken.current) enqueue({ ...segment, sample: true });
      }, onError: failure => { if (session === epoch.current) setError(failure.message); } });
      if (session !== epoch.current || token !== startToken.current) return;
      capture.current = sampleCapture;
      await withDeadline(() => sampleCapture.ended, 15000, '예제 음성 입력을 시작하지 못했어요. 버튼을 다시 눌러주세요.');
      await sampleCapture.stop(); capture.current = null;
      await queue.current;
    } catch (failure) { if (token === startToken.current && session === epoch.current) setError(failure.message); }
    finally {
      await sampleCapture?.stop({ flush: false });
      if (capture.current === sampleCapture) capture.current = null;
      await context?.close(); if (token === startToken.current) setStarting(false);
    }
  }

  function changeLanguage(value) { if (active.current || preparing || pendingCount.current || starting) return; setLanguage(value); setReady(false); setError(''); setInterim(''); setPartial(''); setReplies([]); }
  function changeSource(value) { if (active.current || preparing || pendingCount.current || starting) return; setSource(value); setReady(false); setError(''); }
  function changePortable(value) {
    if (active.current || preparing || pendingCount.current || starting) return;
    setPortable(value); setReady(false); engine.current?.destroy(); engine.current = null;
  }
  async function clear() {
    epoch.current++; await stop({ flush: false });
    setRecords([]); setReplies([]); setError(''); setElapsed(0); setReplyError(''); setInterim(''); setPartial('');
    engine.current?.clearReplies();
  }
  async function composeReply(text) {
    if (!ready || !text.trim() || replyBusy || active.current || pendingCount.current) return;
    const session = epoch.current; setReplyBusy(true); setReplyError('');
    try {
      const result = await engine.current.translate(text.trim(), 'ko-KR', callbacks);
      if (session === epoch.current) setReplies([{ en: result.text, ko: text.trim() }]);
    } catch (failure) { setReplyError(failure.message); if (failure.localModelFatal) { setReady(false); engine.current?.destroy(); engine.current = null; } }
    finally { setReplyBusy(false); }
  }
  async function suggestReplies(mode) {
    if (!ready || replyBusy || active.current || pendingCount.current || !records.length) return;
    const session = epoch.current; setReplyBusy(true); setReplyError('');
    try {
      const context = records.filter(record => record.language === language).slice(-8).map(record => record.original).join(' ');
      const result = await engine.current.suggest(context, mode, callbacks);
      if (session === epoch.current) setReplies(result);
    } catch (failure) { setReplyError(failure.message); if (failure.localModelFatal) { setReady(false); engine.current?.destroy(); engine.current = null; } }
    finally { setReplyBusy(false); }
  }

  return { language, source, portable, preparing, ready, phase, progress, modelNames, error, listening, starting, stopping, level, elapsed, interim, partial,
    records, pending, replies, replyBusy, replyError, canSuggest: ready && engine.current?.canSuggest,
    prepare, start, stop, testSample, changeLanguage, changeSource, changePortable, clear, composeReply, suggestReplies };
}
