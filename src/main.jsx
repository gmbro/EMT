import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Settings2, ChevronDown, Sparkles, Copy, Check, Languages, X, Headphones, RotateCcw, ShieldCheck, Download, Cpu, LoaderCircle, Play, Send } from 'lucide-react';
import { useMeeting } from './useMeeting.js';
import './styles.css';

function App() {
  const meeting = useMeeting();
  const [mode, setMode] = useState('비즈니스');
  const [showModes, setShowModes] = useState(false);
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const locked = meeting.listening || meeting.starting || meeting.stopping || meeting.preparing || meeting.pending > 0 || meeting.replyBusy;
  const latest = meeting.records.filter(record => record.language === meeting.language).at(-1);
  const sourceName = meeting.language === 'ko-KR' ? '한국어' : 'English';
  const targetName = meeting.language === 'ko-KR' ? '영어' : '한국어';
  const transcript = meeting.interim || latest?.original || '';
  const translated = meeting.partial || latest?.translation || '';
  const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); setNotice('복사했어요'); }
    catch { setNotice('복사 권한을 확인해 주세요'); }
    setTimeout(() => setNotice(''), 2000);
  };

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><Languages size={19}/></span><span>석변의 하비 뿌시기</span></a><div className="top-actions"><button className="subtle-button" onClick={() => setSettings(true)}><Settings2 size={17}/><span>설정</span></button></div></header>
    <main className="layout">
      <section className="intro"><div className="eyebrow"><span className="pulse-dot"/> ON-DEVICE MEETING INTERPRETER</div><h1>현장에서 말하면,<br/><span>기기 안에서 통역.</span></h1><p>한국어 ↔ 영어 음성과 번역을 기기에서 처리합니다.<br/>처음 모델을 준비한 뒤 마이크를 눌러주세요.</p></section>
      <section className="guide-panel" aria-labelledby="guide-title">
        <div className="guide-heading"><ShieldCheck size={17}/><h2 id="guide-title">이렇게 시작하세요</h2><span>1 · 2 · 3</span></div>
        <ol className="guide-steps">
          <li><span className="guide-number">1</span><div><strong>말하는 언어 선택</strong><p>한국어를 영어로, 영어를 한국어로 통역해요.</p></div></li>
          <li><span className="guide-number">2</span><div><strong>‘통역 준비’ 누르기</strong><p>필요한 기기 모델만 준비해요. 처음에는 Wi-Fi에서 다운로드해 주세요.</p></div></li>
          <li><span className="guide-number">3</span><div><strong>마이크 누르고 말하기</strong><p>마이크 권한을 허용하세요. 짧은 문장 단위로 번역이 이어집니다.</p></div></li>
        </ol>
        <p className="guide-security"><ShieldCheck size={14}/> 모델 파일은 이 사이트에서 내려받고, 회의 음성·전사·번역은 기기에 남습니다. 처리 속도는 기기 성능과 발화 길이에 따라 달라요.</p>
      </section>
      <section className="workspace" aria-label="실시간 통역">
        <div className="session-head"><div><span className="section-kicker">LIVE SESSION</span><div className="session-title">{sourceName} <span className="arrow">→</span> {targetName}</div></div><div className="head-controls"><div className="mode-wrap"><button className="mode-button" onClick={() => setShowModes(value => !value)} aria-expanded={showModes}><Sparkles size={14}/>{mode}<ChevronDown size={15}/></button>{showModes&&<div className="mode-menu">{['비즈니스','일상 대화','면접','여행'].map(item=><button key={item} onClick={() => {setMode(item);setShowModes(false);}}>{item}{mode===item&&<Check size={15}/>}</button>)}</div>}</div><button className="icon-button" title="내용 지우기" aria-label="내용 지우기" onClick={meeting.clear} disabled={meeting.preparing||meeting.replyBusy}><RotateCcw size={17}/></button></div></div>
        <div className="input-options"><div className="segmented-control" role="group" aria-label="음성 입력">{[['microphone','마이크'],['meeting-tab','회의 탭 오디오']].map(([value,label])=><button key={value} className={meeting.source===value?'selected':''} onClick={() => meeting.changeSource(value)} disabled={locked||(value==='meeting-tab'&&!navigator.mediaDevices?.getDisplayMedia)} aria-pressed={meeting.source===value}>{label}</button>)}</div><div className="language-toggle" role="group" aria-label="말하는 언어">{[['ko-KR','한국어'],['en-US','English']].map(([value,label])=><button key={value} className={meeting.language===value?'selected':''} onClick={() => meeting.changeLanguage(value)} disabled={locked} aria-pressed={meeting.language===value}>{label}</button>)}</div></div>
        {meeting.source==='meeting-tab'&&<p className="meeting-source-note">회의 탭과 ‘탭 오디오 공유’를 함께 선택하세요. 캡처한 영상은 읽거나 저장하지 않아요.</p>}
        <div className={`local-model-panel ${meeting.ready?'model-is-ready':''}`}>
          <div className="local-model-icon"><ShieldCheck size={20}/></div>
          <div className="local-model-copy"><strong>{meeting.ready?'기기 내 통역 준비 완료':meeting.preparing?'통역 모델 준비 중':'선택한 언어의 통역 준비'}</strong><span role="status" aria-live="polite">{meeting.preparing?meeting.phase:meeting.ready?`${meeting.modelNames?.speech} · ${meeting.modelNames?.translation}`:'브라우저 내장 모델이 없으면 호환 모델을 내려받아요. 첫 준비는 수분이 걸릴 수 있어요.'}</span>{!meeting.ready&&!meeting.preparing&&<span>호환 모델 최초 다운로드: 한국어→영어 약 233MB / 영어→한국어 약 756MB. 다음에는 브라우저 캐시를 재사용합니다.</span>}{meeting.preparing&&meeting.progress!==null&&<progress max="100" value={meeting.progress} aria-label="모델 준비 진행률"/>}</div>
          {!meeting.ready&&<button className="install-button" onClick={meeting.prepare} disabled={locked}>{meeting.preparing?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>} {meeting.preparing?'준비 중':'통역 준비'}</button>}
        </div>
        {meeting.error&&<div className="session-error" role="alert">{meeting.error}</div>}
        <div className="record-area">
          <div className={`record-orb ${meeting.listening?'recording':''}`}><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><button className="mic-button" onClick={() => meeting.listening?meeting.stop():meeting.start()} aria-label={meeting.listening?'듣기 멈추기':'듣기 시작'} disabled={!meeting.listening&&(!meeting.ready||locked)}>{meeting.starting?<LoaderCircle className="spin" size={25}/>:meeting.listening?<MicOff size={25}/>:<Mic size={25}/>}</button></div>
          <div className="record-copy"><strong>{meeting.listening?'기기 안에서 듣고 있어요':meeting.stopping?'마지막 문장 정리 중':meeting.starting?'음성 입력 준비 중':meeting.pending?`남은 ${meeting.pending}개 문장 통역 중`:meeting.ready?'마이크를 눌러 말해보세요':'위에서 ‘통역 준비’를 눌러주세요'}</strong><span>{meeting.listening?`${formatTime(meeting.elapsed)} · 잠깐 쉬면 문장을 번역합니다`:meeting.ready?'주변 소음이 적을수록 인식이 정확해져요':'준비가 끝나면 듣기 버튼이 켜집니다'}</span></div>
          {meeting.listening&&<div className="audio-meter" aria-label="마이크 음량"><span style={{width:`${Math.min(100,meeting.level*1200)}%`}}/></div>}
          <div className={`live-badge ${meeting.listening?'is-live':''}`}><span/>{meeting.listening?'LOCAL LIVE':'LOCAL ONLY'}</div>
        </div>
        <div className="sample-row"><button className="sample-button" onClick={meeting.testSample} disabled={!meeting.ready||locked}><Play size={14}/> 예제 음성으로 확인</button><span>마이크 없이 인식·번역을 확인해요</span></div>
        <div className="transcript-card"><div className="card-label"><Headphones size={16}/><span>들리는 내용 · {sourceName}</span>{meeting.listening&&<span className="listening-label"><i/> 듣는 중</span>}{transcript&&<button className="mini-action" aria-label="원문 복사" onClick={() => copy(transcript)}><Copy size={15}/></button>}</div><div className={`transcript-text ${transcript?'':'placeholder'}`}>{transcript||'말한 내용이 여기에 표시돼요'}</div></div>
        <div className="translation-card"><div className="card-label"><Languages size={16}/><span>{targetName} 번역</span>{meeting.pending>0&&<LoaderCircle className="loading-icon" size={14}/>}<span className="quality-tag"><span/>기기 내 번역</span>{translated&&<button className="mini-action" aria-label="번역 복사" onClick={() => copy(translated)}><Copy size={15}/></button>}</div><div className={`translation-text ${translated?'':'placeholder'}`}>{translated||'짧은 문장이 인식되면 번역을 보여드려요'}</div></div>
        {latest&&<p className="latency-note">{latest.sample?'예제 음성':'최근 문장'} · {latest.duration?`음성 ${latest.duration.toFixed(1)}초 · `:''}처리 {(latest.milliseconds/1000).toFixed(1)}초{latest.waitMilliseconds-latest.milliseconds>500?` · 대기 포함 ${(latest.waitMilliseconds/1000).toFixed(1)}초`:''}</p>}
        {meeting.records.length>0&&<details className="meeting-history"><summary>이번 대화 {meeting.records.length}개 문장 보기</summary><div>{meeting.records.map((record,index)=><article className="history-item" key={record.id}><small>{String(index+1).padStart(2,'0')} · {record.language==='ko-KR'?'한국어 → 영어':'영어 → 한국어'}{record.sample?' · 예제':''}</small><p>{record.original}</p><strong>{record.translation}</strong><button className="mini-action" aria-label={`${index+1}번 번역 복사`} onClick={() => copy(record.translation)}><Copy size={14}/></button></article>)}</div></details>}
        <section className="suggestion-section" aria-labelledby="reply-title"><div className="suggestion-heading"><div><span className="section-kicker">YOUR NEXT REPLY</span><h2 id="reply-title">영어 답변 준비<span className="sparkle">✦</span></h2></div><span className="ai-chip"><Cpu size={13}/> 기기 내 처리</span></div>
          <form className="reply-compose" onSubmit={event => {event.preventDefault();meeting.composeReply(replyDraft);}}><label htmlFor="reply-draft">한국어로 답변을 쓰면 영어로 바꿔드려요</label><textarea id="reply-draft" value={replyDraft} onChange={event=>setReplyDraft(event.target.value)} placeholder="예: 자료를 확인하고 내일까지 답변드리겠습니다." rows={2} maxLength={1000}/><div><span>{meeting.listening?'답변 준비는 듣기를 멈춘 뒤 사용하세요.':'음성 통역과 같은 로컬 번역 모델을 사용합니다.'}</span><button className="install-button" disabled={!meeting.ready||locked||!replyDraft.trim()}>{meeting.replyBusy?<LoaderCircle size={14} className="spin"/>:<Send size={14}/>} 영어로 만들기</button></div></form>
          {meeting.canSuggest&&<button className="sample-button auto-reply-button" onClick={()=>meeting.suggestReplies(mode)} disabled={!meeting.records.length||locked}><Sparkles size={14}/> 대화에 맞는 답변 제안</button>}
          {meeting.replyError&&<p className="model-error" role="alert">{meeting.replyError}</p>}
          <div className="reply-list">{meeting.replies.map((reply,index)=><button className="reply-card" key={`${index}-${reply.en}`} onClick={()=>copy(reply.en)}><span className="reply-number">0{index+1}</span><span className="reply-content"><strong>{reply.en}</strong><span>{reply.ko}</span></span><Copy size={15}/></button>)}</div>
        </section>
        <div className="bottom-bar"><button className="text-button" onClick={meeting.clear} disabled={meeting.preparing||meeting.replyBusy}><X size={15}/> 내용 지우기</button><span className="local-ready-label"><ShieldCheck size={13}/> 회의 내용 서버 전송 없음</span></div>
      </section>
      <p className="privacy-note">회의 내용은 이 탭의 메모리에만 유지됩니다. 새로고침하거나 내용을 지우면 사라집니다.</p>
    </main>
    {notice&&<div className="toast" role="status">{notice}</div>}
    {settings&&<div className="modal-backdrop" onClick={()=>setSettings(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event=>event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">PREFERENCES</span><h2 id="settings-title">회의 설정</h2></div><button className="icon-button" aria-label="설정 닫기" onClick={()=>setSettings(false)}><X size={18}/></button></div><label className="setting-row"><span><strong>호환 모델 사용</strong><small>브라우저 기본 모델이 계속 실패하면 켜주세요</small></span><input type="checkbox" checked={meeting.portable} disabled={locked} onChange={event=>meeting.changePortable(event.target.checked)}/></label><div className="setting-row"><span><strong>음성 모델</strong><small>{meeting.modelNames?.speech||'통역 준비 후 표시됩니다'}</small></span><span className="setting-value">{meeting.ready?'준비 완료':'준비 전'}</span></div><div className="modal-hint">브라우저 기본 모델을 먼저 사용하고, 사용할 수 없으면 이 사이트의 Whisper·OPUS-MT·M2M100 모델을 내려받아 기기에서 실행합니다. 구형 기기에서는 다운로드 또는 메모리 부족으로 준비가 실패하거나 통역이 느릴 수 있어요. 자동 답변 제안은 별도 지원 기기에서만 표시되며, 통역 시작을 막지 않습니다.</div><a className="model-license-link" href="/model-licenses.md" target="_blank" rel="noreferrer">모델 출처와 라이선스</a><small className="build-id">BUILD {__BUILD_ID__}</small></section></div>}
    <footer className="footer"><span>석변의 하비 뿌시기</span><span>한국어와 영어, 기기 안에서.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
