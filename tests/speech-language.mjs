import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSpeechLanguage, whisperAutoLanguageOptions } from '../src/speech-language.mjs';
test('speech language is selected from acoustic token scores, not an English default', () => {
  assert.equal(chooseSpeechLanguage(new Float32Array([0, 1, 5]), { en: 1, ko: 2 }), 'ko-KR');
  assert.equal(chooseSpeechLanguage(new Float32Array([0, 6, 1]), { en: 1, ko: 2 }), 'en-US');
  assert.throws(() => chooseSpeechLanguage(new Float32Array([0]), { en: 1, ko: 2 }), /감지하지 못/);
});
test('one-pass bilingual decoding chooses an acoustic language then forces transcription and preserves later text scores', () => {
  const config = { decoder_start_token_id: 0, lang_to_id: {'<|en|>':1,'<|ko|>':2}, task_to_id:{transcribe:3}, no_timestamps_token_id:4 };
  let detected;
  const options = whisperAutoLanguageOptions(config, language=>{ detected=language; });
  assert.deepEqual(options.decoder_input_ids, [[0]]);
  const process = options.logits_processor[0];
  const logits = { data:new Float32Array([1,2,9,100,10]) };
  process([[0n]],logits); assert.equal(detected,'ko-KR');
  assert.deepEqual([...logits.data],[-Infinity,-Infinity,0,-Infinity,-Infinity]);
  process([[0n,2n]],logits); assert.equal(logits.data[3],0);
  process([[0n,2n,3n]],logits); assert.equal(logits.data[4],0);
  logits.data.set([1,2,3,4,5]); process([[0n,2n,3n,4n]],logits);
  assert.deepEqual([...logits.data],[1,2,3,4,5]);
});
