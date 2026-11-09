import {createDeepgramLive} from './deepgram-live.mjs';
import {englishForTranslation} from './streaming-transcript.mjs';
import {createQwenLive,LOCAL_QWEN} from './qwen-live.mjs';
import {canPublishPreview,needsPreview,canStartPreview,canContinueFinalPreview} from './preview-policy.mjs';
import { useEffect, useRef, useState } from 'react';
import { MeetingEngine } from './meeting-engine.js';
import { createLocalRecognition } from './native-speech.mjs';
import { createAudioCapture } from './audio/capture.js';
import { MODEL_CATALOG } from './models/catalog.js';
import { withDeadline } from './deadline.mjs';
import { createLatestTaskRunner, mutateCaptionHistory, captionLength } from './captions.mjs';
import { loadMeetings, mergeMeeting, detectCaptionLanguage } from './meeting-archive.mjs';
import { createMeetingStore, ARCHIVE_EVENT_KEY } from './meeting-store.mjs';
import { translateCloud } from './cloud-translation.mjs';
import { createDraftTranslator } from './draft-translator.mjs';
import { createTaskPool } from './task-pool.mjs';
import { translationChunks } from './translation-chunks.mjs';
import { meetingContext, isGuideMoment } from './meeting-context.mjs';
import { usageSummary, subscribeUsage } from './request-metrics.mjs';
import { createGoogleLive } from './google-live.js';

