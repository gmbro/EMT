import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Settings2, ChevronDown, Sparkles, Copy, Volume2, Check, Languages, ArrowUpRight, X, Headphones, RotateCcw, ShieldCheck, Download, Cpu } from 'lucide-react';
import './styles.css';

const examples = [
  { ko: '안녕하세요, 오늘 시간 내주셔서 감사합니다.', en: 'Hi, thank you for taking the time to meet with me today.', reply: [{ en: 'It’s my pleasure. I’m glad we could connect.', ko: '저도 기쁩니다. 이렇게 이야기 나눌 수 있어 좋네요.' }, { en: 'Of course. I’ve been looking forward to our conversation.', ko: '물론이죠. 오늘 대화를 기대하고 있었어요.' }] },
  { ko: '이번 프로젝트의 일정과 우선순위에 대해 이야기하고 싶어요.', en: 'I’d like to talk about the timeline and priorities for this project.', reply: [{ en: 'Absolutely. Which milestones should we focus on first?', ko: '물론이죠. 어떤 주요 일정을 먼저 살펴볼까요?' }, { en: 'Sure. Let’s start with the target launch date.', ko: '좋아요. 목표 출시일부터 이야기해 봐요.' }] },
  { ko: '다음 주 화요일 오후에 미팅 가능하신가요?', en: 'Would you be available for a meeting next Tuesday afternoon?', reply: [{ en: 'Yes, I’m available. What time works best for you?', ko: '네, 시간 괜찮아요. 몇 시가 가장 좋으세요?' }, { en: 'Tuesday afternoon is a little tricky. Would Wednesday work?', ko: '화요일 오후는 조금 어려울 것 같아요. 수요일은 괜찮으세요?' }] }
];

