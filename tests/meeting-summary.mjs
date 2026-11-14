import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingSummary} from '../src/meeting-summary.mjs';

test('copyable meeting highlights preserve decimals and English terms and ignore speculative text',()=>{
  const rows=[{original:'The API costs $1.25.',language:'en-US',status:'complete',translation:'비용은 1.25달러입니다.'},
    {original:'금요일에 검토하기로 했습니다.'},{original:'언제 시작할까요?'},{original:'초안',sourcePending:true}];
  const summary=meetingSummary(rows);
  assert.equal(summary,meetingSummary([...rows,...rows]));
  assert.match(summary,/비용은 1\.25달러입니다\. \(API\)/);
  assert.match(summary,/\[결정 사항\]\n• 금요일/);
  assert.match(summary,/\[열린 질문\]\n• 언제/);
  assert.ok(!summary.includes('초안'));
});

test('small talk, uncertain dates and microphone checks do not create an agenda',()=>{
  const rows=['저도 네.','다시 유치원 가는 그 기회가 기회 이게 다 끝나지 않아.','다음에 종료','7월에 가요?','아, 6순에 가요?','예?','Hi hey hey hey yo.'].map(original=>({original}));
  assert.equal(meetingSummary(rows),'');
});
