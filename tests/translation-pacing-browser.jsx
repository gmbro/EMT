// Development-only integration test: real ASR/API, prerecorded synthetic audio.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useMeeting } from '../src/useMeeting.js';

const originalFetch = window.fetch.bind(window);
let sampleOverride = null, reportRequest = () => {}, runStarted = 0;
window.fetch = async (url, options = {}) => {
  if (url === '/samples/en.wav' && sampleOverride) return new Response(sampleOverride, { headers: { 'Content-Type': 'audio/wav' } });
  if (url === '/api/translate' && options.method === 'POST') {
    const input = JSON.parse(options.body);
    reportRequest({ task: input.draft ? 'preview' : input.task, text: input.text, atMs: Math.round(performance.now() - runStarted) });
  }
  return originalFetch(url, options);
};
function repeatedSample(buffer) {
  const view = new DataView(buffer);
  let offset = 12, pcm;
  while (offset + 8 <= buffer.byteLength) {
    const name = String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    const size = view.getUint32(offset + 4, true);
    if (name === 'data') { pcm = new Uint8Array(buffer, offset + 8, size); break; }
    offset += 8 + size + size % 2;
  }
  if (!pcm) throw new Error('Missing sample PCM');
  const gap = 16000 * 2 * .15, tail = 16000 * 2 * 3.2;
  const length = pcm.length * 3 + gap * 2 + tail;
  const wav = new Uint8Array(44 + length), header = new DataView(wav.buffer);
  const text = (at, value) => [...value].forEach((letter, index) => wav[at + index] = letter.charCodeAt(0));
  text(0, 'RIFF'); header.setUint32(4, 36 + length, true); text(8, 'WAVE'); text(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  text(36, 'data'); header.setUint32(40, length, true);
  for (let index = 0; index < 3; index++) wav.set(pcm, 44 + index * (pcm.length + gap));
  return wav;
}
function Check() {
  const meeting = useMeeting({ guidesEnabled: false });
  const [requests, setRequests] = useState([]), [running, setRunning] = useState(false), [failure, setFailure] = useState('');
  useEffect(() => { reportRequest = row => setRequests(rows => [...rows, row]); return () => { reportRequest = () => {}; }; }, []);
  const run = async () => {
    setRunning(true); setFailure(''); setRequests([]);
    try {
      sampleOverride = repeatedSample(await (await originalFetch('/samples/en.wav')).arrayBuffer());
      await meeting.newMeeting();
      runStarted = performance.now();
      await meeting.testSample('en-US');
    } catch (error) { setFailure(error.message); }
    finally { sampleOverride = null; setRunning(false); }
  };
  return <main style={{ fontFamily: 'system-ui', padding: 24 }}><h1>합성 영어 3회 연속 발화 · 실제 API 검증</h1>
    <div>{[['paragraph','문단 나누기'],['after-speech','다 말하고 번역하기']].map(([mode,label]) => <button key={mode} aria-pressed={meeting.translationPacing===mode} onClick={() => meeting.changeTranslationPacing(mode)}>{label}</button>)}</div>
    <button disabled={meeting.preparing || running} onClick={meeting.prepare}>준비</button>
    <button disabled={!meeting.ready || running} onClick={run}>연속 영어 음원 검증</button>
    <p role="status">{running ? '재생·번역 중' : meeting.ready ? '준비 완료' : '준비 전'} · {meeting.translationPacing} · 대기 {meeting.pending}</p>
    <p role="alert">{failure || meeting.error}</p>
    <h2>번역 요청</h2><pre>{JSON.stringify(requests,null,2)}</pre>
    <h2>실시간 원문과 번역</h2><pre>{JSON.stringify(meeting.records.map(row=>({id:row.id,original:row.original,translation:row.translation,status:row.status,sourcePending:row.sourcePending,translationPacing:row.translationPacing})),null,2)}</pre>
  </main>;
}
createRoot(document.getElementById('root')).render(<Check/>);
