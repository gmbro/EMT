import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingContext } from '../src/meeting-context.mjs';

const record = (createdAt, original, other = {}) => ({ createdAt, original, status: 'complete', ...other });

test('context follows the newest evidence on tied matches and skips provisional and future speech', () => {
  const rows = [
    record(1, 'Security approval was expected on Tuesday.'),
    record(2, 'Security approval is now due on Friday.', { speakerId: 'B' }),
    record(3, 'Security approval is tomorrow.', { sourcePending: true }),
    record(4, 'Security approval is today.', { status: 'recognizing' }),
    record(5, 'There is one caveat.'),
    record(6, 'We must preserve the existing contract.'),
    record(7, 'Security approval was granted.')
  ];
  assert.equal(meetingContext(rows, { text: 'security approval', before: 7 }), [
    '[2] 화자 B · Security approval is now due on Friday.',
    '[3] There is one caveat.',
    '[4] We must preserve the existing contract.'
  ].join('\n'));
});

test('a long irrelevant or oversized source cannot displace a matching complete fact', () => {
  const rows = [
    record(1, 'Security approval has not been granted.'),
    record(2, 'Security approval schedule ' + 'lengthy explanation '.repeat(90)),
    record(3, 'That covers today’s agenda.'),
    record(4, 'Can we move on?')
  ];
  const result = meetingContext(rows, { text: 'security approval schedule' });
  assert.match(result, /approval has not been granted/);
  assert.doesNotMatch(result, /lengthy explanation/);
  assert.ok(result.length <= 1400);
});

test('guide context spends a tight budget on specific terms and preserves the qualifier', () => {
  const rows = [
    record(1, 'Security approval for the financing proposal remains conditional on the audit.'),
    record(2, 'Security approval ' + 'and '.repeat(21)),
    ...Array.from({ length: 4 }, (_, i) => record(i + 3, 'meeting '.repeat(74).trim()))
  ];
  const result = meetingContext(rows, { text: 'security approval financing proposal audit', guide: true });
  assert.match(result, /remains conditional on the audit/);
  assert.doesNotMatch(result, /Security approval and and/);
  assert.ok(result.length <= 2500);
});

test('an edited source refreshes its matched terms and a closed meeting cannot contribute facts', () => {
  const earlier = record(1, 'The security review is on Friday.');
  const rows = [earlier, record(2, 'Let’s return to the agenda.'), record(3, 'Next item.')];
  const options = { text: 'security review must be approved' };
  assert.match(meetingContext(rows, options), /Friday/);
  earlier.original = 'The budget review is on Thursday.';
  assert.doesNotMatch(meetingContext(rows, options), /Thursday|Friday/);
  assert.doesNotMatch(meetingContext(rows.slice(1), { text: 'budget review' }), /Thursday/);
});

test('only one recent copy of each query term counts toward an older match', () => {
  const rows = [record(1, 'Review review review.'), record(2, 'Unrelated note.'), record(3, 'Next item.')];
  assert.equal(meetingContext(rows, { text: 'please review contract' }), '[2] Unrelated note.\n[3] Next item.');
});
