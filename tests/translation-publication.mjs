import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationPublication } from '../src/translation-publication.mjs';

test('a new translation publishes its first useful token and every growing delta', () => {
  const output=createTranslationPublication();
  assert.equal(output.accept('아직'),true);
  assert.equal(output.accept('아직 승인하지 않았습니다.'),true);
  assert.equal(output.accept('아직 승인하지 않았습니다.'),false);
});
test('retranslation retains a completed result until replacement catches up', () => {
  const previous='아직 계약을 승인하지 않았습니다.';
  const output=createTranslationPublication(previous);
  assert.equal(output.accept('아직'),false);
  assert.equal(output.accept(previous),false);
  assert.equal(output.accept(previous+' 보안 검토가 필요합니다.'),true);
});
test('each retry protects the most recently published partial translation', () => {
  const output=createTranslationPublication();
  assert.equal(output.accept('검토 전에는 시작할 수 없습니다.'),true);
  output.retry();
  assert.equal(output.accept('검토'),false);
  assert.equal(output.accept('검토 전에는 시작할 수 없습니다. 금요일'),true);
  output.retry();
  assert.equal(output.accept('검토 전에는 시작할 수 없습니다.'),false);
  assert.equal(output.accept('검토 전에는 시작할 수 없습니다. 금요일까지 확인해 주세요.'),true);
});
test('a shorter corrected result waits for final completion rather than erasing useful text midstream', () => {
  const output=createTranslationPublication('금요일에 회의 안건을 보내주실 수 있나요?');
  assert.equal(output.accept('금요일까지 안건을 보내주시겠어요?'),false);
});
test('empty or invalid chunks cannot count as a visible translation', () => {
  const output=createTranslationPublication();
  for(const value of ['', '  ', null, undefined, 7])assert.equal(output.accept(value),false);
  assert.equal(output.accept('네'),true);
});
