import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Settings2, ChevronDown, Sparkles, Copy, Check, Languages, X, Headphones, RotateCcw, ShieldCheck, Download, Cpu, LoaderCircle } from 'lucide-react';
import './styles.css';

function App() {
  const [listening, setListening] = useState(false);
  const [inputLanguage, setInputLanguage] = useState('ko-KR');
  const [inputSource, setInputSource] = useState('microphone');
  const [mode, setMode] = useState('비즈니스');
  const [showModes, setShowModes] = useState(false);
  const [heard, setHeard] = useState('');
  const [interim, setInterim] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState('');
  const [localAvailable, setLocalAvailable] = useState(false);
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [installingLocal, setInstallingLocal] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [sessionResetting, setSessionResetting] = useState(false);
  const [translationAvailable, setTranslationAvailable] = useState(false);
  const [assistantAvailable, setAssistantAvailable] = useState(false);
  const [modelPacksCached, setModelPacksCached] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [translated, setTranslated] = useState('');
  const [translationBusy, setTranslationBusy] = useState(false);
  const [replies, setReplies] = useState([]);
  const [replyBusy, setReplyBusy] = useState(false);
  const [modelError, setModelError] = useState('');
  const [settings, setSettings] = useState(false);
  const recognition = useRef(null);
  const sharedMeetingStream = useRef(null);
  const timer = useRef(null);
  const partialTranslationTimer = useRef(null);
  const replyTimer = useRef(null);
  const SpeechRecognition = typeof window !== 'undefined' && window.SpeechRecognition;
  const speechAvailable = Boolean(SpeechRecognition?.available && SpeechRecognition?.install);
  const TranslatorAPI = typeof window !== 'undefined' && window.Translator;
  const LanguageModelAPI = typeof window !== 'undefined' && window.LanguageModel;
  const translators = useRef({ en: null, ko: null });
  const languageSession = useRef(null);
  const translateSequence = useRef(0);
  const replySequence = useRef(0);
  const finalTextRef = useRef('');
  const sessionEpoch = useRef(0);
  const committedEnglishRef = useRef('');
  const committedTranslationRef = useRef('');
  const finalTranslationQueue = useRef(Promise.resolve());
  const autoPrepareStarted = useRef(false);

  useEffect(() => {
    let active = true;
    if (!speechAvailable) return;
    setCheckingLocal(true);
    Promise.all([
      SpeechRecognition.available({ langs: ['ko-KR'], processLocally: true, quality: 'conversation' }),
      SpeechRecognition.available({ langs: ['en-US'], processLocally: true, quality: 'conversation' })
    ])
      .then(statuses => { if (active) setLocalAvailable(statuses.every(status => status === 'available')); })
      .catch(() => { if (active) setLocalAvailable(false); })
      .finally(() => { if (active) setCheckingLocal(false); });
    return () => { active = false; };
  }, [speechAvailable, SpeechRecognition]);

  useEffect(() => {
    let active = true;
    Promise.all([
      TranslatorAPI?.availability?.({ sourceLanguage: 'ko', targetLanguage: 'en' }) ?? Promise.resolve('unavailable'),
      TranslatorAPI?.availability?.({ sourceLanguage: 'en', targetLanguage: 'ko' }) ?? Promise.resolve('unavailable'),
      LanguageModelAPI?.availability?.({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }) ?? Promise.resolve('unavailable')
    ]).then(([koToEn, enToKo, assistant]) => {
      if (!active) return;
      setTranslationAvailable(koToEn !== 'unavailable' && enToKo !== 'unavailable');
      setAssistantAvailable(assistant !== 'unavailable');
      setModelPacksCached(koToEn === 'available' && enToKo === 'available' && assistant === 'available');
    }).catch(() => {});
    return () => { active = false; };
  }, [TranslatorAPI, LanguageModelAPI]);

  useEffect(() => {
    if (localAvailable && modelPacksCached && !modelsReady && !installingLocal && !autoPrepareStarted.current) {
      autoPrepareStarted.current = true;
      initializeModels();
    }
  }, [localAvailable, modelPacksCached, modelsReady, installingLocal]);

  useEffect(() => {
    if (!listening) { clearInterval(timer.current); return; }
    timer.current = setInterval(() => setElapsed(v => v + 1), 1000);
    return () => clearInterval(timer.current);
  }, [listening]);
  useEffect(() => () => recognition.current?.stop(), []);

  const formatTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const flashNotice = message => { setNotice(message); setTimeout(() => setNotice(''), 4500); };
  const initializeModels = async () => {
    if (!speechAvailable || !TranslatorAPI?.create || !LanguageModelAPI?.create) { flashNotice('이 브라우저는 필요한 로컬 AI 기능을 지원하지 않아요. 최신 Chrome 데스크톱을 이용해 주세요.'); return; }
    setInstallingLocal(true);
    setModelError('');
    try {
      const speechStatus = await SpeechRecognition.available({ langs: ['ko-KR', 'en-US'], processLocally: true, quality: 'conversation' });
      if (speechStatus !== 'available') {
        const installed = await SpeechRecognition.install({ langs: ['ko-KR', 'en-US'], processLocally: true });
        if (!installed) throw new Error('한국어·영어 음성 인식 모델을 준비하지 못했어요.');
      }
      const installedStatus = await SpeechRecognition.available({ langs: ['ko-KR', 'en-US'], processLocally: true, quality: 'conversation' });
      if (installedStatus !== 'available') throw new Error('이 기기에서 한국어·영어 회의 음성 모델을 사용할 수 없어요.');
      setLocalAvailable(true);
      const makeTranslator = async (sourceLanguage, targetLanguage) => TranslatorAPI.create({ sourceLanguage, targetLanguage, monitor(monitor) { monitor.addEventListener('downloadprogress', event => { setModelProgress(Math.round(event.loaded * 100)); }); } });
      translators.current.ko = await makeTranslator('ko', 'en');
      translators.current.en = await makeTranslator('en', 'ko');
      languageSession.current = await createLanguageSession();
      setModelsReady(true);
      setModelProgress(100);
      flashNotice('기기 내 음성·번역·답변 모델 준비가 끝났어요.');
    } catch (error) {
      const message = error?.message || '이 기기에서 모델을 준비할 수 없어요.';
      setModelError(message); flashNotice(message);
    } finally { setInstallingLocal(false); }
  };
  const createLanguageSession = () => LanguageModelAPI.create({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    monitor(monitor) { monitor.addEventListener('downloadprogress', event => { setModelProgress(Math.round(event.loaded * 100)); }); }
  });
  const translateText = async (text, final = false, language = inputLanguage) => {
    if (!text.trim() || !translators.current.ko || !translators.current.en) return;
    const translate = language === 'ko-KR' ? translators.current.ko : translators.current.en;
    if (!final && translationBusy) return;
    if (final) {
      translateSequence.current++;
      const epoch = sessionEpoch.current;
      clearTimeout(replyTimer.current);
      finalTranslationQueue.current = finalTranslationQueue.current.then(async () => {
        if (epoch !== sessionEpoch.current) return;
        setTranslationBusy(true);
        const output = await translate.translate(text);
        if (epoch !== sessionEpoch.current) return;
        const englishContext = language === 'ko-KR' ? output : text;
        committedEnglishRef.current = `${committedEnglishRef.current}${committedEnglishRef.current ? ' ' : ''}${englishContext}`;
        committedTranslationRef.current = `${committedTranslationRef.current}${committedTranslationRef.current ? ' ' : ''}${output}`;
        setTranslated(committedTranslationRef.current);
        if (englishContext && languageSession.current) {
          clearTimeout(replyTimer.current);
          replyTimer.current = setTimeout(() => suggestReplies(committedEnglishRef.current), 1100);
        }
      }).catch(() => setModelError('기기 내 번역에 실패했어요.')).finally(() => setTranslationBusy(false));
      return;
    }
    const sequence = ++translateSequence.current;
    setTranslationBusy(true);
    try {
      const output = await translate.translate(text);
      if (sequence !== translateSequence.current) return;
      setTranslated(`${committedTranslationRef.current}${committedTranslationRef.current ? ' ' : ''}${output}`);
    } catch { if (sequence === translateSequence.current) setModelError('기기 내 번역에 실패했어요.'); }
    finally { if (sequence === translateSequence.current) setTranslationBusy(false); }
  };
  const suggestReplies = async englishContext => {
    if (!languageSession.current || !englishContext.trim()) return;
    const sequence = ++replySequence.current;
    setReplyBusy(true);
    try {
      const meetingMode = { '비즈니스': 'business', '일상 대화': 'casual', '면접': 'job interview', '여행': 'travel' }[mode] || 'business';
      const result = await languageSession.current.prompt(
        `You are a concise ${meetingMode} meeting interpreter assistant. Based only on this English meeting transcript, suggest exactly 2 natural English replies the Korean speaker could say next. Do not invent facts. Return JSON only as {"replies":["...","..."]}. Transcript: ${englishContext.slice(-1800)}`,
        { responseConstraint: { type: 'object', properties: { replies: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } }, required: ['replies'] } }
      );
      if (sequence !== replySequence.current) return;
      const parsed = JSON.parse(result);
      const translatedReplies = await Promise.all((parsed.replies || []).slice(0, 2).map(async en => ({ en, ko: await translators.current.en.translate(en) })));
      if (sequence === replySequence.current) setReplies(translatedReplies);
    } catch { if (sequence === replySequence.current) setModelError('기기 내 답변 제안을 만들지 못했어요.'); }
    finally { if (sequence === replySequence.current) setReplyBusy(false); }
  };
  const startListening = () => {
    if (!speechAvailable) { flashNotice('기기 내 처리를 보장하는 음성 인식이 이 브라우저에서 지원되지 않아요. 최신 Chrome을 사용해 주세요.'); return; }
    if (!localAvailable) { flashNotice('개인정보 보호를 위해 로컬 한국어 음성 모델을 먼저 준비해 주세요.'); return; }
    const rec = new SpeechRecognition(); rec.lang = inputLanguage; rec.continuous = true; rec.interimResults = true; rec.processLocally = true;
    rec.onresult = e => {
      let finalText = '', liveText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += text; else liveText += text;
      }
      if (finalText) {
        finalTextRef.current = `${finalTextRef.current}${finalTextRef.current ? ' ' : ''}${finalText}`;
        setHeard(finalTextRef.current); setInterim(''); clearTimeout(partialTranslationTimer.current); translateText(finalText, true, inputLanguage);
      } else {
        setInterim(liveText);
        if (liveText) {
          clearTimeout(partialTranslationTimer.current);
          partialTranslationTimer.current = setTimeout(() => translateText(liveText, false, inputLanguage), 350);
        }
      }
    };
    rec.onerror = e => { if (recognition.current === rec) recognition.current = null; if (e.error === 'not-allowed') setNotice('마이크 권한을 허용해 주세요.'); else if (e.error === 'language-not-supported' || e.error === 'language-unavailable') setNotice('한국어 로컬 음성 모델을 사용할 수 없어요.'); else if (e.error !== 'no-speech') setNotice('음성을 인식하지 못했어요. 다시 시도해 주세요.'); setListening(false); };
    rec.onend = () => { if (recognition.current === rec) { try { rec.start(); } catch {} } };
    recognition.current = rec;
    const beginRecognition = () => {
      try {
        const meetingAudio = sharedMeetingStream.current?.getAudioTracks().find(track => track.readyState === 'live');
        if (inputSource === 'meeting-tab') {
          if (!meetingAudio || typeof rec.start !== 'function') throw new Error('회의 탭 오디오를 음성 인식에 연결하지 못했어요.');
          rec.start(meetingAudio);
        } else rec.start();
        setListening(true); setElapsed(0); setNotice('');
      } catch (error) { flashNotice(error?.message || '마이크를 시작할 수 없어요. 다시 시도해 주세요.'); stopListening(); }
    };
    rec.onend = () => { if (recognition.current === rec) beginRecognition(); };
    recognition.current = rec;
    if (inputSource === 'meeting-tab') {
      if (!navigator.mediaDevices?.getDisplayMedia) { flashNotice('이 브라우저에서는 회의 탭 오디오 공유를 지원하지 않아요.'); return; }
      navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(stream => {
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) { stream.getTracks().forEach(track => track.stop()); recognition.current = null; flashNotice('공유할 때 회의 탭의 오디오도 선택해 주세요.'); return; }
        sharedMeetingStream.current = stream;
        audioTrack.onended = () => stopListening();
        beginRecognition();
      }).catch(() => { recognition.current = null; flashNotice('화면 공유가 취소됐어요. 회의 탭과 오디오 공유를 선택해 주세요.'); });
    } else beginRecognition();
  };
  const stopListening = () => { setListening(false); recognition.current?.stop(); recognition.current = null; sharedMeetingStream.current?.getTracks().forEach(track => track.stop()); sharedMeetingStream.current = null; setInterim(''); };
  const clearSession = async () => {
    stopListening(); clearTimeout(partialTranslationTimer.current); clearTimeout(replyTimer.current); sessionEpoch.current++;
    const epoch = sessionEpoch.current;
    finalTextRef.current = ''; committedEnglishRef.current = ''; committedTranslationRef.current = '';
    setHeard(''); setInterim(''); setTranslated(''); setReplies([]); setElapsed(0);
    translateSequence.current++; replySequence.current++; finalTranslationQueue.current = Promise.resolve();
    if (modelsReady && LanguageModelAPI?.create) {
      setSessionResetting(true);
      const previous = languageSession.current;
      languageSession.current = null;
      previous?.destroy?.();
      try { const fresh = await createLanguageSession(); if (epoch === sessionEpoch.current) languageSession.current = fresh; else fresh.destroy?.(); }
      catch { setModelError('새 대화용 로컬 AI 세션을 다시 준비하지 못했어요.'); }
      finally { setSessionResetting(false); }
    }
  };
  const chooseLanguage = language => { if (listening) stopListening(); sessionEpoch.current++; translateSequence.current++; replySequence.current++; clearTimeout(replyTimer.current); setInputLanguage(language); committedTranslationRef.current = ''; setTranslated(''); setInterim(''); setReplies([]); };
  const chooseInputSource = source => { if (listening) stopListening(); setInputSource(source); };
  const copy = async text => { try { await navigator.clipboard.writeText(text); setNotice('복사했어요'); setTimeout(() => setNotice(''), 1800); } catch { setNotice('복사할 수 없어요'); setTimeout(() => setNotice(''), 1800); } };

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Languages size={19}/></span><span>live<span className="brand-accent">speak</span></span></a><div className="top-actions"><button className="subtle-button" onClick={() => setSettings(true)}><Settings2 size={17}/><span>설정</span></button><span className="profile">나</span></div></header>
    <main className="layout">
      <section className="intro"><div className="eyebrow"><span className="pulse-dot"/> ON-DEVICE MEETING ASSISTANT</div><h1>회의 음성은 기기에,<br/><span>영어도 기기 안에서.</span></h1><p>음성과 전사 내용을 외부 서버로 보내지 않아요.<br className="mobile-break"/> 첫 모델 준비 후엔 바로 시작합니다.</p></section>
      <section className="workspace">
        <div className="session-head"><div><span className="section-kicker">LIVE SESSION</span><div className="session-title">{inputLanguage==='ko-KR'?'한국어':'English'} <span className="arrow">→</span> {inputLanguage==='ko-KR'?'English':'한국어'}</div></div><div className="head-controls"><div className="mode-wrap"><button className="mode-button" onClick={() => setShowModes(v => !v)}><span className="mode-icon"><Sparkles size={14}/></span>{mode}<ChevronDown size={15}/></button>{showModes && <div className="mode-menu">{['비즈니스','일상 대화','면접','여행'].map(m => <button key={m} onClick={() => {setMode(m);setShowModes(false)}}>{m}{mode===m&&<Check size={15}/>}</button>)}</div>}</div><button className="icon-button" title="새 대화" onClick={clearSession}><RotateCcw size={17}/></button></div></div>
        <div className="input-options"><div className="segmented-control" aria-label="음성 입력">{[['microphone','마이크'],['meeting-tab','회의 탭 오디오']].map(([value,label])=><button key={value} className={inputSource===value?'selected':''} onClick={() => chooseInputSource(value)}>{label}</button>)}</div><div className="language-toggle" aria-label="말하는 언어">{[['ko-KR','한국어'],['en-US','English']].map(([value,label])=><button key={value} className={inputLanguage===value?'selected':''} onClick={() => chooseLanguage(value)}>{label}</button>)}</div></div>
        {inputSource==='meeting-tab'&&<p className="meeting-source-note">시작 후 회의 탭과 ‘탭 오디오 공유’를 선택해 주세요. 영상은 처리하지 않습니다.</p>}
        <div className="record-area"><div className={`record-orb ${listening?'recording':''}`}><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><button className="mic-button" onClick={listening?stopListening:startListening} aria-label={listening?'듣기 멈추기':'듣기 시작'} disabled={!modelsReady||sessionResetting}>{listening?<MicOff size={25}/>:<Mic size={25}/>}</button></div><div className="record-copy"><strong>{listening?'기기 안에서 듣고 있어요':sessionResetting?'새 대화 준비 중':modelsReady?'눌러서 말해보세요':checkingLocal?'로컬 AI 기능 확인 중':speechAvailable&&translationAvailable&&assistantAvailable?'로컬 모델을 준비해 주세요':'이 브라우저는 로컬 AI 기능을 지원하지 않아요'}</strong><span>{listening?`기기 내 실시간 처리 · ${formatTime(elapsed)}`:modelsReady?'전사·번역·답변 모두 기기 안에서 처리':'모델 최초 준비 시 브라우저가 언어 모델을 내려받습니다'}</span></div><div className={`live-badge ${listening?'is-live':''}`}><span/>{listening?'LOCAL':'LOCAL ONLY'}</div></div>
        {!modelsReady&&!listening&&<div className="local-model-panel"><div className="local-model-icon"><ShieldCheck size={17}/></div><div className="local-model-copy"><strong>{modelPacksCached&&localAvailable?'기기 모델 불러오는 중':'한국어·영어 모델 다운로드'}</strong><span>{speechAvailable&&translationAvailable&&assistantAvailable?'한국어·영어 음성 인식, 번역과 답변 모델을 Chrome에 준비합니다. 다운로드 뒤 회의 음성과 텍스트는 기기에서만 처리합니다.': 'Chrome 데스크톱과 지원 기기가 필요합니다. 일부 로컬 AI 기능이 이 브라우저에서 지원되지 않아요.'}{installingLocal&&` 준비 진행률 ${modelProgress}%`}</span>{modelError&&<span className="model-error">{modelError}</span>}</div><button className="install-button" onClick={initializeModels} disabled={installingLocal||!(speechAvailable&&translationAvailable&&assistantAvailable)}>{installingLocal?<span className="spinner"/>:<Download size={14}/>} {installingLocal?'다운로드 중':modelPacksCached&&localAvailable?'불러오는 중':'모델 다운로드'}</button></div>}
        <div className="transcript-card"><div className="card-label"><span className="label-icon"><Headphones size={15}/></span><span>내가 말한 내용</span>{listening&&<span className="listening-label"><i/> 듣는 중</span>}{(heard||interim)&&<button className="mini-action" onClick={() => copy(heard+(interim?` ${interim}`:''))}><Copy size={14}/></button>}</div><div className={`transcript-text ${!heard&&!interim?'placeholder':''}`}>{heard||(!interim?'여기에 인식된 문장이 표시돼요':'')}{interim&&<span className="interim">{heard?' ':''}{interim}</span>}</div></div>
        <div className={`translation-card ${translated?'has-result':''}`}><div className="card-label"><span className="translation-symbol">文</span><span>영어 번역</span>{translationBusy&&<LoaderCircle className="loading-icon" size={13}/>}<span className="quality-tag"><span/>기기 내 번역</span>{translated&&<button className="mini-action" onClick={() => copy(translated)}><Copy size={14}/></button>}</div><div className={`translation-text ${!translated?'placeholder':''}`}>{translated||'말하면 영어 번역이 여기에 표시돼요'}{interim&&translatedKo&&<small className="back-translation">한국어 확인: {translatedKo}</small>}</div></div>
        <div className="suggestion-section"><div className="suggestion-heading"><div><span className="section-kicker">NEXT, YOU CAN SAY</span><h2>이렇게 답해보세요<span className="sparkle">✦</span></h2></div><span className="ai-chip"><Cpu size={13}/> 기기 내 AI</span></div><div className="reply-list">{replies.length?replies.map((reply,index)=><button className="reply-card" key={`${index}-${reply.en}`} onClick={() => copy(reply.en)}><span className="reply-number">0{index+1}</span><span className="reply-content"><strong>{reply.en}</strong><span>{reply.ko}</span></span><span className="reply-copy"><Copy size={15}/></span></button>):<div className="reply-card empty-reply"><span className="reply-number">01</span><span className="reply-content"><strong>{replyBusy?'회의 맥락을 보고 답변을 만들고 있어요':'전사된 내용에 맞는 답변을 여기에 제안해요'}</strong><span>{replyBusy?'답변 생성도 기기 안에서 처리 중입니다':'말을 마치면 다음에 할 수 있는 영어 답변을 보여드려요'}</span></span></div>}</div><p className="suggestion-note"><span>ⓘ</span> 번역된 회의 맥락을 바탕으로 한 로컬 AI 제안입니다</p></div>
        <div className="bottom-bar"><button className="text-button" onClick={clearSession}><X size={15}/> 내용 지우기</button><span className="local-ready-label"><ShieldCheck size={13}/> 이 대화는 기기에서 처리</span></div>
      </section>
      <div className="privacy-note"><span className="privacy-lock"><ShieldCheck size={13}/></span> 로컬 음성 인식 외에는 연결하지 않으며 음성·전사는 전송되지 않아요.</div>
    </main>
    {notice&&<div className="toast">{notice}</div>}
    {settings&&<div className="modal-backdrop" onClick={() => setSettings(false)}><div className="settings-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">PREFERENCES</span><h2>회의 설정</h2></div><button className="icon-button" onClick={() => setSettings(false)}><X size={18}/></button></div><label className="setting-row"><span><strong>대화 상황</strong><small>답변 제안의 말투에 반영</small></span><select value={mode} onChange={e=>setMode(e.target.value)}>{['비즈니스','일상 대화','면접','여행'].map(m=><option key={m}>{m}</option>)}</select></label><div className="setting-row"><span><strong>기기 내 모델</strong><small>음성 인식 · 번역 · 답변 제안</small></span><span className="setting-value">{modelsReady?'준비 완료':checkingLocal?'지원 확인 중':speechAvailable&&translationAvailable&&assistantAvailable?'준비 가능':'이 브라우저에서 미지원'}</span></div><div className="modal-hint">최초 사용 시 Chrome이 필요한 음성·번역 모델을 내려받습니다. 회의 음성과 전사 내용은 로컬 모델 API로만 처리합니다. 답변 생성 모델의 한국어 지원은 기기와 브라우저에 따라 제한될 수 있습니다.</div></div></div>}
    <footer className="footer"><span>LIVE SPEAK</span><span>자연스럽게, 당신답게.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
