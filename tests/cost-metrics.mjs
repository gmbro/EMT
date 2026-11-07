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
