import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptView, transcriptMountWindow, prependTranscriptWindow } from '../src/transcript-view.mjs';
const row = (id, extra = {}) => ({id,original:`Source ${id}`,translation:`번역 ${id}`,language:'en-US',...extra});

test('live-tail updates retain unchanged paragraph identities without dropping records',()=>{
 const view=createTranscriptView(),records=Array.from({length:2000},(_,i)=>row(String(i),{translationBatch:true}));
 const before=view(records),updated=[...records];updated[1999]={...records[1999],translation:'새로운 마지막 번역'};
 const after=view(updated);assert.equal(after.length,2000);assert.equal(after[0],before[0]);assert.equal(after[1998],before[1998]);assert.notEqual(after[1999],before[1999]);
 assert.deepEqual(after.flatMap(g=>g.rows.map(r=>r.id)),records.map(r=>r.id));
});
test('legacy continuous text stays grouped while explicit translation paragraphs stay separate',()=>{
 const view=createTranscriptView(),a=row('a'),b=row('b'),c=row('c',{translationBatch:true}),d=row('d',{translationBatch:true});
 assert.deepEqual(view([a,b,c,d]).map(g=>g.rows.map(r=>r.id)),[['a','b'],['c'],['d']]);
});
test('speaker filtering inputs and bilingual language boundaries retain the existing reading flow',()=>{
 const view=createTranscriptView(),records=[row('a',{speakerId:'A'}),row('b',{speakerId:'B'}),row('c',{language:'ko-KR',speakerId:'B'})];
 assert.deepEqual(view(records).map(g=>g.rows.map(r=>r.id)),[['a','b'],['c']]);
 assert.deepEqual(view(records,{detected:true}).map(g=>g.rows.map(r=>r.id)),[['a'],['b'],['c']]);
 assert.deepEqual(view(records.filter(r=>r.speakerId==='B'),{detected:true}).flatMap(g=>g.rows.map(r=>r.id)),['b','c']);
});
test('search matches either language and refreshes when an immutable row changes',()=>{
 const view=createTranscriptView(),a=row('a',{original:'A condition',translation:'보안 검토 전 승인 불가'}),b=row('b',{translationBatch:true});
 assert.deepEqual(view([a,b],{search:'CONDITION'}).flatMap(g=>g.rows.map(r=>r.id)),['a']);
 assert.deepEqual(view([a,b],{search:'보안 검토'}).flatMap(g=>g.rows.map(r=>r.id)),['a']);
 assert.equal(view([{...a,translation:'새 번역'},b],{search:'보안 검토'}).length,0);
 assert.equal(view([a,b],{search:'Source b'}).at(-1).rows[0],b);
});
test('search does not manufacture a match across separate rows',()=>{
 const view=createTranscriptView();assert.equal(view([row('a',{original:'first',translation:'second'}),row('b',{original:'third',translation:'fourth'})],{search:'second third'}).length,0);
});

test('large archives initially mount only the latest batch and eventually reveal every group',()=>{
 const groups=Array.from({length:2000},(_,i)=>({rows:[row(String(i))]}));
 let state=transcriptMountWindow(groups,null,'all');
 assert.equal(state.start,1920);assert.equal(groups.slice(state.start).length,80);
 let steps=0;
 while(state.start>0){const previousStart=state.start;state=transcriptMountWindow(groups,prependTranscriptWindow(groups,state),'all');assert.ok(previousStart-state.start<=80);steps++;}
 assert.equal(steps,24);assert.equal(state.complete,true);assert.equal(groups.slice(state.start).length,2000);
});
test('live tail growth preserves the previously mounted first record',()=>{
 const groups=Array.from({length:200},(_,i)=>({rows:[row(String(i))]}));
 const initial=transcriptMountWindow(groups,null,'all');const appended=[...groups,{rows:[row('200')]}];
 const next=transcriptMountWindow(appended,initial,'all');assert.equal(next.firstId,initial.firstId);assert.equal(next.start,initial.start);assert.equal(appended.slice(next.start).length,81);
 const full=transcriptMountWindow(appended,{viewKey:'all',complete:true,firstId:'0'},'all');assert.equal(full.start,0);
});
test('search and speaker view changes restart a bounded mount without affecting all search results',()=>{
 const groups=Array.from({length:300},(_,i)=>({rows:[row(String(i))]}));
 const full=transcriptMountWindow(groups,{viewKey:'all',complete:true,firstId:'0'},'all');
 const searched=transcriptMountWindow(groups,full,'search:review');assert.equal(searched.start,220);assert.equal(groups.length,300);
 const focused=transcriptMountWindow(groups,full,'speaker:B');assert.equal(focused.start,220);
});
test('an empty initial view does not make the first arriving large archive mount eagerly',()=>{
 const empty=transcriptMountWindow([],null,'all');assert.equal(empty.complete,false);
 const groups=Array.from({length:1000},(_,i)=>({rows:[row(String(i))]}));
 assert.equal(transcriptMountWindow(groups,empty,'all').start,920);
});

test('streaming appends merge into the open paragraph but preserve sealed groups', () => {
  const view = createTranscriptView();
  const sealed = row('sealed', { translationBatch: true });
  const first = row('first'), last = row('last');
  const before = view([sealed, first]);
  const after = view([sealed, first, last]);
  assert.equal(after[0], before[0]);
  assert.deepEqual(after[1].rows, [first, last]);
  assert.deepEqual(before[1].rows, [first]);
});

test('middle edits, removal and reordering produce the same groups as a fresh view', () => {
  const view = createTranscriptView();
  const a = row('a'), b = row('b'), c = row('c', { language: 'ko-KR' }), d = row('d', { translationBatch: true });
  const baseline = view([a, b, c, d]);
  const changes = [
    [a, b, { ...c, language: 'en-US' }, d],
    [a, { ...b, translationBatch: true }, c, d],
    [c, d, b, a], [b], [], [a, b, d], [a, b],
  ];
  for (const records of changes) {
    const current = view(records);
    assert.deepEqual(current, createTranscriptView()(records));
    if (records.includes(d)) assert.equal(current.find(g => g.rows[0] === d), baseline.at(-1));
  }
});

test('cached active search refreshes on live revisions and changing speaker boundaries', () => {
  const a = row('a', { speakerId: 'A' }), b = row('b', { speakerId: 'B', translation: '회의' });
  const view = createTranscriptView(), records = [a, b];
  assert.deepEqual(view(records, { search: '회의' })[0].rows, records);
  assert.deepEqual(view(records, { detected: true, search: '회의' })[0].rows, [b]);
  const updated = [a, { ...b, translation: '승인' }];
  assert.deepEqual(view(updated, { detected: true, search: '회의' }), []);
  assert.deepEqual(view(updated, { detected: true, search: '승인' })[0].rows, [updated[1]]);
});
