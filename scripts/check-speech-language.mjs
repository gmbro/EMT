import { readFile } from 'node:fs/promises';
import { env, pipeline } from '@huggingface/transformers';
import { whisperAutoLanguageOptions } from '../src/speech-language.mjs';
import { MODEL_CATALOG } from '../src/models/catalog.js';
env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${process.cwd()}/public/models/`;
const recognizer = await pipeline('automatic-speech-recognition', MODEL_CATALOG.speech.localId, { dtype: 'q8', device: 'cpu', local_files_only: true });
try {
  for (const [file, expected] of [['en', 'en-US'], ['ko', 'ko-KR']]) {
    const wav = await readFile(`public/samples/${file}.wav`); let offset = 12, samples;
    while (offset + 8 <= wav.length) {
      const size = wav.readUInt32LE(offset + 4);
      if (wav.toString('ascii', offset, offset + 4) === 'data') { samples = new Float32Array(size / 2); for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(offset + 8 + i * 2) / 32768; break; }
      offset += 8 + size + (size % 2);
    }
    let detected;
    const started = performance.now();
    const result = await recognizer(samples, { ...whisperAutoLanguageOptions(recognizer.model.generation_config, language => { detected = language; }), task: 'transcribe', max_new_tokens: 100 });
    console.log(JSON.stringify({ sample: file, expected, detected, text: result.text, milliseconds: Math.round(performance.now() - started) }));
    if (detected !== expected) process.exitCode = 1;
  }
} finally { await recognizer.dispose(); }
