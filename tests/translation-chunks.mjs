import test from 'node:test';
import assert from 'node:assert/strict';
import { translationChunks } from '../src/translation-chunks.mjs';
import { MeetingEngine } from '../src/meeting-engine.js';

test('long bilingual input is split without dropping or repeating any code point', () => {
  const source = 'Please check the agenda. 회의 자료를 확인해 주세요! 😀 금요일까지 답변 바랍니다.\n'.repeat(120);
  const chunks = translationChunks(source);
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 350));
  assert.ok(chunks.length > 10);
  assert.ok(chunks.every(chunk => !chunk.includes('\ufffd')));
});

test('no-space languages and a long single word are still bounded', () => {
  for (const source of ['가'.repeat(10000), '😀'.repeat(10000), 'x'.repeat(10000)]) {
    const chunks = translationChunks(source, 350);
    assert.equal(chunks.join(''), source);
    assert.ok(chunks.every(chunk => Array.from(chunk).length <= 350));
  }
});

test('cloud chunks satisfy both the model character limit and the API UTF-16 limit without splitting a pair', () => {
  for (const source of ['😀'.repeat(1199), ('Please verify the total. 😀' + '𠮷'.repeat(950)).repeat(3)]) {
    const chunks = translationChunks(source, 1200, 1800);
    assert.equal(chunks.join(''), source);
    assert.ok(chunks.every(chunk => !/[\uD800-\uDFFF]/u.test(chunk) && chunk.length <= 1800 && [...chunk].length <= 1200));
  }
  assert.equal(translationChunks('😀'.repeat(1200), 1200).length, 1);
  assert.deepEqual(translationChunks('😀abc', 99, 2), ['😀', 'ab', 'c']);
  assert.throws(() => translationChunks('😀', 10, 1), RangeError);
});

test('a movable request boundary keeps a negation, deadline, amount or titled name with its meaning', () => {
  const cases = [
    ['For this project we have not approved the budget yet.', 'not ', 'not approved'],
    ['Our company expects delivery in 15 business days.', '15 ', '15 business days'],
    ['A detailed review was requested by Dr. Lee and Ms. Kim.', 'Dr. ', 'Dr. Lee'],
    ['Our renewal agreement is effective by Friday at noon.', 'by ', 'by Friday'],
  ];
  for (const [source, cutoff, phrase] of cases) {
    const limit = source.indexOf(cutoff) + cutoff.length;
    const chunks = translationChunks(source, limit);
    assert.equal(chunks.join(''), source);
    assert.ok(chunks.every(chunk => chunk.length <= limit));
    assert.ok(chunks.some(chunk => chunk.includes(phrase)), phrase);
  }
});

test('all long-text translation chunks stream into the same cumulative output', async () => {
  const engine = new MeetingEngine({ translationMode: 'local' });
  const input = 'Please send the meeting notes. '.repeat(150);
  const calls = [], updates = [];
  engine.translationKinds.set('en-US', 'native');
  engine.nativeTranslators.set('en-US', { translate: async text => { calls.push(text); return `번역${calls.length}`; } });
  const result = await engine.translate(input, 'en-US', { onText: text => updates.push(text) });
  assert.equal(calls.join(''), input);
  assert.ok(calls.length > 1);
  assert.equal(result.text, calls.map((_, index) => `번역${index + 1}`).join('\n'));
  assert.equal(updates.at(-1), result.text);
});
