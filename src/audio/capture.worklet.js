class HabiAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    // Deliver one 50 ms packet at the actual AudioContext rate.
    this.buffer = new Float32Array(Math.max(1, Math.round(sampleRate / 20)));
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed', requestId: data.requestId });
      }
    };
  }

  flush() {
    if (!this.offset) return;
    const full = this.offset === this.buffer.length;
    const samples = full ? this.buffer : this.buffer.slice(0, this.offset);
    if (full) this.buffer = new Float32Array(samples.length);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.offset = 0;
  }

  process(inputs, outputs) {
    // Output remains silent; this node never plays microphone/tab audio back.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    if (channels.length === 1) {
      const input = channels[0];
      for (let start = 0; start < frames;) {
        const count = Math.min(frames - start, this.buffer.length - this.offset);
        this.buffer.set(input.subarray(start, start + count), this.offset);
        this.offset += count;
        start += count;
        if (this.offset === this.buffer.length) this.flush();
      }
      return true;
    }
    for (let i = 0; i < frames; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i];
      this.buffer[this.offset++] = mono / channels.length;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('habi-audio-capture', HabiAudioCapture);
