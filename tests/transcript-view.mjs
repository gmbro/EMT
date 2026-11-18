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
