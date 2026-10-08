import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Settings2, ChevronDown, Sparkles, Copy, Volume2, Radio, Check, Languages, ArrowUpRight, X, Headphones, RotateCcw } from 'lucide-react';
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
  const [settings, setSettings] = useState(false);
  const recognition = useRef(null);
  const timer = useRef(null);
  const [suggestions, setSuggestions] = useState(examples[0].reply);
  const speechAvailable = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => {
    if (!listening) { clearInterval(timer.current); return; }
    timer.current = setInterval(() => setElapsed(v => v + 1), 1000);
    return () => clearInterval(timer.current);
  }, [listening]);
  useEffect(() => () => recognition.current?.stop(), []);

  const formatTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const startListening = () => {
    if (!speechAvailable) { setNotice('이 브라우저에서는 음성 인식을 지원하지 않아요. Chrome에서 열어주세요.'); setTimeout(() => setNotice(''), 3500); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Recognition(); rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = e => {
      let finalText = '', liveText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += text; else liveText += text;
      }
      if (finalText) { setHeard(v => `${v}${v ? ' ' : ''}${finalText}`); setInterim(''); }
      else setInterim(liveText);
    };
    rec.onerror = e => { if (e.error === 'not-allowed') setNotice('마이크 권한을 허용해 주세요.'); else if (e.error !== 'no-speech') setNotice('음성을 인식하지 못했어요. 다시 시도해 주세요.'); setListening(false); };
    rec.onend = () => { if (recognition.current && listening) { try { rec.start(); } catch {} } };
    recognition.current = rec;
    try { rec.start(); setListening(true); setElapsed(0); setNotice(''); } catch { setNotice('마이크를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.'); }
  };
  const stopListening = () => { setListening(false); recognition.current?.stop(); recognition.current = null; setInterim(''); };
  const loadExample = () => { stopListening(); const i = (sample + 1) % examples.length; setSample(i); setHeard(examples[i].ko); setInterim(''); setSuggestions(examples[i].reply); setElapsed(0); };
  const current = examples.find(x => x.ko === heard) || examples[sample];
  const translated = heard ? (examples.find(x => x.ko === heard)?.en || (heard === examples[sample].ko ? examples[sample].en : '번역 결과가 여기에 표시됩니다')) : '';
  const copy = async text => { try { await navigator.clipboard.writeText(text); setNotice('복사했어요'); setTimeout(() => setNotice(''), 1800); } catch { setNotice('복사할 수 없어요'); setTimeout(() => setNotice(''), 1800); } };

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Languages size={19}/></span><span>live<span className="brand-accent">speak</span></span></a><div className="top-actions"><button className="subtle-button" onClick={() => setSettings(true)}><Settings2 size={17}/><span>설정</span></button><span className="profile">나</span></div></header>
    <main className="layout">
      <section className="intro"><div className="eyebrow"><span className="pulse-dot"/> REAL-TIME ENGLISH</div><h1>말하는 순간,<br/><span>영어가 이어져요.</span></h1><p>내 말을 자연스러운 영어로 바꾸고<br className="mobile-break"/> 다음 대화까지 준비해요.</p></section>
      <section className="workspace">
        <div className="session-head"><div><span className="section-kicker">LIVE SESSION</span><div className="session-title">한국어 <span className="arrow">→</span> English</div></div><div className="head-controls"><div className="mode-wrap"><button className="mode-button" onClick={() => setShowModes(v => !v)}><span className="mode-icon"><Sparkles size={14}/></span>{mode}<ChevronDown size={15}/></button>{showModes && <div className="mode-menu">{['비즈니스','일상 대화','면접','여행'].map(m => <button key={m} onClick={() => {setMode(m);setShowModes(false)}}>{m}{mode===m&&<Check size={15}/>}</button>)}</div>}</div><button className="icon-button" title="새 대화" onClick={() => {stopListening();setHeard('');setInterim('');setElapsed(0)}}><RotateCcw size={17}/></button></div></div>
        <div className="record-area"><div className={`record-orb ${listening?'recording':''}`}><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><button className="mic-button" onClick={listening?stopListening:startListening} aria-label={listening?'듣기 멈추기':'듣기 시작'}>{listening?<MicOff size={25}/>:<Mic size={25}/>}</button></div><div className="record-copy"><strong>{listening?'듣고 있어요':'눌러서 말해보세요'}</strong><span>{listening?`실시간 음성 인식 중 · ${formatTime(elapsed)}`:'마이크 버튼을 누르고 한국어로 말해보세요'}</span></div><div className={`live-badge ${listening?'is-live':''}`}><span/>{listening?'LIVE':'READY'}</div></div>
        <div className="transcript-card"><div className="card-label"><span className="label-icon"><Headphones size={15}/></span><span>내가 말한 내용</span>{listening&&<span className="listening-label"><i/> 듣는 중</span>}{(heard||interim)&&<button className="mini-action" onClick={() => copy(heard+(interim?` ${interim}`:''))}><Copy size={14}/></button>}</div><div className={`transcript-text ${!heard&&!interim?'placeholder':''}`}>{heard||(!interim?'여기에 인식된 문장이 표시돼요':'')}{interim&&<span className="interim">{heard?' ':''}{interim}</span>}</div></div>
        <div className={`translation-card ${heard?'has-result':''}`}><div className="card-label"><span className="translation-symbol">文</span><span>영어 번역</span>{heard&&<span className="quality-tag"><span/>자연스러운 표현</span>}{heard&&<button className="mini-action" onClick={() => copy(translated)}><Copy size={14}/></button>}</div><div className={`translation-text ${!heard?'placeholder':''}`}>{heard?translated:'번역 결과가 여기에 표시돼요'}</div>{heard&&<button className="listen-translation" onClick={() => {const u=new SpeechSynthesisUtterance(translated);u.lang='en-US';speechSynthesis.speak(u)}}><Volume2 size={15}/> 발음 듣기</button>}</div>
        <div className="suggestion-section"><div className="suggestion-heading"><div><span className="section-kicker">NEXT, YOU CAN SAY</span><h2>이렇게 답해보세요<span className="sparkle">✦</span></h2></div><span className="ai-chip"><Sparkles size={13}/> AI 제안</span></div><div className="reply-list">{(heard?suggestions:[{en:'상대방의 말을 들으면 답변을 제안해 드려요.',ko:'대화가 시작되면 맥락에 맞는 표현을 보여드릴게요.'}]).map((r,i)=><button className={`reply-card ${!heard?'empty-reply':''}`} key={i} onClick={() => heard&&copy(r.en)}><span className="reply-number">0{i+1}</span><span className="reply-content"><strong>{r.en}</strong><span>{r.ko}</span></span>{heard&&<span className="reply-copy"><Copy size={15}/></span>}</button>)}</div><p className="suggestion-note"><span>ⓘ</span> 대화 맥락을 바탕으로 한 답변 제안이에요</p></div>
        <div className="bottom-bar"><button className="text-button" onClick={() => {setHeard('');setInterim('')}}><X size={15}/> 내용 지우기</button><button className="demo-button" onClick={loadExample}><span className="demo-play">▶</span> 예시 대화로 체험하기 <ArrowUpRight size={15}/></button></div>
      </section>
      <div className="privacy-note"><span className="privacy-lock">✓</span> 녹음 내용은 이 기기에서만 처리되며 저장되지 않아요.</div>
    </main>
    {notice&&<div className="toast">{notice}</div>}
    {settings&&<div className="modal-backdrop" onClick={() => setSettings(false)}><div className="settings-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">PREFERENCES</span><h2>대화 설정</h2></div><button className="icon-button" onClick={() => setSettings(false)}><X size={18}/></button></div><label className="setting-row"><span><strong>대화 상황</strong><small>번역과 답변의 말투를 맞춰드려요</small></span><select value={mode} onChange={e=>setMode(e.target.value)}>{['비즈니스','일상 대화','면접','여행'].map(m=><option key={m}>{m}</option>)}</select></label><div className="setting-row"><span><strong>음성 인식</strong><small>한국어 음성을 실시간으로 받아써요</small></span><span className="setting-value">{speechAvailable?'브라우저 기본 인식':'지원 브라우저 필요'}</span></div><div className="modal-hint">더 빠르고 정확한 번역을 위해 실시간 번역 엔진을 연결할 수 있어요.</div></div></div>}
    <footer className="footer"><span>LIVE SPEAK</span><span>자연스럽게, 당신답게.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
