import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRequest,usageSummary} from '../src/request-metrics.mjs';
import {meetingContext} from '../src/meeting-context.mjs';
test('cost diagnostics retain per-task unknown usage and separate thought tokens',()=>{
 recordRequest({task:'preview',status:'complete',usage:{total_input_tokens:100,total_output_tokens:20,total_thought_tokens:4,total_cached_tokens:10}});
 recordRequest({task:'preview',status:'failed'});
 recordRequest({task:'replies',status:'complete',usage:{total_input_tokens:50,total_output_tokens:30}});
 const s=usageSummary();assert.deepEqual(s.byTask.preview,{requests:2,unknown:1,input:100,output:20,thought:4,cached:10,failures:1});assert.equal(s.byTask.replies.input,50);assert.equal(s.thought,4);
});
test('guide context excludes separately transmitted latest turn while preserving constraints',()=>{
 const records=[{createdAt:1,original:'Security review is required before approval.',status:'complete'},{createdAt:2,original:'Can you approve today?',status:'complete'}];
 const context=meetingContext(records,{before:2,text:records[1].original,guide:true,purpose:'Do not approve yet.'});
 assert.match(context,/Security review/);assert.match(context,/Do not approve/);assert.doesNotMatch(context,/Can you approve today/);
});

test('the rolling request window evicts old counts, failures and whole task buckets', async () => {
  const { recordRequest, usageSummary } = await import('../src/request-metrics.mjs?request-window');
  for (let i = 0; i < 1999; i++) recordRequest({ task: 'old', status: 'failed' });
  recordRequest({ task: 'preview', status: 'complete', usage: { total_input_tokens: 7 } });
  for (let i = 0; i < 1999; i++) recordRequest({ task: 'translate', status: 'complete', usage: { total_output_tokens: 2 } });
  const summary = usageSummary();
  assert.deepEqual(summary.tasks, { preview: 1, translate: 1999 });
  assert.equal(summary.requests, 2000);
  assert.equal(summary.unknown, 0);
  assert.equal(summary.failures, 0);
  assert.equal(summary.input, 7);
  assert.equal(summary.output, 3998);
  recordRequest({ task: 'translate', status: 'failed' });
  const next = usageSummary();
  assert.deepEqual(next.tasks, { translate: 2000 });
  assert.equal(next.input, 0);
  assert.equal(next.unknown, 1);
  assert.equal(next.failures, 1);
});

test('audio updates replace per session and evict the oldest session after the 200th', async () => {
  const { recordAudioUsage, usageSummary } = await import('../src/request-metrics.mjs?audio-window');
  for (let id = 0; id < 200; id++) recordAudioUsage(id, { capturedSeconds: 1, sentSeconds: 1 });
  recordAudioUsage(0, { capturedSeconds: 10, sentSeconds: 2 });
  assert.equal(usageSummary().audio.capturedSeconds, 209);
  recordAudioUsage(200, { capturedSeconds: 0.25, sentSeconds: 0.125, reconnections: 1, usageReports: 1 });
  assert.deepEqual(usageSummary().audio, { capturedSeconds: 199.25, sentSeconds: 199.125, reconnections: 1, usageReports: 1 });
});

test('metrics copy input counters and published snapshots, and notify after each update', async () => {
  const { recordAudioUsage, recordRequest, usageSummary, subscribeUsage } = await import('../src/request-metrics.mjs?snapshot');
  const updates = [];
  const unsubscribe = subscribeUsage(() => updates.push(usageSummary()));
  const usage = { total_input_tokens: 12 }, audio = { capturedSeconds: 0.5 };
  recordRequest({ task: 'translate', status: 'complete', usage });
  recordAudioUsage('audio', audio);
  usage.total_input_tokens = 999; audio.capturedSeconds = 7;
  updates[1].byTask.translate.input = -1; updates[1].tasks.translate = -1; updates[1].audio.capturedSeconds = -1;
  const fresh = usageSummary();
  assert.equal(fresh.byTask.translate.input, 12);
  assert.equal(fresh.tasks.translate, 1);
  assert.equal(fresh.audio.capturedSeconds, 0.5);
  assert.equal(updates[0].audio.capturedSeconds, 0);
  unsubscribe();
  recordRequest({ task: 'replies', status: 'failed' });
  assert.equal(updates.length, 2);
});