function App() {
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState('비즈니스');
  const [showModes, setShowModes] = useState(false);
  const [sample, setSample] = useState(0);
  const [heard, setHeard] = useState('');
  const [interim, setInterim] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState('');
  const [localAvailable, setLocalAvailable] = useState(false);
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [installingLocal, setInstallingLocal] = useState(false);
  const [settings, setSettings] = useState(false);
  const recognition = useRef(null);
  const timer = useRef(null);
  const [suggestions, setSuggestions] = useState(examples[0].reply);
  const SpeechRecognition = typeof window !== 'undefined' && window.SpeechRecognition;
  const speechAvailable = Boolean(SpeechRecognition?.available && SpeechRecognition?.install);

  useEffect(() => {
    let active = true;
    if (!speechAvailable) return;
    setCheckingLocal(true);
    SpeechRecognition.available({ langs: ['ko-KR'], processLocally: true, quality: 'conversation' })
      .then(status => { if (active) setLocalAvailable(status === 'available'); })
      .catch(() => { if (active) setLocalAvailable(false); })
      .finally(() => { if (active) setCheckingLocal(false); });
    return () => { active = false; };
  }, [speechAvailable, SpeechRecognition]);

  useEffect(() => {
    if (!listening) { clearInterval(timer.current); return; }
    timer.current = setInterval(() => setElapsed(v => v + 1), 1000);
    return () => clearInterval(timer.current);
  }, [listening]);
  useEffect(() => () => recognition.current?.stop(), []);

  const formatTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const flashNotice = message => { setNotice(message); setTimeout(() => setNotice(''), 4500); };
  const installLocalSpeech = async () => {
    if (!speechAvailable) { flashNotice('이 브라우저에는 로컬 음성 인식 기능이 없어요. 최신 Chrome에서 이용해 주세요.'); return; }
    setInstallingLocal(true);
    try {
      const installed = await SpeechRecognition.install({ langs: ['ko-KR'], processLocally: true });
      if (!installed) { flashNotice('한국어 음성 인식 모델을 설치하지 못했어요.'); return; }
      const status = await SpeechRecognition.available({ langs: ['ko-KR'], processLocally: true, quality: 'conversation' });
      setLocalAvailable(status === 'available');
      if (status !== 'available') flashNotice('이 기기에서 회의용 한국어 인식 모델을 사용할 수 없어요.');
      else flashNotice('한국어 로컬 음성 인식 준비가 끝났어요.');
    } catch (error) {
      flashNotice(error?.name === 'NotAllowedError' ? '로컬 음성 인식 권한이 차단되어 있어요.' : '로컬 음성 인식 모델을 준비할 수 없어요.');
    } finally { setInstallingLocal(false); }
  };
  const startListening = () => {
    if (!speechAvailable) { flashNotice('기기 내 처리를 보장하는 음성 인식이 이 브라우저에서 지원되지 않아요. 최신 Chrome을 사용해 주세요.'); return; }
    if (!localAvailable) { flashNotice('개인정보 보호를 위해 로컬 한국어 음성 모델을 먼저 준비해 주세요.'); return; }
    const rec = new SpeechRecognition(); rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true; rec.processLocally = true;
    rec.onresult = e => {
      let finalText = '', liveText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += text; else liveText += text;
      }
      if (finalText) { setHeard(v => `${v}${v ? ' ' : ''}${finalText}`); setInterim(''); }
      else setInterim(liveText);
    };
    rec.onerror = e => { if (e.error === 'not-allowed') setNotice('마이크 권한을 허용해 주세요.'); else if (e.error === 'language-not-supported' || e.error === 'language-unavailable') setNotice('한국어 로컬 음성 모델을 사용할 수 없어요.'); else if (e.error !== 'no-speech') setNotice('음성을 인식하지 못했어요. 다시 시도해 주세요.'); setListening(false); };
    rec.onend = () => { if (recognition.current && listening) { try { rec.start(); } catch {} } };
    recognition.current = rec;
    try { rec.start(); setListening(true); setElapsed(0); setNotice(''); } catch { setNotice('마이크를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
  };
  const stopListening = () => { setListening(false); recognition.current?.stop(); recognition.current = null; setInterim(''); };
  const loadExample = () => { stopListening(); const i = (sample + 1) % examples.length; setSample(i); setHeard(''); setInterim(''); setSuggestions([]); setElapsed(0); flashNotice('예시 문구는 데모이며 번역 결과가 아니에요.'); };
  const translated = '';
  const copy = async text => { try { await navigator.clipboard.writeText(text); setNotice('복사했어요'); setTimeout(() => setNotice(''), 1800); } catch { setNotice('복사할 수 없어요'); setTimeout(() => setNotice(''), 1800); } };

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Languages size={19}/></span><span>live<span className="brand-accent">speak</span></span></a><div className="top-actions"><button className="subtle-button" onClick={() => setSettings(true)}><Settings2 size={17}/><span>설정</span></button><span className="profile">나</span></div></header>
    <main className="layout">
      <section className="intro"><div className="eyebrow"><span className="pulse-dot"/> ON-DEVICE MEETING ASSISTANT</div><h1>회의 음성은 기기에,<br/><span>영어도 기기 안에서.</span></h1><p>음성과 전사 내용을 외부 서버로 보내지 않아요.<br className="mobile-break"/> 기기가 지원하는 로컬 모델로 처리합니다.</p></section>
      <section className="workspace">
        <div className="session-head"><div><span className="section-kicker">LIVE SESSION</span><div className="session-title">한국어 <span className="arrow">→</span> English</div></div><div className="head-controls"><div className="mode-wrap"><button className="mode-button" onClick={() => setShowModes(v => !v)}><span className="mode-icon"><Sparkles size={14}/></span>{mode}<ChevronDown size={15}/></button>{showModes && <div className="mode-menu">{['비즈니스','일상 대화','면접','여행'].map(m => <button key={m} onClick={() => {setMode(m);setShowModes(false)}}>{m}{mode===m&&<Check size={15}/>}</button>)}</div>}</div><button className="icon-button" title="새 대화" onClick={() => {stopListening();setHeard('');setInterim('');setElapsed(0)}}><RotateCcw size={17}/></button></div></div>
        <div className="record-area"><div className={`record-orb ${listening?'recording':''}`}><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><button className="mic-button" onClick={listening?stopListening:startListening} aria-label={listening?'듣기 멈추기':'듣기 시작'}>{listening?<MicOff size={25}/>:<Mic size={25}/>}</button></div><div className="record-copy"><strong>{listening?'기기 안에서 듣고 있어요':localAvailable?'눌러서 말해보세요':checkingLocal?'로컬 음성 기능 확인 중':speechAvailable?'기기 내 한국어 모델이 필요해요':'로컬 음성 인식 미지원 브라우저'}</strong><span>{listening?`로컬 음성 인식 중 · ${formatTime(elapsed)}`:'음성 인식 전용 · 번역 모델은 아직 연결되지 않았어요'}</span></div><div className={`live-badge ${listening?'is-live':''}`}><span/>{listening?'LOCAL':'LOCAL ONLY'}</div></div>
        {!localAvailable&&!listening&&<div className="local-model-panel"><div className="local-model-icon"><ShieldCheck size={17}/></div><div className="local-model-copy"><strong>기기 내 음성 인식</strong><span>{speechAvailable?'한국어 모델을 이 기기에 준비합니다. 음성과 전사는 네트워크로 보내지 않습니다.':'이 브라우저는 로컬 음성 인식 API를 지원하지 않습니다.'}</span></div>{speechAvailable&&<button className="install-button" onClick={installLocalSpeech} disabled={installingLocal||checkingLocal}>{installingLocal?<span className="spinner"/>:<Download size={14}/>} {installingLocal?'준비 중':'모델 준비'}</button>}</div>}
        <div className="transcript-card"><div className="card-label"><span className="label-icon"><Headphones size={15}/></span><span>내가 말한 내용</span>{listening&&<span className="listening-label"><i/> 듣는 중</span>}{(heard||interim)&&<button className="mini-action" onClick={() => copy(heard+(interim?` ${interim}`:''))}><Copy size={14}/></button>}</div><div className={`transcript-text ${!heard&&!interim?'placeholder':''}`}>{heard||(!interim?'여기에 인식된 문장이 표시돼요':'')}{interim&&<span className="interim">{heard?' ':''}{interim}</span>}</div></div>
        <div className={`translation-card ${heard?'has-result':''}`}><div className="card-label"><span className="translation-symbol">文</span><span>영어 번역</span><span className="not-connected">번역 모델 미연결</span></div><div className="translation-text placeholder">기기 내 영어 번역 모델을 연결하면 여기에 표시돼요</div></div>
        <div className="suggestion-section"><div className="suggestion-heading"><div><span className="section-kicker">NEXT, YOU CAN SAY</span><h2>이렇게 답해보세요<span className="sparkle">✦</span></h2></div><span className="ai-chip"><Cpu size={13}/> 로컬 모델 필요</span></div><div className="reply-list"><div className="reply-card empty-reply"><span className="reply-number">01</span><span className="reply-content"><strong>기기 내 번역·언어 모델을 연결해야 답변을 제안할 수 있어요.</strong><span>아직 실제 답변 생성 기능은 구현되지 않았어요.</span></span></div></div><p className="suggestion-note"><span>ⓘ</span> 회의 맥락도 기기 안에서만 처리하도록 설계합니다</p></div>
        <div className="bottom-bar"><button className="text-button" onClick={() => {setHeard('');setInterim('')}}><X size={15}/> 내용 지우기</button><button className="demo-button" onClick={loadExample}><span className="demo-play">▶</span> 예시 대화로 체험하기 <ArrowUpRight size={15}/></button></div>
      </section>
      <div className="privacy-note"><span className="privacy-lock"><ShieldCheck size={13}/></span> 로컬 음성 인식 외에는 연결하지 않으며 음성·전사는 전송되지 않아요.</div>
    </main>
    {notice&&<div className="toast">{notice}</div>}
    {settings&&<div className="modal-backdrop" onClick={() => setSettings(false)}><div className="settings-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">PREFERENCES</span><h2>대화 설정</h2></div><button className="icon-button" onClick={() => setSettings(false)}><X size={18}/></button></div><label className="setting-row"><span><strong>대화 상황</strong><small>향후 로컬 번역 모델의 말투 설정</small></span><select value={mode} onChange={e=>setMode(e.target.value)}>{['비즈니스','일상 대화','면접','여행'].map(m=><option key={m}>{m}</option>)}</select></label><div className="setting-row"><span><strong>로컬 음성 인식</strong><small>네트워크 전송 없이 인식</small></span><span className="setting-value">{localAvailable?'사용 가능':checkingLocal?'확인 중':speechAvailable?'모델 필요':'브라우저 미지원'}</span></div><div className="modal-hint">영어 번역과 답변 제안 모델은 아직 연결되지 않았습니다. 완전한 오프라인 사용에는 기기에 모델을 내려받아 실행하는 기능이 필요합니다.</div></div></div>}
    <footer className="footer"><span>LIVE SPEAK</span><span>자연스럽게, 당신답게.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
