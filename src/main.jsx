import {LOCAL_QWEN} from './qwen-live.mjs';
import {WindowsInstallGuide} from './WindowsInstallGuide.jsx';
import {useLocalQwenReady} from './useLocalQwenReady.js';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Pause, Square, Maximize2, ArrowDown, ArrowRight, Check, ChevronDown, Copy, Download, FileText, Languages, LoaderCircle, Mic, MicOff, Pencil, Play, Send, Settings2, ShieldCheck, Sparkles, Trash2, Plus, CalendarDays, X } from 'lucide-react';
import { useMeeting } from './useMeeting.js';
import './styles.css';
import './maestra.css';
import {meetingExport} from './meeting-export.mjs';
import {PanelDivider,readPanelSize} from './PanelDivider.jsx';

const languageName = language => language === 'ko-KR' ? '한국어' : 'English';
const targetName = language => language === 'ko-KR' ? 'English' : '한국어';
const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

// Rebase the default to the middle size without reinterpreting old preferences.
const READING_KEY='meeting-screen-size-v3';
const SCREEN_SIZES=[{label:'−',value:2,name:'화면 축소'},{label:'기본',value:1,name:'기본 화면 크기'},{label:'+',value:0,name:'화면 확대'}];
function ReadingSizeControl({value,onChange}){
  return <div className="reading-controls" role="group" aria-label="화면 크기"><span>화면 크기</span><div>{SCREEN_SIZES.map(option=><button type="button" key={option.value} aria-label={option.name} aria-pressed={value===option.value} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div></div>;
}

function Dialog({ title, onClose, children, className = '', actions }) {
  const dialog = useRef(null),titleId=useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')?.focus();
    const onKey = event => {
      if (event.key === 'Escape' && dialog.current?.contains(document.activeElement)) { event.preventDefault(); close.current(); }
      if(event.key !== 'Tab' || !dialog.current?.contains(document.activeElement))return;
      const elements = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className={`modal-backdrop ${className==='meeting-room'?'meeting-backdrop':''}`} onClick={event=>{if(event.target===event.currentTarget&&className!=='meeting-room')onClose();}}><section ref={dialog} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}><div className="dialog-head"><h2 id={titleId}>{title}</h2><div className="dialog-head-actions">{actions}<button className="icon-button" onClick={onClose} aria-label="닫기"><X size={21}/></button></div></div>{children}</section></div>;
}

const workingRecord=record=>record.status==='recognizing'||record.status==='translating'||record.status==='recovering';
function SpeechComposer({ meeting, copy, active, readingSize }) {
  const [text,setText] = useState(''),[editingSpeech,setEditingSpeech]=useState(null);
  const resultArea = useRef(null), follow = useRef(true);
  useEffect(()=>setText(''),[meeting.activeSessionId]);
  useLayoutEffect(()=>{if(follow.current && resultArea.current)resultArea.current.scrollTop=resultArea.current.scrollHeight;},[meeting.speeches, active, readingSize]);
  useLayoutEffect(()=>{const element=resultArea.current;if(!element||!window.ResizeObserver)return;const observer=new ResizeObserver(()=>{if(follow.current)element.scrollTop=element.scrollHeight;});observer.observe(element);return()=>observer.disconnect();},[]);
  const submit = event => { event.preventDefault(); if(!meeting.ready || meeting.composeBusy || !text.trim())return; const value=text; setText(''); void meeting.composeReply(value,editingSpeech);setEditingSpeech(null); };
  return <section className="speech-pane" aria-label="한국어 음성 또는 입력으로 영어 발언 만들기"><div className="pane-heading"><h2><Send size={14}/>내 발언 만들기</h2><span>한국어 <ArrowRight size={12}/> 영어</span></div>
    <div className="speech-input-modes"><button type="button" className={meeting.voiceSpeaking?'primary-button is-listening':'secondary-button'} disabled={!meeting.ready || meeting.voiceStarting || meeting.sessionBusy || meeting.starting || meeting.stopping} onClick={()=>meeting.voiceSpeaking?meeting.stopOwnVoice():meeting.startOwnVoice()}>{meeting.voiceStarting?<LoaderCircle size={15} className="spin"/>:meeting.voiceSpeaking?<MicOff size={15}/>:<Mic size={15}/>} {meeting.voiceStarting?'마이크 연결 중':meeting.voiceSpeaking?'내 발언 마침':'한국어로 말하기'}</button><span role="status">{meeting.voiceSpeaking?'내 발언 듣는 중':'또는 아래에 입력'}</span></div>
    {meeting.voiceError && <p className="row-error" role="alert">{meeting.voiceError}</p>}
    <div className="speech-results" ref={resultArea} role="region" aria-label="직접 입력한 영어 발언 목록" tabIndex={0} onScroll={()=>{const el=resultArea.current;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<64;}}>
      {!meeting.speeches.length && <div className="composer-empty">한국어로 말하거나 입력하면 영어가 여기에 쌓여요</div>}
      {meeting.speeches.map((item,index)=><article className="speech-result" key={item.id}><div className="speech-result-meta"><span>{index+1}</span><span role="status">{item.status === 'recognizing' ? '내 발언 인식 중' : item.status === 'recovering' ? '다시 연결 중' : item.status === 'writing' ? '영어 작성 중' : item.status === 'error' ? '작성 미완료' : ''}</span><button className="icon-button" onClick={()=>copy(item.en)} disabled={!item.en || item.status!=='complete'} aria-label={`${index+1}번 직접 입력 영어 복사`}><Copy size={13}/></button></div><p className="speech-korean" lang="ko">{item.ko}</p>{!['recognizing','writing','recovering'].includes(item.status) && <button type="button" className="text-button speech-edit" disabled={meeting.composeBusy} onClick={()=>{setText(item.ko);setEditingSpeech(item.id);document.getElementById('speech-input')?.focus();}}>원문 수정</button>}<p className="speech-english" lang="en">{item.en || '작성 중…'}</p>{item.status === 'error' && <div className="row-error" role="alert">{item.error}<button disabled={!meeting.ready || meeting.composeBusy} onClick={()=>meeting.composeReply(item.ko,item.id)}>다시 변환</button></div>}</article>)}
    </div>
    <form className="speech-form" onSubmit={submit}><label htmlFor="speech-input">{editingSpeech?'원문 수정 · Enter로 다시 변환':'한국어 입력 · Enter로 변환'}</label><textarea id="speech-input" value={text} maxLength={1800} rows={3} onChange={event=>setText(event.target.value)} placeholder="예: 제안은 이해했지만, 내부 검토를 마친 후 확답드리겠습니다." onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing)submit(event);}}/><div className="speech-form-actions"><span>{text.length.toLocaleString()} / 1,800</span><button className="primary-button" disabled={!meeting.ready || meeting.composeBusy || !text.trim() || meeting.sessionBusy}>{meeting.composeBusy ? <LoaderCircle size={14} className="spin"/> : <ArrowRight size={14}/>}영어로 변환</button></div></form>
  </section>;
}

