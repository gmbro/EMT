// Silence is not a failed response. Start the deadline with new speech, not
// with the last transcript (which may have arrived minutes ago).
export function createSpeechHealth({ now = () => performance.now() } = {}) {
  let awaiting = null, nudged = false, lastVoice = null;
  return {
    voice() { lastVoice = now(); awaiting ??= lastVoice; },
    response() { awaiting = null; nudged = false; },
    check() {
      if (awaiting === null) return null;
      if (now() - lastVoice > 3000) { awaiting = null; nudged = false; return null; }
      const age = now() - awaiting;
      if (age >= 24000) { awaiting = now(); nudged = false; return 'recover'; }
      if (age >= 12000 && !nudged) { nudged = true; return 'finalize'; }
      return null;
    },
  };
}

// Conservative silence-only gate: retain 400 ms before speech and 1.2 s
// after it. Background noise keeps streaming rather than cutting quiet words.
export function createSilenceGate({ send, end, threshold = .0005 } = {}) {
  let active = false, quiet = 0, prefix = [], prefixSamples=0;
  return {
    push(pcm) {
      const voiced = Math.sqrt(pcm.reduce((sum, n) => sum + n * n, 0) / Math.max(1, pcm.length)) >= threshold;
      if (!active) {
        prefix.push(pcm.slice());prefixSamples+=pcm.length;
        // Keep 400 ms independently of the caller's packet size.
        while(prefix.length>1 && prefixSamples-prefix[0].length>=6400)prefixSamples-=prefix.shift().length;
        if (!voiced) return { voiced, heldSamples: pcm.length };
        active = true; quiet = 0;
        for (const frame of prefix) send(frame);
        prefix = [];prefixSamples=0;
      } else {
        send(pcm); quiet = voiced ? 0 : quiet + pcm.length;
        if (quiet >= 19200) { active = false; quiet = 0; end(); }
      }
      return { voiced, heldSamples: 0 };
    },
  };
}
