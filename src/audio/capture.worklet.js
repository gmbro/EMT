class HabiAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
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
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.offset = 0;
  }

  process(inputs, outputs) {
    // Output remains silent; this node never plays microphone/tab audio back.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
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
