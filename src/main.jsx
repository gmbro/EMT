import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowRight, Check, ChevronDown, Copy, Download, FileText, Languages, LoaderCircle, Mic, MicOff, Play, Send, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useMeeting } from './useMeeting.js';
import './styles.css';

const languageName = language => language === 'ko-KR' ? '한국어' : 'English';
const targetName = language => language === 'ko-KR' ? 'English' : '한국어';
const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function Dialog({ title, onClose, children, className = '' }) {
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('button, input, select, textarea, [tabindex="0"]')?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><section ref={dialog} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={event => event.stopPropagation()}><div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={21}/></button></div>{children}</section></div>;
}

function CaptionRow({ record, index, copy, retry, locked }) {
  const working = record.status === 'recognizing' || record.status === 'translating';
  return <article className={`caption-row ${record.status === 'error' ? 'has-error' : ''}`} aria-label={`${index + 1}번째 문장`}>
    <div className="caption-meta"><span className="sentence-number">{String(index + 1).padStart(2, '0')}</span><span>{record.sample ? '예제 음성' : record.input === 'text' ? '직접 입력' : '대화'}</span>{record.milliseconds > 0 && !working && <span className="processing-time">처리 {(record.milliseconds / 1000).toFixed(1)}초</span>}<button className="row-copy icon-button" aria-label={`${index + 1}번 문장 복사`} onClick={() => copy(`${record.original}\n${record.translation || ''}`)} disabled={!record.original}><Copy size={15}/></button></div>
    <div className="caption-line original-line"><span className="language-label" lang={record.language === 'ko-KR' ? 'ko' : 'en'}>{languageName(record.language)}</span><p lang={record.language === 'ko-KR' ? 'ko' : 'en'}>{record.original || <span className="caption-placeholder">음성을 글로 바꾸고 있어요…</span>}</p></div>
    <div className="caption-line translated-line"><span className="language-label">{targetName(record.language)}</span><div><p lang={record.language === 'ko-KR' ? 'en' : 'ko'}>{record.translation || (record.status === 'error' ? <span className="caption-placeholder">번역을 완료하지 못했어요.</span> : <span className="caption-placeholder"><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span> {record.status === 'recognizing' ? '음성 인식 후 번역해요' : '기기에서 번역 중'}</span>)}</p>{working && record.translation && <span className="row-status">번역 중…</span>}{record.status === 'error' && <div className="row-error"><span>{record.error || '원문은 그대로 남아 있어요.'}</span>{retry && <button onClick={() => retry(record.id)} disabled={locked}>다시 번역</button>}</div>}</div></div>
  </article>;
}

