import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyScheduler } from '../src/reply-scheduler.mjs';
import { isGuideMoment } from '../src/meeting-context.mjs';

function fixture() {
  let time = 100000, available = true, previous = { at: 0, text: '' };
  let next = 0;
  const timers = new Map(), generated = [];
  const scheduler = createReplyScheduler({
    now: () => time,
    canGenerate: () => available,
    lastRequest: () => previous,
    schedule: fn => { timers.set(++next, fn); return next; },
    cancel: id => timers.delete(id),
    generate: async turn => {
      generated.push(turn);
      previous = { at: time, text: turn.original.trim().toLowerCase() };
    },
  });
  return {
    scheduler, generated, timers,
    advance(ms) { time += ms; },
    available(value) { available = value; },
    async tick() {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      await callback();
    },
  };
}
const question = (id, original = 'Could you explain how access is revoked') => ({ id, original });

test('recognizes spoken English questions without punctuation and skips acknowledgements', () => {
  for (const text of ['Could you explain how access is revoked', 'What would happen next', 'Do we need a review', 'Please could you explain the process']) assert.equal(isGuideMoment(text), true, text);
  assert.equal(isGuideMoment('Thank you for explaining.'), false);
});
test('a question arriving during cooldown waits and generates without another utterance', async () => {
  const f = fixture();
  f.scheduler.submit(question('first')); await f.tick();
  f.advance(1000); f.scheduler.submit(question('second', 'Can you explain the cancellation process')); await f.tick();
  assert.equal(f.generated.length, 1); assert.equal(f.timers.size, 1);
  f.advance(11000); await f.tick();
  assert.deepEqual(f.generated.map(t => t.id), ['first', 'second']); f.scheduler.dispose();
});
test('a busy composer retains the latest eligible question with its original record ID', async () => {
  const f = fixture(); f.available(false);
  f.scheduler.submit(question('first')); await f.tick();
  f.scheduler.submit(question('latest', 'What are the options')); await f.tick();
  f.available(true); await f.tick();
  assert.deepEqual(f.generated.map(t => t.id), ['latest']); f.scheduler.dispose();
});
test('unrelated follow-up speech does not replace a pending question', async () => {
  const f = fixture(); f.available(false);
  f.scheduler.submit(question('question')); f.scheduler.submit({ id: 'ack', original: 'Thank you.' });
  f.available(true); await f.tick();
  assert.equal(f.generated[0].id, 'question'); f.scheduler.dispose();
});
test('duplicate guides are skipped and disabling or switching meetings cancels pending work', async () => {
  const f = fixture(); f.scheduler.submit(question('first')); await f.tick();
  f.scheduler.submit(question('duplicate')); assert.equal(f.timers.size, 0);
  f.scheduler.submit(question('second', 'What happens next')); f.scheduler.invalidate();
  assert.equal(f.timers.size, 0); assert.equal(f.generated.length, 1); f.scheduler.dispose();
});
test('non-question decision signals retain the thirty-second cost limit', async () => {
  const f = fixture(); f.scheduler.submit(question('first')); await f.tick();
  f.scheduler.submit({ id: 'decision', original: 'The proposed budget needs a decision.' });
  f.advance(12000); await f.tick(); assert.equal(f.generated.length, 1);
  f.advance(18000); await f.tick(); assert.equal(f.generated[1].id, 'decision'); f.scheduler.dispose();
});
