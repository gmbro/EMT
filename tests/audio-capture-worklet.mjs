import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { StreamingResampler, resampleMono } from '../src/audio/pcm.mjs';
import { createInputLevelMeter, SpeechSegmenter } from '../src/audio/segmenter.mjs';
import { createPCMFramer } from '../src/live-captions.mjs';

const workletSource = readFileSync(new URL('../src/audio/capture.worklet.js', import.meta.url), 'utf8');

function createProcessor(sampleRate, receive) {
  let Processor;
  class WorkletBase {
    port = { postMessage(message, transfer = []) {
      const received = structuredClone(message, { transfer });
      if (message.type === 'samples') {
        assert.equal(transfer.length, 1);
        assert.equal(message.samples.buffer.byteLength, 0, 'the sending buffer is detached');
      }
      receive(received);
    } };
  }
  runInNewContext(workletSource, {
    sampleRate, Float32Array, AudioWorkletProcessor: WorkletBase,
    registerProcessor(name, implementation) {
      assert.equal(name, 'habi-audio-capture');
      Processor = implementation;
    },
  });
  return new Processor();
}

for (const sampleRate of [16000, 44100, 48000]) {
  for (const channelCount of [1, 2]) {
    test(`${sampleRate} Hz, ${channelCount} channel(s): variable blocks and final flush preserve all samples`, () => {
      const packetSize = Math.round(sampleRate / 20), total = packetSize * 4 + 41;
      const channels = Array.from({ length: channelCount }, (_, ch) =>
        Float32Array.from({ length: total }, (_, at) => Math.sin((at + ch * 30) / 45) / (ch + 1)));
      const expected = Float32Array.from(channels[0], (_, i) =>
        channels.reduce((sum, channel) => sum + channel[i], 0) / channelCount);
      const received = [], messageTypes = [], packetLengths = [];
      const resampler = new StreamingResampler(sampleRate);
      const processor = createProcessor(sampleRate, message => {
        messageTypes.push(message.type);
        if (message.type === 'flushed') {
          assert.equal(message.requestId, 'stop');
          return;
        }
        packetLengths.push(message.samples.length);
        received.push(...resampler.push(message.samples));
      });
      const blocks = [7, 128, 2 * packetSize + 71, 256, 28];
      for (let i = 0, offset = 0; offset < total; i++) {
        const end = Math.min(total, offset + blocks[i % blocks.length]);
        const output = new Float32Array(end - offset).fill(1);
        assert.equal(processor.process([channels.map(ch => ch.subarray(offset, end))], [[output]]), true);
        assert.ok(output.every(sample => sample === 0), 'the graph output stays silent');
        offset = end;
      }
      processor.port.onmessage({ data: { type: 'flush', requestId: 'stop' } });
      processor.port.onmessage({ data: { type: 'flush', requestId: 'stop' } });
      received.push(...resampler.flush());
      assert.deepEqual(packetLengths, [packetSize, packetSize, packetSize, packetSize, 41]);
      assert.deepEqual(messageTypes.slice(-3), ['samples', 'flushed', 'flushed']);
      assert.deepEqual(new Float32Array(received), resampleMono(expected, sampleRate));
    });
  }
  test(`${sampleRate} Hz: a full provider frame is ready on the first 128-sample render after 50 ms`, () => {
    const resampler = new StreamingResampler(sampleRate);
    let inputFrames = 0, first = null;
    const framer = createPCMFramer(() => { first ??= inputFrames; }, 800);
    const processor = createProcessor(sampleRate, ({ samples }) => framer.push(resampler.push(samples)));
    const block = new Float32Array(128).fill(0.1);
    const expected = Math.ceil(Math.round(sampleRate / 20) / block.length) * block.length;
    while (inputFrames <= expected) {
      inputFrames += block.length;
      processor.process([[block]], []);
    }
    assert.equal(first, expected);
  });
}

test('level-only capture matches segmenter RMS for 20 ms windows, leftovers and repeated flushes', () => {
  const oldLevels = [], newLevels = [];
  const segmenter = new SpeechSegmenter({ onLevel: level => oldLevels.push(level) });
  const meter = createInputLevelMeter(level => newLevels.push(level));
  const pcm = Float32Array.from({ length: 9921 }, (_, i) => (i % 1999 < 800 ? 0 : Math.sin(i / 100)));
  for (let offset = 0; offset < pcm.length; offset += 683) {
    const block = pcm.subarray(offset, offset + 683);
    segmenter.push(block);
    meter.push(block);
  }
  segmenter.flush(); meter.flush();
  segmenter.flush(); meter.flush();
  assert.deepEqual(newLevels, oldLevels);
});