function App() {
  const meeting = useMeeting();
  const [settings, setSettings] = useState(false);
  const [clearPrompt, setClearPrompt] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const [inputOpen, setInputOpen] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [followLatest, setFollowLatest] = useState(true);
  const [hasNewText, setHasNewText] = useState(false);
  const transcript = useRef(null);
  const following = useRef(true);
  const noticeTimer = useRef(null);
  const locked = meeting.listening || meeting.starting || meeting.stopping || meeting.preparing || meeting.pending > 0 || meeting.replyBusy;
  const charCount = meeting.charCount ?? meeting.characterCount ?? meeting.records.reduce((n, row) => n + [...(row.original || ''), ...(row.translation || '')].length, 0);
  const trimmed = meeting.truncated ?? meeting.historyTrimmed;
  const draftLanguage = meeting.draftLanguage || meeting.language;
  const hasDraft = Boolean(meeting.interim);
  const readyStatus = meeting.listening ? '듣는 중' : meeting.starting ? '입력 준비 중' : meeting.stopping ? '마무리 중' : meeting.pending ? '번역 중' : meeting.ready ? '준비 완료' : meeting.preparing ? '모델 준비 중' : '준비 전';

  useEffect(() => { if (meeting.ready || meeting.records.length) setGuideOpen(false); }, [meeting.ready, meeting.records.length]);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useLayoutEffect(() => {
    const area = transcript.current;
    if (!area) return;
    if (following.current) { area.scrollTop = area.scrollHeight; setHasNewText(false); }
    else setHasNewText(true);
  }, [meeting.records, meeting.interim, meeting.partial]);
  const onScroll = () => {
    const area = transcript.current;
    const follows = area.scrollHeight - area.scrollTop - area.clientHeight < 64;
    following.current = follows; setFollowLatest(follows);
    if (follows) setHasNewText(false);
  };
  const jumpToLatest = () => { following.current = true; setFollowLatest(true); setHasNewText(false); if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; };
  const showNotice = message => { clearTimeout(noticeTimer.current); setNotice(message); noticeTimer.current = setTimeout(() => setNotice(''), 2500); };
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); showNotice('복사했어요'); }
    catch { showNotice('브라우저의 복사 권한을 확인해 주세요'); }
  };
  const allText = () => meeting.records.map(row => `${row.original}\n${row.translation || '(번역 미완료)'}`).join('\n\n');
  const save = () => {
    const url = URL.createObjectURL(new Blob([allText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '하비-통역.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); showNotice('기기에 텍스트 파일로 저장했어요');
  };
  const submitText = event => { event.preventDefault(); if (!textDraft.trim() || !meeting.submitText) return; if (meeting.submitText(textDraft)) { setTextDraft(''); jumpToLatest(); } };

  return <div className={`app-shell ${meeting.ready || meeting.records.length ? 'session-ready' : ''}`}>
    <header className="topbar"><a className="brand" href="#main"><span className="brand-mark"><Languages size={21}/></span><span>석변의 하비 뿌시기</span></a><div className="topbar-right"><span className="privacy-badge"><ShieldCheck size={15}/> 기기 안에서만</span><button className="settings-button" onClick={() => setSettings(true)} aria-label="회의 설정"><Settings2 size={18}/><span>설정</span></button></div></header>
    <main className="layout" id="main">
      <div className="page-heading"><div><p className="eyebrow">MEETING INTERPRETER</p><h1>대화를 두 언어로.</h1></div><span className="heading-note">원문 바로 아래, 번역이 이어져요.</span></div>
      <section className={`guide-panel ${guideOpen ? 'expanded' : ''}`} aria-labelledby="guide-title"><button className="guide-toggle" onClick={() => setGuideOpen(value => !value)} aria-expanded={guideOpen} aria-controls="guide-content"><span><ShieldCheck size={18}/><strong id="guide-title">처음이라면, 3단계로 시작하세요</strong></span><ChevronDown size={18}/></button>{guideOpen && <div id="guide-content"><ol className="guide-steps"><li><span className="guide-number">1</span><div><strong>지금 말하는 언어를 골라요</strong><p>상대가 영어로 말하면 ‘영어 → 한국어’를 선택하세요.</p></div></li><li><span className="guide-number">2</span><div><strong>‘통역 준비’를 눌러요</strong><p>첫 모델 다운로드는 Wi-Fi에서 진행해 주세요.</p></div></li><li><span className="guide-number">3</span><div><strong>‘듣기 시작’을 누르고, 마이크를 허용해요</strong><p>내가 말할 때는 멈춘 뒤 ‘한국어 → 영어’로 바꿔요.</p></div></li></ol><p className="guide-security"><ShieldCheck size={14}/> 음성과 대화 내용은 서버에 보내지 않아요. 모델 파일만 내려받습니다.</p></div>}</section>
      <section className="workspace" aria-label="실시간 통역">
        <div className="session-controls">
          <div className="language-control"><span className="control-label">지금 말하는 언어</span><div className="direction-switch" role="group" aria-label="통역 방향"><button className={meeting.language === 'en-US' ? 'selected' : ''} onClick={() => meeting.changeLanguage('en-US')} disabled={locked} aria-pressed={meeting.language === 'en-US'}><span>영어</span><ArrowRight size={15}/><strong>한국어</strong></button><button className={meeting.language === 'ko-KR' ? 'selected' : ''} onClick={() => meeting.changeLanguage('ko-KR')} disabled={locked} aria-pressed={meeting.language === 'ko-KR'}><span>한국어</span><ArrowRight size={15}/><strong>영어</strong></button></div></div>
          {meeting.changeSpeechProfile && <label className="profile-control"><span>자막 모드</span><select aria-label="자막 모드" value={meeting.speechProfile || 'fast'} onChange={event => meeting.changeSpeechProfile(event.target.value)} disabled={locked}><option value="fast">실시간 우선</option><option value="quality">정확도 우선</option></select></label>}
          <div className="primary-control">{!meeting.ready ? <button className="primary-button prepare-button" onClick={meeting.prepare} disabled={locked}>{meeting.preparing ? <LoaderCircle size={19} className="spin"/> : <Download size={19}/>}<span>{meeting.preparing ? '모델 준비 중' : '통역 준비'}</span></button> : <button className={`primary-button listen-button ${meeting.listening ? 'is-listening' : ''}`} onClick={() => meeting.listening ? meeting.stop() : meeting.start()} disabled={!meeting.listening && locked} aria-label={meeting.listening ? '듣기 멈추기' : '듣기 시작'}>{meeting.starting || meeting.stopping ? <LoaderCircle size={19} className="spin"/> : meeting.listening ? <MicOff size={19}/> : <Mic size={19}/>}<span>{meeting.listening ? '듣기 멈추기' : meeting.starting ? '시작하는 중' : meeting.stopping ? '마무리 중' : '듣기 시작'}</span>{meeting.listening && <time>{formatTime(meeting.elapsed)}</time>}</button>}</div>
        </div>
        <div className="session-status" aria-live="polite"><span className={`status-label ${meeting.listening ? 'live' : meeting.ready ? 'ready' : ''}`}><i/>{readyStatus}</span><span className="status-detail">{meeting.preparing ? meeting.phase : meeting.pending ? `${meeting.pending}개 문장을 기기에서 처리하고 있어요` : meeting.listening ? `${languageName(meeting.language)}를 듣고 있어요 · 언어를 바꾸려면 잠깐 멈춰주세요` : meeting.ready ? (meeting.modelNames?.notice || '마이크를 누르면 자막이 시작돼요') : '첫 준비는 수분이 걸릴 수 있어요'}</span>{meeting.listening && <span className="audio-meter" aria-label="마이크 음량"><i style={{ width: `${Math.min(100, meeting.level * 1200)}%` }}/></span>}</div>
        {!meeting.ready && meeting.speechProfile === 'quality' && <p className="quality-download-note"><Download size={14}/> 정확도 우선: GPU 음성 모델 약 792MB, GPU 미지원 시 약 282MB. 번역 모델은 추가 다운로드될 수 있어요. Wi-Fi에서 준비해 주세요.</p>}
        {meeting.preparing && <div className="preparation-progress"><progress max="100" value={meeting.progress ?? undefined} aria-label="모델 준비 진행률"/><span>{meeting.progress === null ? '연결 중' : `${meeting.progress}%`}</span></div>}
        {meeting.error && <div className="session-error" role="alert">{meeting.error}</div>}
        {meeting.source === 'meeting-tab' && <p className="source-note">회의 탭과 ‘탭 오디오 공유’를 함께 선택하세요. 영상은 읽거나 저장하지 않아요.</p>}
        <div className="transcript-toolbar"><div><h2>대화 자막</h2><span className="character-count" aria-label={`대화 ${charCount.toLocaleString()}자, 최대 10000자`}>{charCount.toLocaleString()} <span>/ 10,000자</span></span></div><div className="transcript-actions"><button onClick={() => copy(allText())} disabled={!meeting.records.length} aria-label="대화 전체 복사"><Copy size={15}/><span>복사</span></button><button onClick={save} disabled={!meeting.records.length} aria-label="대화 텍스트 저장"><Download size={15}/><span>저장</span></button><button onClick={() => setClearPrompt(true)} disabled={!meeting.records.length && !hasDraft} aria-label="대화 지우기"><Trash2 size={15}/><span>지우기</span></button></div></div>
        <div className="transcript-shell"><div className="transcript-scroll" ref={transcript} onScroll={onScroll} tabIndex={0} role="region" aria-label="대화 자막 목록">
          {trimmed && <p className="history-limit">최근 10,000자를 보여드려요. 이전 내용부터 정리됩니다.</p>}
          {!meeting.records.length && !hasDraft && <div className="empty-transcript"><div className="empty-icon"><Languages size={32} strokeWidth={1.7}/></div><h3>{meeting.listening ? '말씀해 주세요. 듣고 있어요.' : '대화가 여기에 차곡차곡 쌓여요'}</h3><p>{meeting.listening ? '인식한 원문 아래에 번역을 이어서 보여드려요.' : '영어 아래에는 한국어를, 한국어 아래에는 영어를 보여드려요.'}</p><div className="empty-language-pair"><span>English</span><ArrowDown size={16}/><span>한국어</span></div></div>}
          {meeting.records.map((record, index) => <CaptionRow key={record.id} record={record} index={index} copy={copy} retry={meeting.retryRecord} locked={!meeting.ready || meeting.preparing || meeting.replyBusy}/>)}
          {hasDraft && <article className="caption-row live-caption"><div className="caption-meta"><span className="live-dot"/><span>{meeting.draftSample ? '예제 음성 인식 중' : '지금 말하는 내용'}</span><span className="draft-note">인식 중에는 바뀔 수 있어요</span></div><div className="caption-line original-line"><span className="language-label">{languageName(draftLanguage)}</span><p lang={draftLanguage === 'ko-KR' ? 'ko' : 'en'}>{meeting.interim}<span className="text-caret" aria-hidden="true"/></p></div><div className="caption-line translated-line"><span className="language-label">{targetName(draftLanguage)}</span><p lang={draftLanguage === 'ko-KR' ? 'en' : 'ko'}>{meeting.partial || <span className="caption-placeholder">번역을 이어서 보여드릴게요…</span>}</p></div></article>}
          {meeting.listening && !hasDraft && meeting.records.length > 0 && <div className="listening-footnote"><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span> 다음 말씀을 듣고 있어요</div>}
        </div>{!followLatest && <button className="jump-to-latest" onClick={jumpToLatest}><ArrowDown size={16}/>{hasNewText ? '새 자막 보기' : '최신 자막으로'}</button>}</div>
        <div className="transcript-footer"><span><ShieldCheck size={13}/> 대화는 이 탭에만 남아요</span><div><button onClick={meeting.testSample} disabled={!meeting.ready || locked}><Play size={14}/> 예제 테스트</button>{meeting.submitText && <button className={inputOpen ? 'active' : ''} onClick={() => setInputOpen(value => !value)} aria-expanded={inputOpen} aria-controls="text-input"><FileText size={14}/> 직접 입력</button>}</div></div>
        {inputOpen && <form className="text-input-form" id="text-input" onSubmit={submitText}><label htmlFor="transcript-input">{languageName(meeting.language)} 문장을 직접 입력해도 번역할 수 있어요</label><div><textarea id="transcript-input" rows={2} maxLength={5000} value={textDraft} onChange={event => setTextDraft(event.target.value)} placeholder={meeting.language === 'en-US' ? '영어 문장을 입력하거나 붙여넣으세요.' : '한국어 문장을 입력하거나 붙여넣으세요.'}/><button type="submit" className="primary-button" disabled={!meeting.ready || meeting.preparing || !textDraft.trim()}><Send size={17}/><span>번역</span></button></div></form>}
      </section>
      <details className="reply-panel"><summary><span><Sparkles size={18}/><strong>내 답변을 영어로 준비하기</strong></span><ChevronDown size={17}/></summary><div className="reply-body"><p>한국어로 적으면, 회의에서 말할 영어로 바꿔드려요.</p><form className="reply-compose" onSubmit={event => { event.preventDefault(); meeting.composeReply(replyDraft); }}><label className="sr-only" htmlFor="reply-draft">영어로 바꿀 한국어 답변</label><textarea id="reply-draft" value={replyDraft} onChange={event => setReplyDraft(event.target.value)} placeholder="예: 자료를 확인하고 내일까지 답변드리겠습니다." rows={2} maxLength={1000}/><div><span>{meeting.listening ? '답변 준비는 듣기를 멈춘 뒤 사용해 주세요.' : '기기 안에서 번역해요.'}</span><button className="primary-button" disabled={!meeting.ready || locked || !replyDraft.trim()}>{meeting.replyBusy ? <LoaderCircle size={16} className="spin"/> : <Send size={16}/>} 영어로 만들기</button></div></form>{meeting.canSuggest && <button className="secondary-button suggest-button" onClick={() => meeting.suggestReplies('비즈니스')} disabled={!meeting.records.length || locked}><Sparkles size={15}/> 대화에 맞는 답변 제안</button>}{meeting.replyError && <p className="reply-error" role="alert">{meeting.replyError}</p>}<div className="reply-list">{meeting.replies.map((reply, index) => <button className="reply-card" key={`${index}-${reply.en}`} onClick={() => copy(reply.en)} aria-label={`${index + 1}번 영어 답변 복사`}><span><strong lang="en">{reply.en}</strong><span lang="ko">{reply.ko}</span></span><Copy size={16}/></button>)}</div></div></details>
      <p className="privacy-note">새로고침하면 대화가 사라져요. 필요하면 위의 ‘저장’을 눌러 기기에 보관하세요.</p>
    </main>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
    {clearPrompt && <Dialog title="대화를 지울까요?" onClose={() => setClearPrompt(false)} className="confirm-dialog"><p>듣기를 멈추고 이 탭의 원문과 번역을 모두 지워요.</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setClearPrompt(false)}>취소</button><button className="primary-button" onClick={() => { meeting.clear(); setClearPrompt(false); jumpToLatest(); }}>모두 지우기</button></div></Dialog>}
    {settings && <Dialog title="회의 설정" onClose={() => setSettings(false)}>
      <label className="setting-row"><span><strong>음성 입력</strong><small>회의 탭 오디오는 지원되는 PC에서 사용할 수 있어요.</small></span><select value={meeting.source} onChange={event => meeting.changeSource(event.target.value)} disabled={locked} aria-label="음성 입력"><option value="microphone">마이크</option><option value="meeting-tab" disabled={!navigator.mediaDevices?.getDisplayMedia}>회의 탭 오디오</option></select></label>
      {meeting.changeSpeechProfile && <label className="setting-row"><span><strong>음성 인식 방식</strong><small>정확도 우선은 더 큰 모델을 사용해요.</small></span><select value={meeting.speechProfile || 'fast'} onChange={event => meeting.changeSpeechProfile(event.target.value)} disabled={locked} aria-label="음성 인식 방식"><option value="fast">실시간 우선</option><option value="quality">정확도 우선</option></select></label>}
      <label className="setting-row"><span><strong>호환 모델 사용</strong><small>브라우저 내장 인식이 잘 되지 않을 때 켜주세요.</small></span><input type="checkbox" checked={meeting.portable} disabled={locked} onChange={event => meeting.changePortable(event.target.checked)}/></label>
      <div className="model-details"><div><span>음성 모델</span><strong>{meeting.modelNames?.speech || '통역 준비 후 표시됩니다'}</strong></div><div><span>번역 모델</span><strong>{meeting.modelNames?.translation || '통역 준비 후 표시됩니다'}</strong></div></div>
      <div className="settings-note"><ShieldCheck size={17}/><p>음성·원문·번역은 기기에서만 처리해요. 모델은 처음 사용할 때 내려받습니다. 모델 크기와 기기 성능에 따라 준비 시간과 자막 속도가 달라져요.</p></div><p className="settings-help">‘실시간 우선’은 중간 자막을 빠르게 보여줘요. ‘정확도 우선’은 더 큰 음성 모델을 사용하므로 첫 준비와 인식에 시간이 더 걸릴 수 있어요. 모델 이름만으로 모든 발화의 정확도를 보장할 수는 없어요.</p><div className="settings-bottom"><a href="/model-licenses.md" target="_blank" rel="noreferrer">모델 출처·라이선스</a><small>BUILD {__BUILD_ID__}</small></div>
    </Dialog>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
