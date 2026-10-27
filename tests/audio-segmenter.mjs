import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechSegmenter } from '../src/audio/segmenter.mjs';

const rate = 16000;
const voice = seconds => new Float32Array(Math.round(rate * seconds)).fill(0.1);
const silence = seconds => new Float32Array(Math.round(rate * seconds));

test('silence alone does not trigger inference', () => {
  const results = [];
  const segmenter = new SpeechSegmenter({ onSegment: segment => results.push(segment) });
  segmenter.push(silence(3));
  segmenter.flush();
  assert.equal(results.length, 0);
});

test('a pause emits speech with preroll and all voiced samples retained', () => {
  const results = [];
  const segmenter = new SpeechSegmenter({ onSegment: segment => results.push(segment) });
  segmenter.push(silence(0.4));
  segmenter.push(voice(0.6));
  segmenter.push(silence(0.8));
  assert.equal(results.length, 1);
  const [segment] = results;
  assert.equal(segment.reason, 'silence');
  assert.equal(segment.samples.filter(value => value > 0).length, rate * 0.6);
  assert.equal(segment.samples[0], 0);
  assert.equal(segment.speechDuration, 0.6);
  assert.ok(segment.duration > 1.4 && segment.duration < 1.6);
  segmenter.flush();
  assert.equal(results.length, 1, 'stop must not repeat an already emitted utterance');
});

test('continuous speech is split at six seconds without lost or duplicated PCM', () => {
  const results = [];
  const segmenter = new SpeechSegmenter({ onSegment: segment => results.push(segment) });
  const input = Float32Array.from({ length: rate * 14 + 3137 }, (_, index) => 0.02 + (index % 1000) / 2000);
  for (let offset = 0; offset < input.length; offset += 683) segmenter.push(input.slice(offset, offset + 683));
  segmenter.flush();
  assert.deepEqual(results.map(segment => segment.reason), ['max', 'max', 'stop']);
  assert.equal(results[0].samples.length, rate * 6);
  assert.equal(results[1].samples.length, rate * 6);
  const output = new Float32Array(results.reduce((sum, item) => sum + item.samples.length, 0));
  let offset = 0;
  for (const result of results) { output.set(result.samples, offset); offset += result.samples.length; }
  assert.deepEqual(output, input);
});

test('stop flushes a final incomplete frame once', () => {
  const results = [];
  const segmenter = new SpeechSegmenter({ onSegment: segment => results.push(segment) });
  segmenter.push(voice(0.413));
  assert.equal(results.length, 0);
  segmenter.flush();
  assert.equal(results.length, 1);
  assert.equal(results[0].samples.length, Math.round(rate * 0.413));
  segmenter.flush();
  assert.equal(results.length, 1);
});

test('a short click below minSpeech duration is excluded', () => {
  const results = [];
  const segmenter = new SpeechSegmenter({ onSegment: segment => results.push(segment) });
  segmenter.push(voice(0.04));
  segmenter.push(silence(1));
  segmenter.flush();
  assert.equal(results.length, 0);
});

test('silence continuation after max split does not produce a second silent segment', () => {
  const results = [];
  const segmenter = new SpeechSegmenter({ onSegment: segment => results.push(segment) });
  segmenter.push(voice(5.8));
  segmenter.push(silence(1));
  segmenter.flush();
  assert.equal(results.length, 1);
  assert.equal(results[0].reason, 'max');
});

test('previews arrive during continuous speech without consuming final PCM', () => {
  const previews = [], finals = [];
  const segmenter = new SpeechSegmenter({ onPreview: item => previews.push(item), onSegment: item => finals.push(item) });
  const input = voice(4);
  segmenter.push(input);
  assert.equal(finals.length, 0);
  assert.equal(previews.length, 3);
  assert.equal(previews[0].duration, 1.2);
  assert.ok(previews.every(item => item.segmentId === 1));
  previews[0].samples.fill(0);
  segmenter.flush();
  assert.equal(finals.length, 1);
  assert.equal(finals[0].segmentId, 1);
  assert.deepEqual(finals[0].samples, input, 'preview transfer or edits must not corrupt final samples');
  segmenter.push(voice(2));
  segmenter.flush();
  assert.equal(finals[1].segmentId, 2);
});
