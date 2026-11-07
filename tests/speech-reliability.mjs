import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechHealth,createSilenceGate} from '../src/speech-health.mjs';
import {canPublishPreview,needsPreview,sentenceChunks,canStartPreview,canContinueFinalPreview} from '../src/preview-policy.mjs';

test('a new utterance after minutes of silence gets its own response deadline',()=>{
  let time=0;const health=createSpeechHealth({now:()=>time});
  health.response();time=120000;health.voice();assert.equal(health.check(),null);
  time+=11999;assert.equal(health.check(),null);time++;assert.equal(health.check(),'finalize');
  assert.equal(health.check(),null);time+=12000;assert.equal(health.check(),'recover');
  health.response();time+=100000;assert.equal(health.check(),null);
});
test('continuous transcription resets the watchdog and silence alone never arms it',()=>{
  let time=100;const health=createSpeechHealth({now:()=>time});
  for(let i=0;i<180;i++){health.voice();time+=1000;health.response();assert.equal(health.check(),null);}
  time+=600000;assert.equal(health.check(),null);
});
test('silence gate preserves quiet speech, prefix and trailing silence; resumes without a new socket',()=>{
  const sent=[];let ends=0;const gate=createSilenceGate({send:p=>sent.push(p),end:()=>ends++});
  const quiet=new Float32Array(1600),voice=new Float32Array(1600).fill(.0008);
  for(let i=0;i<100;i++)gate.push(quiet);assert.equal(sent.length,0);
  gate.push(voice);assert.equal(sent.length,4);assert.equal(sent[3][0],voice[0]);
  for(let i=0;i<100;i++)gate.push(quiet);assert.equal(sent.length,16);assert.equal(ends,1);
  gate.push(voice);assert.equal(sent.length,20);assert.equal(sent.at(-1)[0],voice[0]);
});
test('continuous speech never gets clipped by silence cost optimization',()=>{
  let frames=0,ends=0;const gate=createSilenceGate({send:()=>frames++,end:()=>ends++});
  for(let i=0;i<600;i++)gate.push(new Float32Array(1600).fill(.05));
  assert.equal(frames,600);assert.equal(ends,0);
});
test('50 ms frames retain 400 ms prefix and 1.2 s trailing audio',()=>{
 const frames=[];let ends=0;
 const gate=createSilenceGate({send:pcm=>frames.push(pcm),end:()=>ends++});
 for(let i=0;i<30;i++)gate.push(new Float32Array(800));
 gate.push(new Float32Array(800).fill(.001));assert.equal(frames.length,8);
 for(let i=0;i<24;i++)gate.push(new Float32Array(800));
 assert.equal(ends,1);assert.equal(frames.reduce((n,p)=>n+p.length,0),25600);
});
test('growing speech publishes translated prefix but corrections do not publish stale meaning',()=>{
  assert.ok(canPublishPreview('We approve the scope after review','We approve the scope'));
  assert.equal(canPublishPreview('We do not approve the scope','We approve the scope'),false);
  assert.equal(canPublishPreview('We cannot approve','We can'),false);
  assert.equal(needsPreview('Please review','Please review the'),false);
  assert.ok(needsPreview('Please review','Please review the revised contract before Friday'));
  assert.ok(needsPreview('We approve','We do not approve'));
});
test('sentence caching preserves negations, amounts and changing suffixes',()=>{
  assert.deepEqual(sentenceChunks('Dr. Lee has not approved $1.25 million. We need review'),['Dr. Lee has not approved $1.25 million.','We need review']);
});

test('early preview starts on a phrase and finals retain only exact text and glossary',()=>{
 assert.equal(canStartPreview('Could'),false);assert.equal(canStartPreview('Could you'),true);assert.equal(canStartPreview('We do'),true);assert.equal(canStartPreview('a'.repeat(1201)),false);
 assert.equal(canContinueFinalPreview('We do not approve.','We approve.','',''),false);
 assert.equal(canContinueFinalPreview('Please confirm.','Please confirm.','new','old'),false);
 assert.equal(canContinueFinalPreview('Please confirm.','Please confirm.','',''),true);
});
