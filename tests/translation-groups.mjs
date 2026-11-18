import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationGroups } from '../src/translation-groups.mjs';

function fixture(mode = 'paragraph') {
  const rows = new Map(), finals = [], requests = [];
  let next = 0;
  const groups = createTranslationGroups({
    mode, id: () => `paragraph-${++next}`,
    onUpdate: row => rows.set(row.id, row),
    onFinal: row => finals.push(row),
    onDiscard: rowId => rows.delete(rowId),
    requestFinalize: () => requests.push(true),
  });
  const source = (original, extra = {}) => ({ id: `source-${++next}`, language: 'en-US', original, createdAt: next, ...extra });
  return { groups, rows, finals, requests, source,
    voice(ms = 100) { groups.audio(new Float32Array(ms * 16).fill(.05)); },
    quiet(ms) { groups.audio(new Float32Array(ms * 16)); },
    final(text, extra) { const row = source(text, extra); groups.update({ ...row, sourcePending: true }); groups.final({ ...row, sourcePending: false }); groups.sourceEnd(); return row; },
  };
}

test('paragraph mode records immediately but translates after three complete sentences', () => {
  const f = fixture(); f.voice();
  f.final('We have not approved the contract.'); f.final('Security review is required.');
  assert.equal(f.finals.length, 0); assert.equal(f.rows.size, 1);
  assert.match([...f.rows.values()][0].original, /Security review/);
  f.final('Could you explain the next steps?');
  assert.equal(f.finals.length, 1); assert.equal(f.finals[0].sourcePending, false);
  assert.equal(f.finals[0].original, 'We have not approved the contract. Security review is required. Could you explain the next steps?');
});
test('a large provider packet becomes multiple paragraphs without omissions or duplicates', () => {
  const f = fixture(); f.voice();
  const sentences = Array.from({ length: 10 }, (_, index) => `This is sentence ${index + 1}.`);
  f.final(sentences.join(' '));
  assert.equal(f.finals.length, 3); f.quiet(3000); assert.equal(f.finals.length, 4);
  assert.equal(f.finals.map(row => row.original).join(' '), sentences.join(' '));
  assert.equal(new Set(f.finals.map(row => row.id)).size, 4);
});
test('decimals and abbreviated names do not count as extra sentences', () => {
  const f = fixture();
  f.final('Dr. Lee quoted $1.25 million. We need review.');
  assert.equal(f.finals.length, 0); f.final('Please confirm.'); assert.equal(f.finals.length, 1);
});
test('whole speech mode waits through provider finals and a pause shorter than three seconds', () => {
  const f = fixture('after-speech'); f.voice();
  f.final('First point. Second point. Third point.'); f.quiet(2950);
  assert.equal(f.finals.length, 0); assert.equal(f.requests.length, 0);
  f.voice(); f.final('The condition still applies.'); f.quiet(2950); assert.equal(f.finals.length, 0);
  f.quiet(50); assert.equal(f.finals.length, 1); assert.equal(f.requests.length, 0);
  assert.match(f.finals[0].original, /Third point\. The condition still applies\.$/);
});
test('continuous whole speech does not translate at the paragraph time or size limit', () => {
  const f = fixture('after-speech');
  for (let i = 0; i < 40; i++) { f.voice(1000); f.final(`Point ${i} remains subject to review.`); }
  assert.equal(f.finals.length, 0); assert.equal(f.requests.length, 0);
  f.quiet(3000); assert.equal(f.finals.length, 1); assert.match(f.finals[0].original, /Point 39/);
});
test('silence requests ASR finalization and waits for authoritative words', () => {
  const f = fixture('after-speech'); f.voice();
  const row = f.source('We have not approved'); f.groups.update({ ...row, sourcePending: true });
  f.quiet(3000); assert.equal(f.requests.length, 1); assert.equal(f.finals.length, 0);
  f.quiet(1000); assert.equal(f.requests.length, 1);
  f.groups.final({ ...row, original: 'We have not approved the contract.', sourcePending: false });
  f.groups.sourceEnd();
  assert.equal(f.finals.length, 1); assert.equal(f.finals[0].original, 'We have not approved the contract.');
});
test('switching to paragraph mode immediately splits the current buffered speech', () => {
  const f = fixture('after-speech'); f.voice();
  f.final('One sentence. Two sentences. Three sentences. Four sentences.');
  f.groups.setMode('paragraph'); assert.equal(f.finals.length, 1);
  assert.equal(f.finals[0].original, 'One sentence. Two sentences. Three sentences.');
  f.quiet(3000); assert.equal(f.finals.at(-1).original, 'Four sentences.');
});
test('switching to whole speech keeps the pending paragraph and uses the new silence rule', () => {
  const f = fixture(); f.voice(); f.final('First sentence. Second sentence.');
  f.groups.setMode('after-speech'); f.final('Third sentence.'); assert.equal(f.finals.length, 0);
  f.quiet(3000); assert.equal(f.finals.length, 1); assert.equal(f.finals[0].translationPacing, 'after-speech');
});
test('known speakers use one-sentence paragraphs and speaker changes keep distinct blocks', () => {
  const f = fixture(); f.voice(); f.final('Please confirm.', { speakerId: 'A' });
  assert.equal(f.finals.length, 1); f.final('I have another point', { speakerId: 'A' });
  f.final('We need a review.', { speakerId: 'B' });
  assert.deepEqual(f.finals.map(row => row.speakerId), ['A', 'A', 'B']);
});
test('paragraph duration and size limits bound punctuation-free authoritative text', () => {
  const f = fixture(); f.voice(); f.final('This authoritative text has no punctuation');
  f.voice(25000); assert.equal(f.finals.length, 1);
  f.final('Review '.repeat(210)); assert.equal(f.finals.length, 2);
});
test('stop flushes a short paragraph and preserves an unconfirmed tail separately', () => {
  const f = fixture('after-speech'); f.final('This is confirmed.');
  const row = f.source('This is not yet confirmed'); f.groups.update({ ...row, sourcePending: true });
  f.groups.flush({ includeDrafts: true });
  assert.equal(f.finals.length, 2); assert.equal(f.finals[0].sourcePending, false);
  assert.equal(f.finals[1].incomplete, true); assert.equal(f.finals[1].sourcePending, true);
  assert.equal(f.finals[1].original, row.original);
});
test('unsupported ASR revisions retract the empty group and Korean stays source-only', () => {
  const f = fixture(); const row = f.source('Maybe');
  f.groups.update(row); f.groups.discard(row.id); assert.equal(f.rows.size, 0);
  f.final('확인했습니다.', { language: 'ko-KR' }); assert.equal(f.finals[0].language, 'ko-KR');
  assert.equal(f.finals[0].translation, ''); f.groups.dispose(); f.final('Ignored.'); assert.equal(f.finals.length, 1);
});

