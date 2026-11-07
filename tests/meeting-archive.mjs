import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_KEY, loadMeetings, mergeMeeting, saveMeetings, detectCaptionLanguage } from '../src/meeting-archive.mjs';
const row = (id, language = 'en-US') => ({ id, language, original: 'Not approved.', translation: '승인되지 않았습니다.', status: 'complete', createdAt: 1793160000000 });
function storage() { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; }
test('meeting archive survives reload, updates a session without duplicating it and preserves earlier dates', () => {
  const local = storage();
  const before = { id: 'previous', createdAt: '2026-10-27T01:00:00.000Z' }, current = { id: 'current', createdAt: '2026-10-28T01:00:00.000Z' };
  let sessions = mergeMeeting([], before, [row('old')]);
  sessions = mergeMeeting(sessions, current, [row('one')]);
  sessions = mergeMeeting(sessions, current, [row('one'), row('two', 'ko-KR')]);
  saveMeetings(local, sessions);
  const restored = loadMeetings(local);
  assert.deepEqual(restored.map(s => s.id), ['current', 'previous']);
  assert.deepEqual(restored[0].records.map(r => r.id), ['one', 'two']);
  assert.equal(restored[1].records[0].translation, '승인되지 않았습니다.');
  assert.equal(mergeMeeting(restored, { id: 'empty' }, []), restored);
});
test('interrupted translations become retryable after reload without losing the source', () => {
  const local = storage();
  saveMeetings(local, [{ id: 'one', createdAt: '2026-10-28T01:00:00Z', records: [{ ...row('x'), status: 'translating', translation: '승인' }] }]);
  const loaded = loadMeetings(local)[0].records[0];
  assert.equal(loaded.original, 'Not approved.'); assert.equal(loaded.status, 'error'); assert.match(loaded.error, /다시 번역/);
});
test('invalid or partially damaged archives do not break valid dated records', () => {
  const local = storage(); local.setItem(ARCHIVE_KEY, '{bad JSON'); assert.deepEqual(loadMeetings(local), []);
  local.setItem(ARCHIVE_KEY, JSON.stringify({ version: 1, sessions: [null, { id: 'bad', createdAt: 'not-a-date', records: [] }, { id: 'good', createdAt: '2026-10-28T01:00:00Z', records: [null, row('ok')] }] }));
  assert.equal(loadMeetings(local).length, 1); assert.equal(loadMeetings(local)[0].records.length, 1);
});
test('storage write failure propagates so UI cannot claim a successful save', () => {
  assert.throws(() => saveMeetings({ setItem() { throw new Error('QuotaExceededError'); } }, []), /QuotaExceededError/);
});
test('English and Korean drafts route to the matching pane including mixed proper names', () => {
  assert.equal(detectCaptionLanguage('Please ask Harvey to confirm the deadline.'), 'en-US');
  assert.equal(detectCaptionLanguage('Harvey에게 마감일을 확인해 주세요.'), 'ko-KR');
  assert.equal(detectCaptionLanguage('계약은 승인되지 않았습니다.'), 'ko-KR');
  assert.equal(detectCaptionLanguage('15', 'ko-KR'), 'ko-KR');
});
test('meeting reply guides survive reload and malformed guide entries are ignored', () => {
  const local=storage();
  const meta={id:'guides',createdAt:'2026-10-28T01:00:00Z',replies:[{ko:'범위를 확인해 주시겠어요?',en:'Could you clarify the scope?'},null,{ko:1,en:'bad'}]};
  saveMeetings(local,mergeMeeting([],meta,[row('one')]));
  assert.deepEqual(loadMeetings(local)[0].replies,[meta.replies[0]]);
});

test('Korean source-only rows and independent speech drafts survive reload without requiring an English translation',()=>{
 const local=storage();const speech={id:'typed',ko:'확인 후 답변드리겠습니다.',en:'I will get back to you after checking.',status:'complete'};
 saveMeetings(local,mergeMeeting([],{id:'source-only',createdAt:'2026-10-29T01:00:00Z',speeches:[speech],replies:[{ko:'범위를 알려주세요.',en:'Could you clarify the scope?'}]},[{...row('ko','ko-KR'),translation:''}]));
 const restored=loadMeetings(local)[0];assert.equal(restored.records[0].status,'complete');assert.equal(restored.records[0].translation,'');assert.equal(restored.speeches[0].en,speech.en);assert.equal(restored.replies[0].en,'Could you clarify the scope?');
 const typedOnly=mergeMeeting([],{id:'typed-only',createdAt:'2026-10-29T01:00:00Z',speeches:[speech]},[]);assert.equal(typedOnly.length,1);
});

test('damaged speech output or invalid date type cannot erase other valid meeting records',()=>{
 const local=storage();saveMeetings(local,[{id:'bad-date',createdAt:2026,records:[]},{id:'valid',createdAt:'2026-10-29T01:00:00Z',records:[row('good')],speeches:[{id:'bad-output',ko:'원문은 유지합니다.',en:42,status:'complete'}]}]);
 const restored=loadMeetings(local);assert.equal(restored.length,1);assert.equal(restored[0].records[0].id,'good');assert.equal(restored[0].speeches[0].en,'');assert.equal(restored[0].speeches[0].status,'error');
});

 test('meeting-specific glossary and reply source survive archive reload',()=>{
 const local=storage();const reply={ko:'확인해 주세요.',en:'Please confirm.',sourceId:'one',sourceAt:1793160000000};
 saveMeetings(local,mergeMeeting([],{id:'terms',createdAt:'2026-10-31T01:00:00Z',glossary:'SLA = 서비스 수준 협약',replies:[reply]},[row('one')]));
 const restored=loadMeetings(local)[0];assert.equal(restored.glossary,'SLA = 서비스 수준 협약');assert.deepEqual(restored.replies[0],reply);
 });

test('source-only English archive remains complete without manufacturing a missing translation error',()=>{const local=storage();saveMeetings(local,[{id:'transcript',createdAt:'2026-11-01T00:00:00Z',records:[{...row('one'),translation:'',transcriptOnly:true}]}]);assert.equal(loadMeetings(local)[0].records[0].status,'complete');});
