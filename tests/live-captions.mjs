import {test} from 'node:test';import assert from 'node:assert/strict';
import {createLiveCaptionAssembler,createMeetingCaptionAssembler,createPCMFramer,pcm16Base64} from '../src/live-captions.mjs';
function create(language='en-US'){const updates=[],finals=[],timers=new Map();let id=0;const assembler=createLiveCaptionAssembler({language,onUpdate:r=>updates.push(r),onFinal:r=>finals.push(r),schedule:f=>{timers.set(++id,f);return id;},cancel:id=>timers.delete(id),id:()=>String(updates.length+1),clock:()=>0,now:()=>100});return{assembler,updates,finals,timers};}
test('live source and translated deltas form one bilingual row without dropping last words',()=>{
  const {assembler:a,updates,finals}=create();
  a.receive({inputTranscription:{text:'Could you send it by',languageCode:'en'}});
  a.receive({outputTranscription:{text:'내일까지 보내',languageCode:'ko'}});
  a.receive({inputTranscription:{text:' tomorrow?',languageCode:'en'}});
  assert.equal(finals.length,0);
  a.receive({outputTranscription:{text:'주실 수 있나요?',languageCode:'ko'}});
  assert.equal(finals.length,1);assert.equal(finals[0].original,'Could you send it by tomorrow?');assert.equal(finals[0].translation,'내일까지 보내주실 수 있나요?');
  a.flush();assert.equal(finals.length,1);assert.ok(updates.length>=4);
});
test('output arriving first is retained and the other language is ignored',()=>{
  const {assembler:a,finals}=create('ko-KR');
  a.receive({inputTranscription:{text:'Hello.',languageCode:'en'}});assert.equal(finals.length,0);
  a.receive({inputTranscription:{text:'일정을 변경해 주세요.',languageCode:'ko'},outputTranscription:{text:'Please reschedule.',languageCode:'en'}});
  assert.equal(finals[0].language,'ko-KR');assert.equal(finals[0].original,'일정을 변경해 주세요.');
  const b=create();b.assembler.receive({outputTranscription:{text:'알겠습니다.'}});b.assembler.receive({inputTranscription:{text:'Understood.',languageCode:'en'}});assert.equal(b.finals[0].translation,'알겠습니다.');
});
test('silence flushes a partial phrase once and disposed sessions never publish',()=>{
  const {assembler:a,timers,finals,updates}=create();a.receive({inputTranscription:{text:'Please check',languageCode:'en'}});
  [...timers.values()][0]();assert.equal(finals.length,1);assert.equal(finals[0].original,'Please check');
  a.dispose();a.receive({inputTranscription:{text:'late',languageCode:'en'}});assert.equal(updates.length,1);
});
test('100 ms PCM framing preserves every sample and uses clipped little-endian int16',()=>{
  const chunks=[],f=createPCMFramer(pcm=>chunks.push([...pcm]),3);f.push(new Float32Array([1,2]));f.push(new Float32Array([3,4,5,6,7]));f.flush();f.flush();
  assert.deepEqual(chunks,[[1,2,3],[4,5,6],[7]]);
  const bytes=Buffer.from(pcm16Base64(new Float32Array([-2,0,2,.5])),'base64');assert.deepEqual(Array.from({length:4},(_,i)=>bytes.readInt16LE(i*2)),[-32768,0,32767,16384]);
});

test('interim snapshots update immediately, replace hypotheses, and never duplicate finalized text',()=>{
 const {assembler:a,updates,finals}=create();
 a.receive({interimInputTranscription:{text:'Could you',languageCode:'en'}});assert.equal(updates.at(-1).original,'Could you');assert.equal(finals.length,0);
 a.receive({interimInputTranscription:{text:'Could we review',languageCode:'en'}});assert.equal(updates.at(-1).original,'Could we review');
 a.receive({inputTranscription:{text:'Could we review it?',languageCode:'en'},outputTranscription:{text:'검토할 수 있을까요?'}});
 assert.equal(finals.length,1);assert.equal(finals[0].original,'Could we review it?');assert.equal(finals[0].sourcePending,false);
});
test('punctuation-free long speech segments without waiting for a translation and preserves every source delta',()=>{
 const {assembler:a,finals,updates}=create();const source='long speech without a pause '.repeat(150);
 for(let i=0;i<source.length;i+=25)a.receive({inputTranscription:{text:source.slice(i,i+25),languageCode:'en'}});
 a.flush();assert.ok(finals.length>=4);assert.ok(finals.every(row=>row.original.length<=1025));
 assert.equal(finals.map(row=>row.original).join('').replace(/\s/g,''),source.replace(/\s/g,''));assert.ok(updates.length>100);
});
test('Korean speech keeps source only and completes without any English translation',()=>{
 const {assembler:a,finals}=create('ko-KR');a.receive({inputTranscription:{text:'계약을 승인하지 않았습니다.',languageCode:'ko'},outputTranscription:{text:'We approved it.'}});
 assert.equal(finals.length,1);assert.equal(finals[0].translation,'');assert.equal(finals[0].original,'계약을 승인하지 않았습니다.');
});
test('quiet timeout never certifies an interim hypothesis; explicit stop labels it unconfirmed',()=>{
 const {assembler:a,finals,timers}=create();a.receive({interimInputTranscription:{text:'an unconfirmed guess',languageCode:'en'}});
 [...timers.values()][0]();assert.equal(finals.length,0);a.flush();assert.equal(finals[0].sourcePending,true);
});

test('one Korean-target connection routes both languages without duplicates or stale translation leakage',()=>{
 const updates=[],finals=[];let id=0;const a=createMeetingCaptionAssembler({onUpdate:r=>updates.push(r),onFinal:r=>finals.push(r),id:()=>String(++id)});
 a.receive({inputTranscription:{text:'Please review',languageCode:'en'},outputTranscription:{text:'검토해 주세요.'}});
 a.receive({inputTranscription:{text:'아직 승인하지 않았습니다.',languageCode:'ko'}});
 a.receive({outputTranscription:{text:'late English translation must be ignored'}});
 a.receive({inputTranscription:{text:'Thank you.',languageCode:'en'},outputTranscription:{text:'감사합니다.'}});
 a.flush();a.dispose();assert.deepEqual(finals.map(r=>r.language),['en-US','ko-KR','en-US']);
 assert.equal(finals[1].translation,'');assert.equal(finals[2].translation,'감사합니다.');assert.equal(finals[0].original,'Please review');
});
