function rms(samples) {
  if (!samples.length) return 0;
  let energy = 0;
  for (const value of samples) energy += value * value;
  return Math.sqrt(energy / samples.length);
}

function join(pieces, length) {
  const result = new Float32Array(length);
  let offset = 0;
  for (const piece of pieces) {
    result.set(piece, offset);
    offset += piece.length;
  }
  return result;
}

/** Splits 16 kHz PCM around pauses. Silence is intentionally excluded until
 * speech begins; a short preroll protects the first consonant. During long
 * speech, max-size boundaries are contiguous with no repeated/dropped audio. */
export class SpeechSegmenter {
  constructor({
    sampleRate = 16000,
    maxSeconds = 6,
    silenceMs = 650,
    preRollMs = 250,
    minSpeechMs = 180,
    threshold = 0.008,
    previewMs = 1200,
    onPreview,
    onSegment = () => {},
    onLevel = () => {},
  } = {}) {
    if (!Number.isInteger(sampleRate) || sampleRate < 1 || !Number.isFinite(maxSeconds) || maxSeconds <= 0
      || !Number.isFinite(silenceMs) || silenceMs < 0 || !Number.isFinite(preRollMs) || preRollMs < 0
      || !Number.isFinite(minSpeechMs) || minSpeechMs < 0 || !Number.isFinite(threshold) || threshold < 0) {
      throw new RangeError('Invalid audio segmentation settings.');
    }
    this.sampleRate = sampleRate;
    this.frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
    this.maxSamples = Math.max(this.frameSamples, Math.round(sampleRate * maxSeconds));
    this.silenceLimit = Math.round(sampleRate * silenceMs / 1000);
    this.preRollLimit = Math.round(sampleRate * preRollMs / 1000);
    this.minSpeechSamples = Math.round(sampleRate * minSpeechMs / 1000);
    this.threshold = threshold;
    this.onSegment = onSegment;
    this.onPreview = onPreview;
    this.previewSamples = Math.max(this.frameSamples, Math.round(sampleRate * previewMs / 1000));
    this.nextPreviewAt = this.previewSamples;
    this.segmentId = 1;
    this.onLevel = onLevel;
    this.pending = new Float32Array(0);
    this.preRoll = [];
    this.preRollSamples = 0;
    this.pieces = [];
    this.segmentSamples = 0;
    this.segmentVoicedSamples = 0;
    this.utteranceVoicedSamples = 0;
    this.silentSamples = 0;
    this.active = false;
  }

  push(samples) {
    if (!(samples instanceof Float32Array)) throw new TypeError('Expected Float32Array PCM.');
    const incoming = this.pending.length ? join([this.pending, samples], this.pending.length + samples.length) : samples;
    let offset = 0;
    while (offset + this.frameSamples <= incoming.length) {
      this.processFrame(incoming.slice(offset, offset + this.frameSamples));
      offset += this.frameSamples;
    }
    this.pending = incoming.slice(offset);
  }

  processFrame(frame) {
    const level = rms(frame);
    const voiced = level >= this.threshold;
    this.onLevel(level);
    if (!this.active) {
      if (!voiced) {
        this.rememberPreRoll(frame);
        return;
      }
      this.active = true;
      this.utteranceVoicedSamples = frame.length;
      for (const previous of this.preRoll) this.append(previous, false);
      this.preRoll = [];
      this.preRollSamples = 0;
    } else if (voiced) {
      this.utteranceVoicedSamples += frame.length;
    }
    this.silentSamples = voiced ? 0 : this.silentSamples + frame.length;
    this.append(frame, voiced);
    // A preview is a copy, never a consumed chunk. The final segment retains
    // every sample. Slow devices may skip previews without dropping speech.
    if (voiced && this.onPreview && this.segmentSamples >= this.nextPreviewAt
      && this.segmentVoicedSamples >= this.minSpeechSamples) {
      this.nextPreviewAt = this.segmentSamples + this.previewSamples;
      this.onPreview({ samples: join(this.pieces, this.segmentSamples),
        duration: this.segmentSamples / this.sampleRate, segmentId: this.segmentId, reason: 'preview' });
    }
    if (!voiced && this.silentSamples >= this.silenceLimit) {
      this.emit('silence');
      this.active = false;
      this.utteranceVoicedSamples = 0;
      this.silentSamples = 0;
      this.rememberPreRoll(frame);
    }
  }

  rememberPreRoll(frame) {
    if (!this.preRollLimit) return;
    this.preRoll.push(frame);
    this.preRollSamples += frame.length;
    while (this.preRollSamples > this.preRollLimit) {
      const excess = this.preRollSamples - this.preRollLimit;
      const first = this.preRoll[0];
      if (first.length <= excess) {
        this.preRoll.shift();
        this.preRollSamples -= first.length;
      } else {
        this.preRoll[0] = first.slice(excess);
        this.preRollSamples -= excess;
      }
    }
  }

  append(frame, voiced) {
    let offset = 0;
    while (offset < frame.length) {
      const count = Math.min(frame.length - offset, this.maxSamples - this.segmentSamples);
      this.pieces.push(frame.slice(offset, offset + count));
      this.segmentSamples += count;
      if (voiced) this.segmentVoicedSamples += count;
      offset += count;
      if (this.segmentSamples === this.maxSamples) this.emit('max');
    }
  }

  emit(reason) {
    const qualified = this.utteranceVoicedSamples >= this.minSpeechSamples;
    // Do not ask Whisper to transcribe pure silence after a max-size split.
    if (this.segmentSamples && this.segmentVoicedSamples && qualified) {
      const samples = join(this.pieces, this.segmentSamples);
      this.onSegment({
        samples,
        duration: samples.length / this.sampleRate,
        speechDuration: this.segmentVoicedSamples / this.sampleRate,
        reason,
        segmentId: this.segmentId,
      });
    }
    this.pieces = [];
    this.segmentSamples = 0;
    this.segmentVoicedSamples = 0;
    this.nextPreviewAt = this.previewSamples;
    this.segmentId++;
  }

  flush(reason = 'stop') {
    if (this.pending.length) {
      const last = this.pending;
      this.pending = new Float32Array(0);
      this.processFrame(last);
    }
    this.emit(reason);
    this.preRoll = [];
    this.preRollSamples = 0;
    this.utteranceVoicedSamples = 0;
    this.silentSamples = 0;
    this.active = false;
    this.onLevel(0);
  }
}
