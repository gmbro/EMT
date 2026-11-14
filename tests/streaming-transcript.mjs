import test from 'node:test';import assert from 'node:assert/strict';import {createStreamingTranscript} from '../src/streaming-transcript.mjs';
test('speculative revisions replace words without accumulating Hey before a corrected Korean final',()=>{const updates=[],finals=[];const a=createStreamingTranscript({onUpdate:r=>updates.push(r),onFinal:r=>finals.push(r),id:()=> 'one'});a.receive({interimInputTranscription:{text:'Hey'}});a.receive({interimInputTranscription:{text:'회의 일정을'}});a.receive({inputTranscription:{text:'회의 일정을 내일 오후 3시로 변경해 주세요.'}});assert.equal(finals.length,1);assert.equal(finals[0].language,'ko-KR');assert.equal(finals[0].original,'회의 일정을 내일 오후 3시로 변경해 주세요.');assert.equal(updates[0].sourcePending,true);assert.equal(finals[0].sourcePending,false);assert.equal(a.idle,true);});
test('authoritative English is committed once, a final without interim is retained, and aborted interim stays unconfirmed',()=>{let n=0;const finals=[];const a=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r),id:()=>String(++n)});a.receive({inputTranscription:{text:'We have not approved it.'}});a.receive({interimInputTranscription:{text:'unfinished'}});a.flush();a.flush();assert.equal(finals.length,2);assert.equal(finals[0].sourcePending,false);assert.equal(finals[1].sourcePending,true);a.dispose();a.receive({inputTranscription:{text:'late'}});assert.equal(finals.length,2);});
test('finalized chunks inside a negation remain together until the sentence finishes',()=>{const finals=[];const a=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r)});a.receive({inputTranscription:{text:'We have not promised'}});assert.equal(finals.length,0);a.receive({interimInputTranscription:{text:'to sign the agreement'}});a.receive({inputTranscription:{text:'to sign the agreement this week. We also have not agreed to'}});assert.equal(finals[0].original,'We have not promised to sign the agreement this week.');a.receive({inputTranscription:{text:'automatic renewal.'}});assert.equal(finals[1].original,'We also have not agreed to automatic renewal.');a.dispose();});
test('decimal amounts and honorifics do not end a sentence; source tails are retained',()=>{const finals=[];const a=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r)});a.receive({inputTranscription:{text:'Dr. Lee said the budget is 1.25'}});assert.equal(finals.length,0);a.receive({inputTranscription:{text:'billion won, not 12.5 billion won.'}});assert.equal(finals.length,1);assert.match(finals[0].original,/1.25 billion/);a.dispose();});

test('continuous speech commits completed clauses before turn end and preserves the condition',()=>{
 const finals=[];
 const stream=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>finals.push(r.original)});
 stream.receive({inputTranscription:{text:'We can review the proposal, but we need more time'}});
 assert.deepEqual(finals,['We can review the proposal,']);
 stream.receive({inputTranscription:{text:'to confirm. If you accept these conditions, we can proceed'}});
 assert.deepEqual(finals,['We can review the proposal,','but we need more time to confirm.']);
 stream.flush();
 assert.equal(finals.at(-1),'If you accept these conditions, we can proceed');
});

test('hour of simulated ASR events keeps ordered segments through repeated interim revisions',()=>{
 let elapsed=0;
 const turns=[],source=[];
 const stream=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>turns.push(r),clock:()=>elapsed});
 for(let i=0;i<360;i++){
   const phrase='We can review item '+i+', but we must confirm the budget.';
   source.push(phrase);
   stream.receive({interimInputTranscription:{text:'We cannot approve'}});
   stream.receive({inputTranscription:{text:phrase}});
   elapsed+=10000;
   if(i%12===11)stream.flush();
 }
 assert.equal(turns.map(r=>r.original).join(' '),source.join(' '));
 assert.equal(new Set(turns.map(r=>r.id)).size,720);
 assert.equal(new Set(turns.map(r=>r.turnId)).size,30);
});

test('Korean acknowledgment after English starts a separate untranslated record within the same turn',async()=>{
 const {englishForTranslation}=await import('../src/streaming-transcript.mjs');
 const rows=[];
 const stream=createStreamingTranscript({onUpdate:()=>{},onFinal:r=>rows.push(r)});
 stream.receive({inputTranscription:{text:'Sounds good'}});
 stream.receive({inputTranscription:{text:'네'}});
 stream.flush();
 assert.deepEqual(rows.map(r=>[r.original,r.language]),[['Sounds good','en-US'],['네','ko-KR']]);
 assert.equal(rows[0].turnId,rows[1].turnId);
 assert.equal(englishForTranslation(rows[1].original,rows[1].language),'');
});

test('foreign revisions retract a bilingual preview and never become final captions',()=>{
 const rows=new Map(),finals=[];
 const stream=createStreamingTranscript({onUpdate:r=>rows.set(r.id,r),onDiscard:id=>rows.delete(id),onFinal:r=>finals.push(r.original)});
 stream.receive({interimInputTranscription:{text:'Maybe'}});
 stream.receive({inputTranscription:{text:'مرحبا',languageCode:'ar'}});
 stream.flush();
 assert.equal(rows.size,0);
 stream.receive({inputTranscription:{text:'Hello مرحبا everyone.'}});
 stream.flush();
 assert.deepEqual(finals.map(text=>text.replace(/\s+/g,' ')),['Hello everyone.']);
});

test('one-word English response before Korean survives without terminal punctuation',()=>{
 const rows=[];
 const stream=createStreamingTranscript({onUpdate:()=>{},onFinal:row=>rows.push(row)});
 stream.receive({inputTranscription:{text:'Okay 네 확인했습니다.'}});
 assert.deepEqual(rows.map(row=>[row.language,row.original]),[['en-US','Okay'],['ko-KR','네 확인했습니다.']]);
});
