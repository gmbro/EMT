/** Stateful, mono PCM resampling. Weighted averaging filters the
 * microphone's 44.1/48 kHz samples and preserves fractional positions between
 * AudioWorklet messages. The rates are integers, so timing does not drift. */
export class StreamingResampler {
  constructor(sourceRate, targetRate = 16000) {
    if (!Number.isInteger(sourceRate) || !Number.isInteger(targetRate) || sourceRate <= 0 || targetRate <= 0) {
      throw new RangeError('Audio sample rates must be positive integers.');
    }
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.weightedSum = 0;
    this.weight = 0;
  }

  push(samples) {
    if (!(samples instanceof Float32Array)) throw new TypeError('Expected Float32Array PCM.');
    if (this.sourceRate === this.targetRate) return samples.slice();
    const result = new Float32Array(Math.floor((this.weight + samples.length * this.targetRate) / this.sourceRate));
    let index = 0;
    for (const sample of samples) {
      let remaining = this.targetRate;
      while (remaining > 0) {
        const take = Math.min(remaining, this.sourceRate - this.weight);
        this.weightedSum += sample * take;
        this.weight += take;
        remaining -= take;
        if (this.weight === this.sourceRate) {
          result[index++] = this.weightedSum / this.sourceRate;
          this.weight = 0;
          this.weightedSum = 0;
        }
      }
    }
    return result;
  }

  // At capture end, retain the final fractional sample rather than dropping it.
  flush() {
    if (!this.weight) return new Float32Array(0);
    const result = new Float32Array([this.weightedSum / this.weight]);
    this.weight = 0;
    this.weightedSum = 0;
    return result;
  }
}

export function resampleMono(samples, sourceRate, targetRate = 16000) {
  const resampler = new StreamingResampler(sourceRate, targetRate);
  const full = resampler.push(samples);
  const last = resampler.flush();
  if (!last.length) return full;
  const result = new Float32Array(full.length + last.length);
  result.set(full);
  result.set(last, full.length);
  return result;
}