export function useMeeting({transcribeOnly=false,guidesEnabled=true}={}) {
  const [availableProvider,setAvailableProvider]=useState(LOCAL_QWEN?'qwen':'pending');
  const [preferGoogle,setPreferGoogle]=useState(()=>{try{return localStorage.getItem('emt-speech-provider')==='google';}catch{return false;}});
  const speechProvider=availableProvider==='deepgram' && preferGoogle ? 'google' : availableProvider;
  function chooseSpeechProvider(value){
    if(availableProvider!=='deepgram' || active.current || preparingRef.current || starting || stopping)return;
    setPreferGoogle(value==='google');
    setReady(false);
    try{localStorage.setItem('emt-speech-provider',value);}catch{}
  }
  useEffect(()=>{
    if(LOCAL_QWEN)return;
    const controller=new AbortController();
    fetch('/api/live-token?provider',{signal:controller.signal}).then(r=>r.json())
      .then(data=>setAvailableProvider(data.provider==='deepgram'?'deepgram':'google'))
      .catch(()=>{if(!controller.signal.aborted)setAvailableProvider('google');});
    return ()=>controller.abort();
  },[]);
  const displayOptions=useRef({transcribeOnly,guidesEnabled});displayOptions.current={transcribeOnly,guidesEnabled};
  const [language, setLanguage] = useState('auto');
  const [draftLanguage, setDraftLanguage] = useState('en-US');
  const [source, setSource] = useState('microphone');
  const [portable, setPortable] = useState(false);
  const [speechProfile, setSpeechProfile] = useState('fast');
  const [glossary, setGlossary] = useState('');
  const glossaryRef = useRef(glossary); glossaryRef.current = glossary;
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
  const repliesRef = useRef(replies); repliesRef.current = replies;
  const [sessions, setSessions] = useState(() => { try { return loadMeetings(window.localStorage); } catch { return []; } });
  const archiveRef = useRef(sessions);
  const sessionMeta = useRef({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(true), [saving, setSaving] = useState(false);
  const store = useRef(null), storeReady = useRef(null), revision = useRef(0), queuedRevision = useRef(-1), savedRevision = useRef(-1), saveCount = useRef(0), saveTask = useRef(null);
  const [speeches, setSpeeches] = useState([]), [composeBusy, setComposeBusy] = useState(false);
  const speechesRef = useRef(speeches), composer = useRef(null); speechesRef.current = speeches;
  function changeSpeeches(update) { const next = update(speechesRef.current); speechesRef.current = next; setSpeeches(next); revision.current++; }
  const replyRunner = useRef(null), replyController = useRef(null), lastGuideAt = useRef(0), lastGuideText = useRef('');
  const [newReplies,setNewReplies] = useState(null), [meetingPurpose,setMeetingPurpose] = useState('');
  const purposeRef=useRef('');purposeRef.current=meetingPurpose;
  const [usage,setUsage]=useState(usageSummary);
  useEffect(()=>subscribeUsage(()=>setUsage(usageSummary())),[]);
  const [voiceSpeaking,setVoiceSpeaking]=useState(false), [voiceStarting,setVoiceStarting]=useState(false), [voiceError,setVoiceError]=useState('');
  const ownStopTask=useRef(null), ownVoice=useRef(null), ownStarting=useRef(null), ownRunner=useRef(null), ownPreviewAbort=useRef(null), ownQueue=useRef(Promise.resolve()), resumeMeeting=useRef(false);
  const previewTasks=useRef(new Map()), previewContexts=useRef(new Map());
  const sessionController=useRef(new AbortController());
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
  const pendingCapture = useRef(null);
  const warmLive=useRef(null),warming=useRef(null),captureClock=useRef(0);
  const deletingSession = useRef(null), livePreviewRunner = useRef(null), livePreviewAbort = useRef(null), translationPool = useRef(null), draftTranslator=useRef(null);
  draftTranslator.current ||= createDraftTranslator();
  translationPool.current ||= createTaskPool(2);

  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setElapsed(seconds => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [listening]);
  useEffect(()=>{
    if(!listening||!navigator.wakeLock)return;
    let lock,cancelled=false;
    const acquire=async()=>{if(document.visibilityState!=='visible')return;try{const next=await navigator.wakeLock.request('screen');if(cancelled)await next.release();else lock=next;}catch{}};
    void acquire();document.addEventListener('visibilitychange',acquire);
    return()=>{cancelled=true;document.removeEventListener('visibilitychange',acquire);void lock?.release();};
  },[listening]);
  useEffect(() => {
    alive.current = true;
    if(sessionController.current.signal.aborted)sessionController.current=new AbortController();
    // Fast Refresh replays effects. A disposed engine must not remain ready
    // when the developer edits the UI while the local server is running.
    preparingRef.current = false; readyRef.current = false; active.current = false;
    setReady(false); setPreparing(false); setListening(false); setStarting(false); setStopping(false);
    return () => {
      alive.current = false; epoch.current++; startToken.current++; sessionController.current.abort(); ownStarting.current?.abort();ownPreviewAbort.current?.abort();ownRunner.current?.dispose();void ownVoice.current?.stop({flush:false});replyController.current?.abort();
      partialRunner.current?.dispose(); partialRunner.current = null; livePreviewRunner.current?.dispose();livePreviewRunner.current=null;livePreviewAbort.current?.abort();
      partialAbort.current?.abort(); replyRunner.current?.dispose(); replyRunner.current = null;
      recognition.current?.abort(); recognition.current = null;
      capture.current?.stop({ flush: false }); capture.current = null;
      pendingCapture.current?.controller.abort();warming.current?.abort();void warmLive.current?.live.stop({flush:false});warmLive.current=null; composer.current?.abort();
      for (const track of pendingCapture.current?.stream?.getTracks() || []) track.stop();
      pendingCapture.current = null;
      engine.current?.destroy(); engine.current = null;
    };
  }, []);
  useEffect(() => {
    store.current ||= createMeetingStore();
    storeReady.current ||= store.current.load();
    let mounted = true;
    storeReady.current.then(next => { if (mounted) { archiveRef.current = next; setSessions(next); setArchiveLoading(false); } })
      .catch(() => { if (mounted) { setArchiveLoading(false); setStorageError('회의 저장소를 열지 못했어요. 브라우저 저장 공간·권한을 확인하고 기록은 파일로 저장해 주세요.'); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    // A periodic checkpoint cannot be postponed indefinitely by continuous speech.
    const timer = setInterval(() => { if (revision.current !== queuedRevision.current) void persistCurrent(); }, 1500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { revision.current++; }, [replies]);
  useEffect(() => {
    const save = () => { void persistCurrent(); };
    const sync = async event => {
      if (event.key !== ARCHIVE_EVENT_KEY) return;
      try { const next = await store.current.read(); archiveRef.current = next; if (alive.current) setSessions(next); } catch { /* Current save errors are surfaced separately. */ }
    };
    window.addEventListener('pagehide', save);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('pagehide', save); window.removeEventListener('storage', sync); void persistCurrent(false); };
  }, []);

  const mutateHistory = update => {
    if (!alive.current) return;
    const next = mutateCaptionHistory(historyRef.current, update);
    historyRef.current = next; setHistory(next); revision.current++;
  };
  function publishHistory(next) { historyRef.current = next; setHistory(next); revision.current++; }
  const [currentSpeaker,setCurrentSpeaker]=useState('');
  const speakerRef=useRef('');
  function selectSpeaker(value) {
    speakerRef.current=value;
    setCurrentSpeaker(value);
  }
  function assignSpeaker(ids,value) {
    const selected=new Set(ids);
    mutateHistory(rows=>rows.map(row=>selected.has(row.id)?{...row,speakerId:value,speakerManual:true}:row));
  }
  function appendRecord(record) {
    if(speakerRef.current)record={...record,speakerId:speakerRef.current,speakerManual:true};
    const current = historyRef.current, records = [...current.records];
    const index = records.findIndex(row => row.createdAt > record.createdAt);
    records.splice(index < 0 ? records.length : index, 0, record);
    publishHistory({ ...current, records, characterCount: current.characterCount + captionLength(record) });
  }
  function updateRecord(id, update) {
    const current = historyRef.current, index = current.records.findIndex(row => row.id === id);
    if (index < 0) return;
    const previous = current.records[index], record = { ...previous, ...update }, records = [...current.records];
    if(previous.speakerManual)record.speakerId=previous.speakerId;
    records[index] = record;
    const delta = record.original === previous.original && record.translation === previous.translation ? 0 : captionLength(record) - captionLength(previous);
    publishHistory({ ...current, records, characterCount: current.characterCount + delta });
  }
  function syncPending() {
    if (!alive.current) return;
    setSpeechPending(speechJobs.current.size); setTranslationPending(translationJobs.current.size);
    setPending(speechJobs.current.size + translationJobs.current.size);
  }
  const isBusy = () => speechJobs.current.size > 0 || translationJobs.current.size > 0;
  const onProgress = ({ model, progress: update }) => {
    if (!alive.current) return;
    if (model === 'native') { setProgress(null); return; }
    if (update.status === 'download-retry') { setPhase(`모델 다운로드가 끊겨 이어받고 있어요. 재연결 ${update.attempt}/2`); return; }
    if (update.status === 'progress' && update.total) {
      progressFiles.current.set(`${model}:${update.file}`, { loaded: update.loaded, total: update.total });
      const files = [...progressFiles.current.values()];
      setProgress(Math.min(99, Math.round(100 * files.reduce((n, file) => n + file.loaded, 0) / files.reduce((n, file) => n + file.total, 0))));
    }
    if (update.status === 'initiate') setPhase(`${MODEL_CATALOG[model]?.label || '기기'} 모델을 불러오고 있어요.`);
    if (update.status === 'ready') setPhase('모델을 메모리에 올리고 있어요. 잠시만 기다려 주세요.');
  };
  const callbacks = { onProgress, onStatus: message => alive.current && setPhase(message) };

  async function prepareFor(inputLanguage,{warm=false}={}) {
    if (preparingRef.current || active.current || isBusy() || clearing.current || stopTask.current) return;
    const session = epoch.current;
    preparingRef.current = true;
    setError(''); setPreparing(true); setReady(false); setProgress(null); progressFiles.current.clear();
    try {
      if (!window.isSecureContext || !window.WebSocket || !(window.AudioContext||window.webkitAudioContext) || !window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS와 실시간 오디오를 지원하는 최신 브라우저에서 열어주세요.');
      engine.current ||= new MeetingEngine();
      const currentEngine = engine.current;
      const names = await currentEngine.prepare(inputLanguage, { speechProvider, source, portable, speechProfile, translationEnabled:!LOCAL_QWEN || !displayOptions.current.transcribeOnly || displayOptions.current.guidesEnabled, ...callbacks });
      if (!alive.current || session !== epoch.current || engine.current !== currentEngine) return;
      if(warm){await warmLive.current?.live.stop({flush:false});warmLive.current=null;const controller=new AbortController();warming.current=controller;const live=await createLiveSession(currentEngine,session,inputLanguage,controller.signal);warming.current=null;if(!alive.current||session!==epoch.current){await live.stop({flush:false});return;}warmLive.current={live,session};}
      setModelNames(names); setReady(true); setProgress(100);
      setPhase('통역 준비 완료 · 마이크를 눌러 시작하세요.');
    } catch (failure) {
      if (!alive.current || session !== epoch.current) return;
      setError(`통역 연결을 준비하지 못했어요. ${failure.message}`);
      engine.current?.destroy(); engine.current = null;
    } finally { preparingRef.current = false; if (alive.current) setPreparing(false); }
  }
  async function prepare(options) { return prepareFor(language,{warm:options?.warm===true}); }
  function translationContext(before = Infinity, text = '', guide = false) {
    return meetingContext(historyRef.current.records,{before,text,guide,purpose:purposeRef.current});
  }
  function stableContext(record) {
    if(!previewContexts.current.has(record.id))previewContexts.current.set(record.id,translationContext(record.createdAt,record.original));
    return previewContexts.current.get(record.id);
  }

  function resetDraft() {
    draftKey.current = null; latestPreview.current = null;
    partialRunner.current?.invalidate(); partialAbort.current?.abort();
    if (alive.current) { setInterim(''); setPartial(''); setDraftSample(false); }
  }
  function translateDraft(text, inputLanguage, key) {
    if (inputLanguage === 'ko-KR' || !text.trim() || !engine.current?.canDraftTranslate) return;
    if (!partialRunner.current) {
      partialRunner.current = createLatestTaskRunner({
        delay: 650,
        canRun: () => translationJobs.current.size === 0,
        run: async (task, emit) => {
          if (task.session !== epoch.current || task.key !== draftKey.current) return;
          const controller = new AbortController(); partialAbort.current = controller;
          try {
            return await task.engine.translateDraft(task.text, task.language, { signal: controller.signal, onText: emit, context: translationContext(), glossary: glossaryRef.current });
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
    const detected = inputLanguage === 'auto' ? detectCaptionLanguage(text) : inputLanguage;
    draftKey.current = key; setInterim(text); setDraftSample(sample); setDraftLanguage(detected);
    translateDraft(text, detected, key);
  }

  async function stop({ flush = true } = {}) {
    active.current = false; startToken.current++; samplePreviewToken.current = null;warming.current?.abort();warming.current=null;
    pendingCapture.current?.controller.abort();
    for (const track of pendingCapture.current?.stream?.getTracks() || []) track.stop();
    pendingCapture.current = null;
    setListening(false); setStarting(false); setLevel(0); resetDraft();
    if (stopTask.current) {
      if (!flush) recognition.current?.abort();
      return stopTask.current;
    }
    setStopping(true);
    const task = (async () => {
      const warmed=warmLive.current;warmLive.current=null;await warmed?.live.stop({flush:false});
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
    if (record.sourcePending) { updateRecord(record.id, { status: 'error', error: record.incomplete?'미완성 발화예요. 원문을 수정해 문장을 완성한 뒤 다시 번역할 수 있어요.':'인식 중 연결이 끝났어요. 이 원문은 확정되지 않았습니다.' }); return translationQueue.current; }
    if(displayOptions.current.transcribeOnly){updateRecord(record.id,{translation:'',status:'complete',error:'',transcriptOnly:true});if(record.language==='en-US')scheduleReplies(record.original);return translationQueue.current;}
    const english=englishForTranslation(record.original,record.language);
    if (!english) { updateRecord(record.id, { translation: '', status: 'complete', error: '' }); return translationQueue.current; }
    const job = record.id;
    if (translationJobs.current.has(job)) return translationQueue.current;
    translationJobs.current.add(job); syncPending();
    const queuedAt = performance.now(), requestSignal=sessionController.current.signal;
    const valid=()=>session===epoch.current&&alive.current&&historyRef.current.records.some(r=>r.id===record.id&&r.original===record.original);
    const task = translationPool.current.run(async () => {
      if (session !== epoch.current || !alive.current) return;
      updateRecord(record.id, { status: 'translating', error: '' });
      const started = performance.now();
      try {
        const inFlight=previewTasks.current.get(record.id);
        if(inFlight?.text===record.original && inFlight.glossary===glossaryRef.current) await inFlight.promise.catch(()=>{});
        if(!valid()||requestSignal.aborted)return;
        const previous=historyRef.current.records.find(r=>r.id===record.id)?.translation;
        let recovering=Boolean(previous);
        const result = await currentEngine.translate(english, 'en-US', { ...callbacks, retries:Math.max(0,2-(record.autoAttempts||0)), signal:requestSignal, context:stableContext(record), glossary: glossaryRef.current,
          onRetry:({attempt})=>{recovering=true;if(valid())updateRecord(record.id,{status:'recovering',retryAttempt:attempt,autoAttempts:(record.autoAttempts||0)+attempt});},
          onText: text => { if (!recovering && valid() && typeof text === 'string') {const row=historyRef.current.records.find(row=>row.id===record.id);updateRecord(record.id, { translation: text,...(row?.captureStartedAt?{firstTranslationAfterCaptureMs:row.firstTranslationAfterCaptureMs??Math.round(performance.now()-row.captureStartedAt)}:{}) });} },
        });
        if (!valid()) return;
        if (!result.text?.trim()) throw new Error('번역 결과가 비어 있어요. 이 문장을 다시 번역해 주세요.');
        const milliseconds = Math.round(performance.now() - (record.startedAt || started));
        updateRecord(record.id, { translation: result.text, status: 'complete', error: '', milliseconds,
          segmentReadyAt:queuedAt,translationRequestAt:started,translationCompletedAt:performance.now(),translationMilliseconds: Math.round(performance.now() - started), waitMilliseconds: Math.round(started - queuedAt) });
        setPhase(`최근 문장 처리 ${(milliseconds / 1000).toFixed(1)}초 · ${record.sample ? '예제 음성' : 'Gemini 통역'}`);
        const lastEnglish = record.language === 'en-US' ? record.original : historyRef.current.records.filter(row => row.language === 'en-US').at(-1)?.original;
        if (lastEnglish) scheduleReplies(lastEnglish);
      } catch (failure) {
        if (session !== epoch.current || !alive.current) return;
        if(valid() && failure.name!=='AbortError')updateRecord(record.id, { status: 'error', error: failure.message, errorCode:failure.code });
      }
    }).finally(() => { if(session===epoch.current){translationJobs.current.delete(job);previewContexts.current.delete(job);previewTasks.current.delete(job);syncPending();} });
    translationQueue.current=Promise.all([translationQueue.current,task]).then(()=>{});
    return task;
  }

  function enqueue({ samples, text, duration = 0, sample = false, segmentKey, input = 'voice' }, inputLanguage = language) {
    const session = epoch.current, currentEngine = engine.current;
    const record = { id: crypto.randomUUID(), original: text?.trim() || '', translation: '', language: inputLanguage === 'auto' ? detectCaptionLanguage(text || '') : inputLanguage,
      duration, sample, input, status: 'translating', error: '', startedAt: performance.now(), createdAt: Date.now() };
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
          if (inputLanguage === 'auto') record.language = detectCaptionLanguage(record.original);
          if (!inserted) { appendRecord({ ...record, status: 'recognizing' }); inserted = true; }
          else updateRecord(record.id, { original: record.original, language: record.language });
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
    if (!ready || starting || stopping || stopTask.current || clearing.current || sessionBusy || ownVoice.current || ownStarting.current || active.current || (isBusy() && !engine.current?.cloudSpeech)) return;
    const token = ++startToken.current, session = epoch.current;
    setStarting(true); setError(''); setElapsed(0); resetDraft();
    let audioContext;
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
        const Context=window.AudioContext||window.webkitAudioContext;
        audioContext=new Context({latencyHint:'interactive'});
        void audioContext.resume().catch(()=>{});
        const stream = source === 'meeting-tab'
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (token !== startToken.current) { stream.getTracks().forEach(track => track.stop());await audioContext?.close();return; }
        if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error('회의 탭과 ‘탭 오디오 공유’를 함께 선택해 주세요.'); }
        active.current = true;
        const recorder = engine.current.cloudSpeech ? await createCloudCapture(stream,{audioContext}) : await createAudioCapture(stream, { maxSeconds: 6, silenceMs: 650,
          onSegment: segment => { if (session === epoch.current) enqueue({ ...segment, segmentKey: `${token}:${segment.segmentId}` }, language); },
          onPreview: segment => { if (session === epoch.current) receivePreview(segment, language, `${token}:${segment.segmentId}`); }, onLevel: setLevel,
          onError: failure => { setError(failure.message); void stopRef.current?.(); }, onEnded: () => void stopRef.current?.() });
        if (token !== startToken.current) { await recorder.stop({ flush: false }); return; }
        capture.current = recorder; setListening(true);
      }
    } catch (failure) {
      if (token !== startToken.current) return;
      active.current = false; setListening(false);
      if(audioContext?.state!=='closed')await audioContext?.close();
      setError(failure.name === 'NotAllowedError' ? '마이크 또는 탭 오디오 권한을 허용한 뒤 다시 눌러주세요.' : failure.name==='NotFoundError'?'오디오 입력 장치를 찾지 못했습니다. 마이크를 연결하거나 회의 탭 오디오를 선택해 주세요.':failure.message);
    } finally { if (token === startToken.current) setStarting(false); }
  }

  function previewLive(record, currentEngine, session) {
    if(displayOptions.current.transcribeOnly)return;
    if(record.language!=='en-US'||!record.sourcePending||/[가-힣]/u.test(record.original)||!canStartPreview(record.original))return;
    livePreviewRunner.current ||= createLatestTaskRunner({delay:0,canRun:()=>translationJobs.current.size<2,
      run:async(task,emit)=>{
        if(task.session!==epoch.current)return;
        const row=historyRef.current.records.find(r=>r.id===task.id);
        if(!row?.sourcePending)return;
        const previous=previewTasks.current.get(task.id);
        if(previous?.glossary===task.glossary && (canPublishPreview(task.text,previous.text)||!needsPreview(previous.text,task.text)))return;
        const controller=new AbortController();livePreviewAbort.current=controller;
        const promise=task.engine.translateDraft(task.text,'en-US',{signal:controller.signal,onText:emit,context:task.context,glossary:task.glossary});
        previewTasks.current.set(task.id,{text:task.text,glossary:task.glossary,promise});
        try{return await promise;}finally{if(livePreviewAbort.current===controller)livePreviewAbort.current=null;}
      },
      publish:(text,task)=>{
        const row=historyRef.current.records.find(r=>r.id===task.id);
        if(alive.current&&task.session===epoch.current&&row && (row.sourcePending ? canPublishPreview(row.original,task.text) : row.status==='translating'&&canContinueFinalPreview(row.original,task.text,glossaryRef.current,task.glossary))&&typeof text==='string')updateRecord(task.id,{translation:text,firstTranslationAfterCaptureMs:row.firstTranslationAfterCaptureMs??Math.round(performance.now()-row.captureStartedAt)});
      },onError:()=>{},
    });
    livePreviewRunner.current.submit({id:record.id,text:record.original,context:stableContext(record),glossary:glossaryRef.current,engine:currentEngine,session});
  }
  async function createLiveSession(currentEngine,session,inputLanguage=language,signal=currentEngine.controller.signal){
    const used=new Set(historyRef.current.records.map(row=>row.speakerId).filter(Boolean));
    let next=0;
    function allocateSpeaker(){
      let label;
      do {label=next<26?String.fromCharCode(65+next):String(next+1);next++;} while(used.has(label));
      used.add(label);return label;
    }
    return (LOCAL_QWEN?createQwenLive:speechProvider==='deepgram'?createDeepgramLive:createGoogleLive)({allocateSpeaker,onStatus:message=>{if(session===epoch.current&&alive.current)setError(message);},language:inputLanguage,vocabulary:glossaryRef.current.split(/[\n=,]/).map(s=>s.trim()).filter(word=>word&&word.length<=80).slice(0,80),signal,
        onDiscard: id => {
          if (session !== epoch.current || !alive.current) return;
          livePreviewRunner.current?.invalidate();
          livePreviewAbort.current?.abort();
          previewTasks.current.delete(id);
          previewContexts.current.delete(id);
          mutateHistory(rows => rows.filter(row => row.id !== id));
        },
        onUpdate: record => {
          if (session !== epoch.current || !alive.current) return;
          record={...record,sample:samplePreviewToken.current!==null};
          const previous=historyRef.current.records.find(row=>row.id===record.id);
          if(previous?.language!==record.language || previous?.id!==record.id){livePreviewRunner.current?.invalidate();draftTranslator.current.clear();}
          const requested=previewTasks.current.get(record.id);
          // Revisions (e.g. added negation) supersede an in-flight draft.
          // Suffix growth keeps its stream alive so continuous speech cannot
          // starve translation and does not cause a new paid call per token.
          if(requested && !canPublishPreview(record.original,requested.text)){
            livePreviewAbort.current?.abort();livePreviewRunner.current?.invalidate();
          }
          const update = { ...record,captureStartedAt:captureClock.current,firstSourceAfterCaptureMs:previous?.firstSourceAfterCaptureMs??Math.round(performance.now()-captureClock.current), translation: record.language === 'ko-KR' ? '' : previous?.translation || record.translation, status: record.sourcePending ? 'recognizing' : record.language === 'ko-KR' ? 'recognizing' : 'translating', error: '' };
          if (historyRef.current.records.some(row => row.id === record.id)) updateRecord(record.id, update);
          else appendRecord(update);
          previewLive(record,currentEngine,session);
        },
        onFinal: record => {
          if (session !== epoch.current || !alive.current) return;
          const preview=previewTasks.current.get(record.id);
          if(!preview || !canContinueFinalPreview(record.original,preview.text,glossaryRef.current,preview.glossary)){livePreviewAbort.current?.abort();livePreviewRunner.current?.invalidate();}
          record={...record,sample:samplePreviewToken.current!==null};
          const previous=historyRef.current.records.find(row=>row.id===record.id);
          updateRecord(record.id, { ...record, translation: record.language === 'ko-KR' ? '' : previous?.translation || '', status: record.language === 'ko-KR' ? 'complete' : 'translating' });
          queueTranslation(record, currentEngine, session);
        },
        onError: failure => { if (session === epoch.current && alive.current) { setError(failure.message); mutateHistory(rows=>rows.map(row=>row.live && row.status!=='complete' && !translationJobs.current.has(row.id) ? {...row,status:'error',error:failure.message} : row)); void stopRef.current?.({ flush: false }); } },
    });
  }
  async function createCloudCapture(stream, { audioBuffer, audioContext, sample = false } = {}) {
    const session = epoch.current, currentEngine = engine.current;
    const controller = new AbortController(), pending = { controller, stream };
    const abort = () => controller.abort();
    currentEngine.controller.signal.addEventListener('abort', abort, { once: true });
    pendingCapture.current = pending;
    let live, recorder;const buffered=[];captureClock.current=performance.now();let bufferedSamples=0;
    try {
      recorder=await createAudioCapture(stream,{audioBuffer,audioContext,onInputStatus:setError,onPCM:samples=>{if(live)live.push(samples);else{bufferedSamples+=samples.length;if(bufferedSamples>400000){controller.abort();throw new Error('음성 연결이 늦어져 시작을 중단했어요. 다시 시작해 주세요.');}buffered.push(samples.slice());}},onLevel:setLevel,onError:failure=>{setError(failure.message);controller.abort();void stopRef.current?.();},onEnded:()=>{if(!audioBuffer)setError('오디오 입력이 종료되었습니다. 장치를 확인하고 다시 연결해 주세요.');void stopRef.current?.();}});
      if(warmLive.current?.session===session){live=warmLive.current.live;warmLive.current=null;}else live=await createLiveSession(currentEngine,session,language,controller.signal);
      if (controller.signal.aborted) throw new Error('음성 연결이 취소됐어요.');
      for(const pcm of buffered)live.push(pcm);buffered.length=0;
      if (pendingCapture.current === pending) pendingCapture.current = null;
      return { ended: recorder.ended, async stop(options) { try { await recorder.stop(options); await live.stop(options); } finally { currentEngine.controller.signal.removeEventListener('abort', abort); } } };
    } catch (error) { if (pendingCapture.current === pending) pendingCapture.current = null; currentEngine.controller.signal.removeEventListener('abort', abort); await recorder?.stop({ flush: false }); await live?.stop({ flush: false }); for (const track of stream?.getTracks() || []) track.stop(); throw error; }
  }

  async function testSample(sampleLanguage = 'en-US') {
    if (!ready || active.current || starting || stopTask.current || clearing.current || isBusy()) return;
    const session = epoch.current, token = ++startToken.current;
    setError(''); setStarting(true); samplePreviewToken.current = token;
    let context, sampleCapture;
    try {
      setPhase('예제 음성으로 통역을 확인하고 있어요.');
      if (!engine.current.cloudSpeech) await engine.current.client.request('prepare-speech', { speechProfile }, onProgress);
      const files = sampleLanguage === 'bilingual' ? ['en', 'ko'] : [sampleLanguage === 'ko-KR' ? 'ko' : 'en'];
      const responses = await Promise.all(files.map(file => fetch(`/samples/${file}.wav`, { credentials: 'omit' })));
      if (responses.some(response => !response.ok)) throw new Error('예제 음성을 불러오지 못했어요.');
      context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const audios = await withDeadline(()=>Promise.all(responses.map(async response => context.decodeAudioData(await response.arrayBuffer()))),10000,'브라우저에서 예제 음성을 읽지 못했습니다. 오디오 출력을 확인해 주세요.');
      if (session !== epoch.current || token !== startToken.current) return;
      const fixture = context.createBuffer(1, audios.reduce((sum, audio) => sum + audio.length, 0) + 24000 + (audios.length - 1) * 32000, 16000);
      let offset = 8000;
      for (const audio of audios) { fixture.copyToChannel(audio.getChannelData(0), 0, offset); offset += audio.length + 32000; }
      sampleCapture = engine.current.cloudSpeech ? await createCloudCapture(null, { audioBuffer: fixture, sample: true }) : await createAudioCapture(null, { audioBuffer: fixture,
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

  useEffect(()=>{
    const recover=()=>{if(!readyRef.current||clearing.current)return;for(const row of historyRef.current.records){
      if(row.status==='error'&&row.errorCode==='NETWORK'&&!row.sourcePending&&(row.autoAttempts||0)<2&&!translationJobs.current.has(row.id)){
        const next={...row,autoAttempts:(row.autoAttempts||0)+1};updateRecord(row.id,next);void queueTranslation(next);
      }
    }};
    window.addEventListener('online',recover);return()=>window.removeEventListener('online',recover);
  },[]);
  function changeLanguage(value) {
    if (!['auto', 'en-US', 'ko-KR'].includes(value) || value === language || active.current || preparingRef.current || isBusy() || starting || stopping || replyBusy) return;
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
    clearing.current = true; sessionController.current.abort();sessionController.current=new AbortController();resumeMeeting.current=false;await stopOwnVoice(false);ownRunner.current?.dispose();ownRunner.current=null;ownPreviewAbort.current?.abort();previewContexts.current.clear();previewTasks.current.clear();engine.current?.clearCloudCache();replyController.current?.abort();setNewReplies(null);lastGuideAt.current=0;lastGuideText.current=''; livePreviewAbort.current?.abort();livePreviewRunner.current?.invalidate(); epoch.current++; composer.current?.abort(); composer.current = null; setComposeBusy(false); changeSpeeches(() => []); resetDraft(); replyRunner.current?.invalidate();
    speechJobs.current.clear(); translationJobs.current.clear(); syncPending();
    try {
      await stop({ flush: false });
      if (!alive.current) return;
      const empty = { records: [], characterCount: 0, historyTrimmed: 0 };
      setHistory(empty); historyRef.current = empty;
      setReplies([]); setMeetingPurpose('');setError(''); setElapsed(0); setReplyError('');
      engine.current?.clearReplies();
    } finally { clearing.current = false; }
  }
  function submitText(text, inputLanguage = 'auto') {
    if (!ready || preparingRef.current || clearing.current || stopTask.current || !text.trim() || text.length > 10000) return false;
    enqueue({ text, input: 'text' }, inputLanguage); return true;
  }
  function retryRecord(id) {
    if (!ready || preparingRef.current || clearing.current || stopTask.current) return;
    const record = historyRef.current.records.find(record => record.id === id);
    if (!record || record.status !== 'error' || !record.original.trim()) return;
    updateRecord(id, { status: 'translating', error: '' });
    return queueTranslation({ ...record, startedAt: performance.now() });
  }
  function editRecord(id,text,inputLanguage) {
    const row=historyRef.current.records.find(row=>row.id===id);
    if(!row||row.sourcePending&&row.status!=='error'||translationJobs.current.has(id)||!text.trim()||text.length>20000)return false;
    const updated={...row,original:text.trim(),language:inputLanguage,translation:'',originalBeforeEdit:row.originalBeforeEdit||row.original,userEdited:true,status:'translating',sourcePending:false,startedAt:performance.now()};
    previewContexts.current.delete(id);previewTasks.current.delete(id);setReplies(rows=>rows.filter(r=>r.sourceId!==id));setNewReplies(null);updateRecord(id,updated);void queueTranslation(updated);return true;
  }
  async function composeReply(text, retryId, {voice=false}={}) {
    if (!readyRef.current || !text.trim() || text.length > (voice?20000:1800) || composer.current || clearing.current) return false;
    const session=epoch.current, controller=new AbortController(), id=retryId||crypto.randomUUID();
    composer.current=controller;setComposeBusy(true);
    const existing=speechesRef.current.find(r=>r.id===id);
    const item={id,ko:text.trim(),en:existing?.ko===text.trim()?existing.en||'':'',createdAt:existing?.createdAt||Date.now(),status:'writing',error:'',input:voice?'voice':'text'};
    changeSpeeches(rows=>existing?rows.map(r=>r.id===id?item:r):[...rows,item]);
    const update=patch=>{if(alive.current&&session===epoch.current)changeSpeeches(rows=>rows.map(r=>r.id===id?{...r,...patch}:r));};
    let recovering=Boolean(item.en);
    try {
      const completed=[];
      for(const chunk of translationChunks(text.trim(),1200)){
        const result=await engine.current.cloudChunk(chunk,'ko-KR',{task:'speech',signal:controller.signal,context:existing?.context??translationContext(Infinity,text),glossary:glossaryRef.current,
          onRetry:()=>{recovering=true;update({status:'recovering'});},onText:en=>{if(!recovering)update({en:[...completed,en].join('\n')});}});
        completed.push(result.text);
      }
      const result={text:completed.join('\n')};
      update({en:result.text,status:'complete'});return true;
    }catch(failure){update({status:'error',error:failure.message});return false;}
    finally{if(composer.current===controller){composer.current=null;if(alive.current)setComposeBusy(false);}}
  }
  async function stopOwnVoice(resume=true,{flush=resume}={}) {
    ownStarting.current?.abort();ownStarting.current=null;
    if(ownStopTask.current)return ownStopTask.current;
    const current=ownVoice.current;ownVoice.current=null;
    setVoiceSpeaking(false);setVoiceStarting(Boolean(current));
    const stopping=current?.stop({flush});ownStopTask.current=stopping;
    try{await stopping;}finally{ownStopTask.current=null;setVoiceStarting(false);if(!flush)changeSpeeches(rows=>rows.map(r=>r.status==='recognizing'?{...r,status:'error',error:'음성 입력이 중단됐어요. 원문을 확인해 주세요.'}:r));}
    if(resume&&resumeMeeting.current&&!clearing.current&&alive.current){resumeMeeting.current=false;void start();}
  }
  async function startOwnVoice({sampleBuffer}={}) {
    if(!readyRef.current||ownVoice.current||ownStarting.current||ownStopTask.current||clearing.current)return;
    const session=epoch.current, controller=new AbortController();ownStarting.current=controller;
    setVoiceStarting(true);setVoiceError('');
    let stream,recorder,live,context;
    const valid=()=>alive.current&&session===epoch.current&&!controller.signal.aborted;
    const upsert=record=>{
      if(!valid())return;
      const previous=speechesRef.current.find(r=>r.id===record.id);
      const row={id:record.id,ko:record.original,en:previous?.en||'',createdAt:record.createdAt,status:'recognizing',input:'voice',context:previous?.context??translationContext(Infinity,record.original)};
      changeSpeeches(rows=>previous?rows.map(r=>r.id===row.id?{...r,...row}:r):[...rows,row]);
      return row;
    };
    try{
      // Acquire permission in the click gesture, then stop the shared mic before forwarding any PCM.
      context=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});void context.resume().catch(()=>{});
      if(!sampleBuffer)stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      resumeMeeting.current=source==='microphone'&&active.current;
      if(source==='microphone')await stop();
      if(!valid())throw new Error('내 발언 입력을 취소했어요.');
      const ownRequests=new Map();
      const preview=createLatestTaskRunner({delay:150,canRun:()=>!composer.current&&translationJobs.current.size<2,
        run:async(row,emit)=>{if(!valid()||!needsPreview(ownRequests.get(row.id)?.text,row.ko))return;const c=new AbortController();ownPreviewAbort.current=c;const promise=engine.current.cloudChunk(row.ko,'ko-KR',{task:'speech',draft:true,timeoutMs:6000,signal:c.signal,context:row.context,glossary:glossaryRef.current,onText:emit}).then(r=>r.text);ownRequests.set(row.id,{text:row.ko,promise,controller:c});return promise;},
        publish:(en,row)=>{if(valid())changeSpeeches(rows=>rows.map(r=>r.id===row.id&&r.status==='recognizing'&&canPublishPreview(r.ko,row.ko)?{...r,en}:r));}});
      ownRunner.current=preview;
      const pending=[];
      recorder=await createAudioCapture(stream,{audioContext:context,audioBuffer:sampleBuffer,onPCM:samples=>{if(live)live.push(samples);else if(pending.length<120)pending.push(samples.slice());else controller.abort();},onError:failure=>{setVoiceError(failure.message);void stopOwnVoice();},onEnded:()=>void stopOwnVoice()});
      live=await (LOCAL_QWEN?createQwenLive:createGoogleLive)({language:'ko-KR',signal:controller.signal,
        onUpdate:record=>{const row=upsert(record);if(row&&record.sourcePending&&row.ko.length>=8&&row.ko.length<=1200)preview.submit(row);},
        onFinal:record=>{
          preview.invalidate();const pendingPreview=ownRequests.get(record.id);if(pendingPreview?.text!==record.original)pendingPreview?.controller.abort();
          if(!valid())return;
          const row=upsert(record);if(!row)return;
          if(record.sourcePending){changeSpeeches(rows=>rows.map(r=>r.id===row.id?{...r,status:'error',error:'인식이 끝나지 않았어요. 원문을 확인하고 변환해 주세요.'}:r));return;}
          changeSpeeches(rows=>rows.map(r=>r.id===row.id?{...r,status:'writing'}:r));
          ownQueue.current=ownQueue.current.then(async()=>{
            if(pendingPreview?.text===record.original)await pendingPreview.promise.catch(()=>{});ownRequests.delete(record.id);
            while(composer.current&&session===epoch.current)await new Promise(resolve=>setTimeout(resolve,100));
            if(session===epoch.current&&!clearing.current)await composeReply(row.ko,row.id,{voice:true});
          });
        },onError:failure=>{setVoiceError(failure.message);void stopOwnVoice();}});
      if(!valid())throw new Error('내 발언 입력을 취소했어요.');
      for(const pcm of pending)live.push(pcm);
      ownVoice.current={ended:recorder.ended,async stop(options){try{await recorder.stop(options);await live.stop(options);}finally{preview.dispose();controller.abort();ownPreviewAbort.current?.abort();}}};
      ownStarting.current=null;setVoiceSpeaking(true);
    }catch(failure){controller.abort();await recorder?.stop({flush:false});await live?.stop({flush:false});stream?.getTracks().forEach(t=>t.stop());if(context?.state!=='closed')await context?.close();if(session===epoch.current)setVoiceError(failure.name==='NotAllowedError'?'마이크 권한을 허용해 주세요.':failure.message);}
    finally{if(ownStarting.current===controller)ownStarting.current=null;if(alive.current)setVoiceStarting(false);}
  }
  async function testOwnSample() {
    const response=await fetch('/samples/ko.wav');
    const context=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
    try{const sampleBuffer=await context.decodeAudioData(await response.arrayBuffer());await startOwnVoice({sampleBuffer});const current=ownVoice.current;if(current){await current.ended;await stopOwnVoice(false,{flush:true});await ownQueue.current;}}
    finally{await context.close();}
  }
  async function suggestReplies(mode, {count=3,automatic=false,alternatives=false}={}) {
    if(!readyRef.current||replyController.current)return;
    const sourceRow=historyRef.current.records.filter(r=>r.language==='en-US'&&!r.sourcePending).at(-1);
    const english=sourceRow?.original;
    if(!english)return;
    const session=epoch.current,controller=new AbortController();replyController.current=controller;setReplyBusy(true);setReplyError('');
    lastGuideAt.current=Date.now();lastGuideText.current=english.trim().toLowerCase();
    try{
      const generated=await engine.current.suggest(translationContext(sourceRow.createdAt,english,true),mode,{sourceEnglish:english,glossary:glossaryRef.current,replyCount:count,signal:controller.signal});
      const result=generated.map(reply=>({...reply,sourceId:sourceRow.id,sourceAt:sourceRow.createdAt}));
      if(session===epoch.current&&alive.current){if(automatic&&repliesRef.current.length)setNewReplies(result);else{setReplies(alternatives?[...repliesRef.current.slice(0,1),...result.filter(r=>r.en!==repliesRef.current[0]?.en)].slice(0,3):result);setNewReplies(null);}}
    }catch(failure){if(session===epoch.current&&failure.name!=='AbortError')setReplyError(failure.message);}
    finally{if(replyController.current===controller){replyController.current=null;if(alive.current)setReplyBusy(false);}}
  }
  function scheduleReplies(english) {
    if(!displayOptions.current.guidesEnabled)return;
    if(translationJobs.current.size>2||!isGuideMoment(english)||english.trim().toLowerCase()===lastGuideText.current||Date.now()-lastGuideAt.current<(/[?？]/.test(english)?12000:30000))return;
    if(!replyRunner.current)replyRunner.current=createLatestTaskRunner({delay:900,canRun:()=>translationJobs.current.size===0&&!composer.current&&!replyController.current,
      run:()=>displayOptions.current.guidesEnabled&&Date.now()-lastGuideAt.current>=12000?suggestReplies('비즈니스',{automatic:true}):undefined,publish:()=>{}});
    replyRunner.current.submit({english});
  }
  function acceptNewReplies(){if(newReplies){setReplies(newReplies);setNewReplies(null);}}
  async function persistCurrent(notify = true) {
    if (clearing.current || deletingSession.current === sessionMeta.current.id || (!historyRef.current.records.length && !speechesRef.current.length)) return;
    const checkpoint = revision.current;
    if (checkpoint === queuedRevision.current) return saveTask.current;
    queuedRevision.current = checkpoint;
    const snapshot = { ...sessionMeta.current, purpose:purposeRef.current, glossary:glossaryRef.current, updatedAt: new Date().toISOString(), replies: repliesRef.current,
      speeches: speechesRef.current.map(row => ({ ...row })), records: historyRef.current.records.map(row => ({ ...row })) };
    const next = mergeMeeting(archiveRef.current, snapshot, snapshot.records);
    archiveRef.current = next;
    saveCount.current++;
    if (notify && alive.current) { setSessions(next); setSaving(true); }
    const task = (async () => {
      try {
        await storeReady.current; await store.current.put(snapshot);
        savedRevision.current = checkpoint;
        if (notify && alive.current) setStorageError('');
        return true;
      } catch {
        queuedRevision.current = -1;
        if (notify && alive.current) setStorageError('회의 기록을 저장하지 못했어요. 저장 공간·권한을 확인하고 파일로 저장해 주세요.');
        return false;
      } finally { saveCount.current--; if (notify && alive.current && !saveCount.current) setSaving(false); }
    })();
    saveTask.current = task;
    return task;
  }
  async function newMeeting(draft) {
    if (archiveLoading || sessionBusy || preparingRef.current || starting) return false;
    setSessionBusy(true);
    try {
      await stopOwnVoice(false,{flush:true}); await ownQueue.current; await stop(); await speechQueue.current; await translationQueue.current;
      if (draft?.ko.trim()) {
        changeSpeeches(rows => {
          const old = rows.find(row => row.id === draft.id);
          if (old?.ko === draft.ko) return rows;
          const item = {id:draft.id, ko:draft.ko.trim(), en:'', status:'draft', input:'text', createdAt:old?.createdAt || Date.now()};
          return old ? rows.map(row => row.id === item.id ? item : row) : [...rows,item];
        });
      }
      if (await persistCurrent() === false) return false;
      await clear(); selectSpeaker('');
      sessionMeta.current = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      return true;
    } finally { setSessionBusy(false); }
  }
  async function openMeeting(id) {
    if (archiveLoading || composeBusy || active.current || starting || preparing || sessionBusy || isBusy()) return;
    const selected = archiveRef.current.find(item => item.id === id); if (!selected) return;
    if (await persistCurrent() === false) return;
    await clear(); selectSpeaker(''); sessionMeta.current = { id: selected.id, createdAt: selected.createdAt };
    setGlossary(selected.glossary||'');setMeetingPurpose(selected.purpose||'');mutateHistory(() => selected.records); setReplies(selected.replies || []); changeSpeeches(() => selected.speeches || []); setElapsed(0);
  }
  async function deleteMeeting(id) {
    if (active.current || sessionBusy || isBusy()) return;
    deletingSession.current = id; setSessionBusy(true);
    try {
      await storeReady.current; await store.current.remove(id);
      const next = archiveRef.current.filter(item => item.id !== id);
      archiveRef.current = next; setSessions(next);
      if (id === sessionMeta.current.id) { await clear(); selectSpeaker(''); sessionMeta.current = { id: crypto.randomUUID(), createdAt: new Date().toISOString() }; }
    } catch { setStorageError('기록을 삭제하지 못했어요.'); }
    finally { deletingSession.current = null; setSessionBusy(false); }
  }

  return { hasUnsaved: () => Boolean((historyRef.current.records.length || speechesRef.current.length) && savedRevision.current !== revision.current), testOwnSample, usage, meetingPurpose, changeMeetingPurpose:text=>{setMeetingPurpose(text.slice(0,300));revision.current++;}, voiceSpeaking, voiceStarting, voiceError, startOwnVoice, stopOwnVoice, newReplies, acceptNewReplies, language, draftLanguage, source, portable, speechProfile, glossary, changeGlossary: text => {setGlossary(text.slice(0, 2000));revision.current++;}, sessions, activeSessionId: sessionMeta.current.id, activeSessionDate: sessionMeta.current.createdAt, sessionBusy, storageError, archiveLoading, saving, speeches, composeBusy, newMeeting, openMeeting, deleteMeeting, preparing, ready, phase, progress, modelNames, error,
    listening, starting, stopping, level, elapsed, interim, partial, draftSample, records: history.records, characterCount: history.characterCount,
    charCount: history.characterCount, historyTrimmed: history.historyTrimmed, truncated: history.historyTrimmed > 0,
    pending, speechPending, translationPending, replies, replyBusy, replyError, canSuggest: ready && engine.current?.canSuggest,
    prepare, start, stop, testSample, changeLanguage, changeSource, changePortable, changeSpeechProfile, clear,
    availableProvider, chooseSpeechProvider, speechProvider, currentSpeaker, selectSpeaker, assignSpeaker, composeReply, suggestReplies, submitText, retryRecord, editRecord };
}