test('whole speech mode waits for silence even across known speakers', () => {
  const f = fixture('after-speech'); f.voice();
  f.final('One point.', { speakerId: 'A' }); f.final('Another point.', { speakerId: 'B' });
  assert.equal(f.finals.length, 0); f.quiet(3000);
  assert.equal(f.finals.length, 1); assert.equal(f.finals[0].mixedSpeakers, true);
  assert.equal(f.finals[0].speakerId, '');
});
test('paragraph ordering keeps earlier paragraphs available as translation context', () => {
  const f = fixture(); f.voice(); f.final('One. Two. Three. Four. Five. Six.');
  assert.equal(f.finals.length, 2); assert.ok(f.finals[1].createdAt > f.finals[0].createdAt);
});

test('a language correction replaces the hypothesis without saving a stale English fragment', () => {
  const f = fixture(); const row = f.source('Maybe');
  f.groups.update({ ...row, sourcePending: true });
  f.groups.final({ ...row, language: 'ko-KR', original: '네 맞습니다.', sourcePending: false });
  assert.equal(f.finals.length, 1); assert.equal(f.rows.size, 1);
  assert.equal(f.finals[0].original, '네 맞습니다.'); assert.equal(f.finals[0].language, 'ko-KR');
});

test('whole speech waits for the provider end marker so late words stay in the same translation', () => {
  const f = fixture('after-speech'); f.voice();
  f.groups.final(f.source('The main point is confirmed.'));
  f.quiet(3000); assert.equal(f.finals.length, 0); assert.equal(f.requests.length, 1);
  f.groups.final(f.source('The final condition still applies.'));
  assert.equal(f.finals.length, 0);
  f.groups.sourceEnd();
  assert.equal(f.finals.length, 1);
  assert.equal(f.finals[0].original, 'The main point is confirmed. The final condition still applies.');
});

test('a provider without turn-end events commits stable text after a short settling window', () => {
  const f = fixture('after-speech'); f.voice();
  f.groups.final(f.source('First confirmed sentence.'));
  f.quiet(3000); assert.equal(f.finals.length, 0);
  f.quiet(200); f.groups.final(f.source('The late final words are included.'));
  f.quiet(250); assert.equal(f.finals.length, 0);
  f.quiet(50); assert.equal(f.finals.length, 1);
  assert.match(f.finals[0].original, /late final words/);
});