function MeetingHistory({ meeting, locked, onDelete }) {
  const groups = new Map();
  for (const session of meeting.sessions) {
    const date = new Date(session.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(session);
  }
  return <section className="meeting-history" aria-labelledby="history-heading"><div className="section-heading"><div><CalendarDays size={19}/><h2 id="history-heading">회의 기록</h2><span>{meeting.sessions.length}개</span></div></div>
    {meeting.storageError && <p className="session-error" role="alert">{meeting.storageError}</p>}
    {!groups.size && <p className="history-empty">아직 회의가 없어요</p>}
    {[...groups].map(([date, sessions]) => <div className="history-date-group" key={date}><h3>{date}</h3><div className="history-list">{sessions.map(session => <article className={`history-item ${session.id === meeting.activeSessionId ? 'current' : ''}`} key={session.id}><button className="history-open" disabled={locked} onClick={() => meeting.openMeeting(session.id)} aria-label={`${new Date(session.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 회의 열기`}><time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time><span><strong>{session.records[0]?.original || session.speeches?.[0]?.ko || '회의'}</strong><small>{session.records.length}개 발화 · {session.id === meeting.activeSessionId ? '현재 보는 회의' : '열기'}</small></span><ArrowRight size={17}/></button><button className="icon-button history-delete" aria-label="이 회의 기록 삭제" disabled={locked} onClick={() => onDelete(session.id)}><Trash2 size={16}/></button></article>)}</div></div>)}

  </section>;
}

function LiveTranscript({meeting,mode,size,copy,edit,search,onEnableTranslation}){
 const area=useRef(null),previousBox=useRef(null),[follow,setFollow]=useState(true),[baseline,setBaseline]=useState(0),[ratio,setRatio]=useState(50);
 const rows=meeting.records.filter(r=>!search||`${r.original} ${r.translation}`.toLowerCase().includes(search.toLowerCase()));
 useLayoutEffect(()=>{if(follow&&area.current)area.current.scrollTop=area.current.scrollHeight;},[meeting.records,follow,size,mode,ratio,search]);
 useLayoutEffect(()=>{const element=area.current;if(!element||!follow||!window.ResizeObserver)return;const observer=new ResizeObserver(()=>{element.scrollTop=element.scrollHeight;});observer.observe(element);return()=>observer.disconnect();},[follow]);
 const original=meeting.records.map(r=>r.original).join('\n');
 return <section className="live-sheet" aria-label="실시간 회의 기록" style={{'--split':`${ratio}%`}}>
  <PanelDivider axis="x" value={ratio} onChange={setRatio} label="원문과 번역 너비 조절" min={25} max={75} defaultValue={50}/>
  <div className="column-labels"><span>원문<button aria-label="원문 전체 복사" onClick={()=>copy(original)}><Copy size={13}/></button></span><span>한국어 번역{mode==='transcript'&&<button className="enable-translation" onClick={onEnableTranslation}>번역 켜기</button>}<button aria-label="번역 전체 복사" onClick={()=>copy(meeting.records.map(r=>r.language==='ko-KR'?r.original:r.translation||'').join('\n'))}><Copy size={13}/></button></span></div>
  <div className="live-scroll" ref={area} tabIndex={0} role="region" aria-label="누적 원문과 번역" onScroll={()=>{const e=area.current,box=`${e.clientWidth}:${e.clientHeight}`;if(previousBox.current!==box){previousBox.current=box;if(follow)e.scrollTop=e.scrollHeight;return;}if(follow&&e.scrollHeight-e.scrollTop-e.clientHeight>60){setFollow(false);setBaseline(meeting.records.length);}}}>
   <div className="continuous-columns">
    <p className="continuous-text continuous-source" aria-label="누적 원문">{!rows.length&&<span className="empty-column">{search?'일치하는 기록이 없습니다':'말씀하시면 원문이 여기에 쌓입니다'}</span>}{rows.map(r=><React.Fragment key={r.id}><span className={r.sourcePending?'pending-text':''} lang={r.language==='ko-KR'?'ko':'en'} title="원문을 두 번 누르면 수정할 수 있습니다" onDoubleClick={()=>{if(!workingRecord(r)&&meeting.ready)edit({...r});}}>{r.original.replace(/\s+/g,' ').trim()}</span>{' '}</React.Fragment>)}</p>
    <p className="continuous-text continuous-translation" lang="ko" aria-label="누적 한국어 번역">{(!rows.length||rows.every(r=>r.transcriptOnly&&!r.translation&&r.language!=='ko-KR'))&&<span className="empty-column">{search?'일치하는 번역이 없습니다':mode==='transcript'?'번역을 켜면 이후 영어 발화를 한국어로 표시합니다':'한국어 번역이 여기에 쌓입니다'}</span>}{rows.map(r=><React.Fragment key={r.id}><span className={!r.translation&&r.language!=='ko-KR'?'pending-text':''}>{(r.language==='ko-KR'?r.original:r.translation|| (r.transcriptOnly?'':r.status==='error'?'[번역 미완료]':'…')).replace(/\s+/g,' ').trim()}</span>{r.status==='error'&&<button className="inline-retry" disabled={!meeting.ready||r.sourcePending} onClick={()=>meeting.retryRecord(r.id)}>다시 번역</button>}{' '}</React.Fragment>)}</p>
   </div>
  </div>{!follow&&<button className="follow-button" onClick={()=>setFollow(true)}><ArrowDown size={12}/>실시간으로 {meeting.records.length>baseline?`· 새 발화 ${meeting.records.length-baseline}개`:''}</button>}
 </section>;
}
function App(){
 const localModel=useLocalQwenReady(LOCAL_QWEN);
 const [mode,setMode]=useState(LOCAL_QWEN?'transcript':'translate'),[guideVisible,setGuideVisible]=useState(true),[speechVisible,setSpeechVisible]=useState(false),[autoGuides,setAutoGuides]=useState(!LOCAL_QWEN);
 const meeting=useMeeting({transcribeOnly:mode==='transcript',guidesEnabled:autoGuides&&guideVisible});
 const [screen,setScreen]=useState('setup'),[settings,setSettings]=useState(false),[history,setHistory]=useState(false),[editing,setEditing]=useState(null),[deleting,setDeleting]=useState(null),[notice,setNotice]=useState(''),[pendingStart,setPendingStart]=useState(false),[ended,setEnded]=useState(false),[search,setSearch]=useState('');
 const [size,setSize]=useState(()=>{try{const value=Number(localStorage.getItem('maestra-density-v3'));return [11,12,13,14,15,16,17].includes(value)?value:14;}catch{return 14;}});
 const [dockHeight,setDockHeight]=useState(18);
 const [exportOpen,setExportOpen]=useState(false),[exportBusy,setExportBusy]=useState(false),[exportOptions,setExportOptions]=useState({format:'txt',content:'both',timestamps:true,guides:false,speeches:false});
 const busy=meeting.preparing||meeting.starting||meeting.stopping||meeting.sessionBusy;
 const locked=busy||meeting.listening||meeting.voiceSpeaking||meeting.composeBusy||meeting.pending>0;
 const notify=text=>setNotice(text);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{try{localStorage.setItem('maestra-density-v3',String(size));}catch{}},[size]);
 useEffect(()=>{if(pendingStart&&meeting.ready&&!busy){setPendingStart(false);void meeting.start();}else if(pendingStart&&meeting.error&&!meeting.preparing)setPendingStart(false);},[pendingStart,meeting.ready,busy,meeting.error]);
 const copy=async text=>{try{await navigator.clipboard.writeText(text);notify('복사했습니다');}catch{notify('복사 권한을 확인해 주세요');}};
 const begin=async()=>{if(locked)return;if(await meeting.newMeeting()===false)return;setScreen('live');setEnded(false);setSearch('');setPendingStart(true);if(!meeting.ready)void meeting.prepare();};
 const resume=()=>{setEnded(false);if(meeting.ready)void meeting.start();else{setPendingStart(true);void meeting.prepare();}};
 const finish=async()=>{setPendingStart(false);await meeting.stopOwnVoice(false,{flush:true});await meeting.stop();setEnded(true);};
 const openHistory=async id=>{const saved=meeting.sessions.find(s=>s.id===id);setMode(saved?.records.length&&saved.records.every(r=>r.transcriptOnly||r.language==='ko-KR')?'transcript':'translate');await meeting.openMeeting(id);setHistory(false);setScreen('live');setEnded(true);setSearch('');if(!meeting.ready)void meeting.prepare();};
 const download=async()=>{setExportBusy(true);try{const blob=await meetingExport(meeting,exportOptions),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`미팅-${new Date(meeting.activeSessionDate).toLocaleDateString('sv-SE')}.${exportOptions.format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('파일을 내보냈습니다');setExportOpen(false);}catch{notify('파일 생성에 실패했습니다. 다시 시도해 주세요.');}finally{setExportBusy(false);}};
 return <div className={`maestra-app ${screen==='setup'?'setup-view':''}`} style={{'--caption-size':`${size}px`,'--dock-height':`${dockHeight}%`}}>
 {screen==='setup'?<main className="setup-main"><div className="setup-box"><h1>오늘 어떤 회의를 시작할까요?</h1><div className="mode-switch"><button aria-pressed={mode==='translate'} onClick={()=>setMode('translate')}><Languages size={14}/>받아쓰기 + 번역</button><button aria-pressed={mode==='transcript'} onClick={()=>setMode('transcript')}><FileText size={14}/>받아쓰기만</button></div><div className="language-pair"><select aria-label="발화 언어" value={meeting.language} onChange={e=>meeting.changeLanguage(e.target.value)}><option value="auto">언어 감지 · 영어 / 한국어</option><option value="en-US">English</option><option value="ko-KR">한국어</option></select><ArrowRight size={16}/><span>{mode==='translate'?'한국어':'원문 그대로'}</span></div><div className="setup-options"><select aria-label="음성 입력" value={meeting.source} onChange={e=>meeting.changeSource(e.target.value)}><option value="microphone">마이크</option><option value="meeting-tab" disabled={!navigator.mediaDevices?.getDisplayMedia}>회의 탭 오디오</option></select><label><input type="checkbox" checked={autoGuides} onChange={e=>setAutoGuides(e.target.checked)}/>추천 답변</label></div><div className="start-area"><span>누르고 말하기 시작</span><button className="record-button" aria-label="새 회의 시작" disabled={locked||meeting.archiveLoading||!localModel.ready} onClick={begin}><Mic size={30}/></button></div>{LOCAL_QWEN&&<p className="privacy-mini" role="status">{localModel.message}</p>}<p className="privacy-mini">{LOCAL_QWEN?'음성은 이 컴퓨터의 Qwen에서, 번역·추천 답변은 Google에서 처리합니다.':'음성과 텍스트를 Google로 전송해 처리합니다.'}</p>{!LOCAL_QWEN&&<WindowsInstallGuide/>}</div></main>:<main className="live-main">
 <header className="live-top"><span>{new Date(meeting.activeSessionDate).toLocaleDateString('ko-KR')} · {meeting.records.length}개 발화</span><span role="status">{meeting.preparing||meeting.starting?'연결 중':meeting.stopping?'마무리 중':meeting.listening?'● 듣는 중':ended?'회의 종료됨':'일시정지'} {meeting.elapsed>0&&formatTime(meeting.elapsed)} {meeting.pending>0&&`· ${meeting.pending}건 처리 중`}</span><input aria-label="회의 기록 검색" placeholder="기록 검색" value={search} onChange={e=>setSearch(e.target.value)}/></header>
 {(meeting.error||meeting.storageError)&&<div role="alert" className="live-error">{meeting.error||meeting.storageError}<button onClick={resume} disabled={busy}>다시 연결</button></div>}
 <LiveTranscript meeting={meeting} mode={mode} size={size} copy={copy} edit={setEditing} search={search} onEnableTranslation={()=>{setMode('translate');notify('이후 영어 발화부터 한국어로 번역합니다');}}/>
 {(guideVisible||speechVisible)&&<PanelDivider axis="y" value={dockHeight} onChange={setDockHeight} label="보조 영역 높이 조절" min={12} max={45} defaultValue={18}/>}
 {(guideVisible||speechVisible)&&<div className={`assistance-dock ${guideVisible&&speechVisible?'two-docks':''}`}>
 {guideVisible&&<section className="compact-guide" aria-label="추천 답변 가이드"><header><strong><Sparkles size={12}/>추천 답변 가이드</strong><div>{meeting.newReplies&&<button onClick={meeting.acceptNewReplies}>새 가이드 보기</button>}<button disabled={!meeting.canSuggest||meeting.replyBusy} onClick={()=>meeting.suggestReplies('비즈니스')}>{meeting.replyBusy?'작성 중…':'새로 제안'}</button><button disabled={!meeting.canSuggest||meeting.replyBusy||!meeting.replies.length} onClick={()=>meeting.suggestReplies('비즈니스',{count:2,alternatives:true})}>대안 보기</button><button onClick={()=>setGuideVisible(false)} aria-label="답변 가이드 숨기기">숨기기 <X size={12}/></button></div></header>{meeting.replyError&&<p role="alert">{meeting.replyError}</p>}<div className="compact-replies">{meeting.replies.length?meeting.replies.map((r,i)=><button className="compact-reply" key={`${i}-${r.en}`} aria-label={`${i+1}번 영어 답변 복사`} onClick={()=>copy(r.en)}><small>{r.sourceAt&&`${new Date(r.sourceAt).toLocaleTimeString('ko-KR')} 발화 기준`}{r.fallback?' · 기본 확인 질문':''}</small><span lang="ko">{r.ko}</span><strong lang="en">{r.en}</strong><Copy size={11}/></button>):<p className="dock-empty">영어 질문에 맞는 한국어·영어 답변을 준비합니다.</p>}</div></section>}
 {speechVisible&&<section className="compact-speech"><header><strong>내 발언 만들기</strong><button onClick={()=>setSpeechVisible(false)} aria-label="내 발언 만들기 숨기기">숨기기 <X size={12}/></button></header><SpeechComposer meeting={meeting} copy={copy} active={speechVisible} readingSize={size}/></section>}
 </div>}
 </main>}
 <footer className="fixed-controls"><div className="footer-left"><span className="mini-brand"><Languages size={15}/>석변의 미팅 뿌시기</span><button disabled={locked} onClick={()=>setHistory(true)}><FileText size={12}/>회의 기록</button>{screen!=='setup'&&<button disabled={locked} onClick={()=>setScreen('setup')}>새 회의</button>}</div><div className="footer-center">{screen==='live'&&<>{ended?<><button disabled={busy||meeting.voiceSpeaking} onClick={resume} aria-label="회의 이어하기"><Play size={12}/>이어하기</button><span className="saved-state">{meeting.storageError?'저장 실패':meeting.saving?'저장 중':'회의 종료됨'}</span><button onClick={()=>setExportOpen(true)} disabled={!meeting.records.length&&!meeting.speeches.length}><Download size={13}/>내보내기</button></>:<><button aria-label={meeting.listening?'일시정지':'재개'} disabled={busy} onClick={()=>meeting.listening?meeting.stop():resume()}>{meeting.listening?<Pause size={14}/>:<Play size={14}/>}<span>{meeting.listening?'일시정지':'재개'}</span></button><button className="stop-button" disabled={busy} onClick={finish}><Square size={12}/>종료</button></>}</>}</div><div className="footer-right">{screen==='live'&&<><button aria-pressed={guideVisible} onClick={()=>setGuideVisible(v=>!v)}>답변 가이드</button><button aria-pressed={speechVisible} onClick={()=>setSpeechVisible(v=>!v)}>내 발언</button></>}<button aria-label="설정" onClick={()=>setSettings(true)}><Settings2 size={14}/></button>{screen==='live'&&<button aria-label="전체 화면" onClick={()=>document.fullscreenElement?document.exitFullscreen?.():document.documentElement.requestFullscreen?.().catch(()=>notify('이 브라우저에서는 전체 화면을 사용할 수 없습니다'))}><Maximize2 size={14}/></button>}</div></footer>
 {notice&&<div className="toast" role="status">{notice}</div>}
 {history&&<Dialog title="회의 기록" onClose={()=>setHistory(false)} className="history-dialog"><MeetingHistory meeting={{...meeting,openMeeting:openHistory}} locked={locked} onDelete={setDeleting}/></Dialog>}
 {exportOpen&&<Dialog title="회의 내보내기" onClose={()=>setExportOpen(false)}><div className="export-form"><label>파일 형식<select aria-label="파일 형식" value={exportOptions.format} onChange={e=>setExportOptions({...exportOptions,format:e.target.value})}><option value="txt">TXT</option><option value="docx">DOCX</option><option value="json">JSON</option></select></label><label>내용<select aria-label="내보낼 내용" value={exportOptions.content} onChange={e=>setExportOptions({...exportOptions,content:e.target.value})}><option value="both">원문 + 번역</option><option value="original">원문</option><option value="translation">번역</option></select></label>{[['timestamps','시각 포함'],['guides','추천 답변 포함'],['speeches','내 발언 초안 포함']].map(([key,label])=><label key={key}><input type="checkbox" checked={exportOptions[key]} onChange={e=>setExportOptions({...exportOptions,[key]:e.target.checked})}/>{label}</label>)}{meeting.records.some(r=>r.status!=='complete')&&<p>진행 중이거나 미완료인 문장이 포함됩니다.</p>}<button className="primary-button" disabled={exportBusy} onClick={download}>{exportBusy?'파일 만드는 중…':'다운로드'}</button></div></Dialog>}
 {editing&&<Dialog title="원문 수정" onClose={()=>setEditing(null)}><form className="edit-source" onSubmit={e=>{e.preventDefault();if(meeting.editRecord(editing.id,editing.original,editing.language))setEditing(null);}}><textarea aria-label="수정할 원문" value={editing.original} onChange={e=>setEditing({...editing,original:e.target.value})}/><button className="primary-button" disabled={!editing.original.trim()}>저장 · 다시 번역</button></form></Dialog>}
 {deleting&&<Dialog title="이 회의를 삭제할까요?" onClose={()=>setDeleting(null)}><p>삭제 후에는 복구할 수 없습니다.</p><button className="primary-button" onClick={()=>{meeting.deleteMeeting(deleting);setDeleting(null);}}>삭제</button></Dialog>}
 {settings&&<Dialog title="회의 설정" onClose={()=>setSettings(false)}><div className="export-form"><label>글자 크기<select aria-label="글자 크기" value={size} onChange={e=>setSize(Number(e.target.value))}>{[11,12,13,14,15,16,17].map(value=><option key={value} value={value}>{value===14 ? '기본 · 14px' : `${value}px`}</option>)}</select></label><label><input type="checkbox" checked={mode==='translate'} onChange={e=>setMode(e.target.checked?'translate':'transcript')}/>한국어 번역 · 이후 발화부터 적용</label><label><input type="checkbox" checked={autoGuides} onChange={e=>setAutoGuides(e.target.checked)}/>추천 답변 자동 생성</label><label>회의 용어 · 이름<textarea aria-label="회의 용어" value={meeting.glossary} maxLength={2000} onChange={e=>meeting.changeGlossary(e.target.value)}/></label><label>회의 목적 · 내 입장<textarea aria-label="회의 목적과 내 입장" value={meeting.meetingPurpose} maxLength={300} onChange={e=>meeting.changeMeetingPurpose(e.target.value)}/></label><p>{LOCAL_QWEN?'Qwen3-ASR 1.7B · 이 컴퓨터에서 음성 처리. 번역·추천 답변 텍스트는 Google로 전송합니다. 녹음 파일은 저장하지 않습니다.':'음성과 텍스트는 Google에서 처리하며 회의 기록은 이 브라우저에 저장됩니다. 녹음 파일은 저장하지 않습니다.'}</p><small>BUILD {__BUILD_ID__}</small></div></Dialog>}
 </div>;
}

const root = import.meta.hot?.data.root || createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App/>);
