import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingResampler, resampleMono } from '../src/audio/pcm.mjs';

for (const sourceRate of [44100, 48000]) {
  test(`one second at ${sourceRate} Hz becomes exactly 16,000 samples`, () => {
    const output = resampleMono(new Float32Array(sourceRate).fill(0.3), sourceRate);
    assert.equal(output.length, 16000);
    assert.ok(output.every(sample => Math.abs(sample - 0.3) < 1e-6));
  });

  test(`streaming ${sourceRate} Hz is independent of AudioWorklet block boundaries`, () => {
    const samples = Float32Array.from({ length: sourceRate + 137 }, (_, index) => Math.sin(index * 0.013));
    const expected = resampleMono(samples, sourceRate);
    const resampler = new StreamingResampler(sourceRate);
    const pieces = [];
    for (let i = 0; i < samples.length; i += 127) pieces.push(...resampler.push(samples.slice(i, i + 127)));
    pieces.push(...resampler.flush());
    assert.deepEqual(new Float32Array(pieces), expected);
  });
}

test('48 kHz downsampling uses an area average rather than discarding two of three samples', () => {
  assert.deepEqual(resampleMono(new Float32Array([0, 1, 2, 3, 4, 5]), 48000), new Float32Array([1, 4]));
});

test('end-of-capture retains a fractional final sample and flush is idempotent', () => {
  const resampler = new StreamingResampler(44100);
  assert.equal(resampler.push(new Float32Array([0.4])).length, 0);
  assert.ok(Math.abs(resampler.flush()[0] - 0.4) < 1e-6);
  assert.equal(resampler.flush().length, 0);
});

test('invalid rates are rejected', () => {
  assert.throws(() => new StreamingResampler(0), RangeError);
  assert.throws(() => new StreamingResampler(NaN), RangeError);
});
