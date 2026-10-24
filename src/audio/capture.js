import { StreamingResampler } from './pcm.mjs';
import { SpeechSegmenter } from './segmenter.mjs';
import captureWorkletUrl from './capture.worklet.js?worker&url';

/** Starts local PCM capture from an already-authorized MediaStream.
 * Caller supplies getUserMedia/getDisplayMedia; no browser recognition service
 * or network endpoint is used. stop() owns stream tracks by default. */
export async function createAudioCapture(stream, { onSegment, onLevel, onError = () => {}, onEnded, audioBuffer, ...segmentOptions } = {}) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context || !window.AudioWorkletNode) {
    for (const track of stream?.getTracks() || []) track.stop();
    throw new Error('이 브라우저는 기기 내 오디오 캡처를 지원하지 않아요. 최신 브라우저를 사용해 주세요.');
  }
  let context;
  try {
    try { context = new Context({ sampleRate: 16000, latencyHint: 'interactive' }); }
    catch { context = new Context({ latencyHint: 'interactive' }); }
  }
  catch (error) {
    for (const track of stream?.getTracks() || []) track.stop();
    throw error;
  }
  let source;
  let worklet;
  let silentGain;
  let stopPromise;
  let finished = false;
  let flushResolve;
  const segmenter = new SpeechSegmenter({ ...segmentOptions, sampleRate: 16000, onSegment, onLevel });
  const resampler = new StreamingResampler(context.sampleRate, 16000);
  const audioTracks = stream?.getAudioTracks() || [];
  let finishPlayback;
  const ended = audioBuffer ? new Promise(resolve => { finishPlayback = resolve; }) : null;
  const endHandler = () => {
    if (stopPromise) return;
    stop().then(() => onEnded?.()).catch(onError);
  };

  async function stop({ flush = true, stopTracks = true } = {}) {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      for (const track of audioTracks) track.removeEventListener('ended', endHandler);
      source?.disconnect();
      if (audioBuffer) { try { source?.stop(); } catch {} finishPlayback?.(); }
      if (flush && worklet && context.state !== 'closed') {
        await new Promise(resolve => {
          const timeout = setTimeout(resolve, 1000);
          flushResolve = () => { clearTimeout(timeout); resolve(); };
          worklet.port.postMessage({ type: 'flush', requestId: 1 });
        });
      }
      finished = true;
      if (flush) {
        segmenter.push(resampler.flush());
        segmenter.flush();
      }
      if (worklet) {
        worklet.port.onmessage = null;
        worklet.disconnect();
        worklet.port.close();
      }
      silentGain?.disconnect();
      if (stopTracks) for (const track of stream?.getTracks() || []) track.stop();
      if (context.state !== 'closed') await context.close();
      onLevel?.(0);
    })();
    return stopPromise;
  }

  try {
    if (!audioBuffer && !audioTracks.some(track => track.readyState === 'live')) throw new Error('사용할 오디오 트랙이 없어요. 마이크 또는 탭 오디오를 확인해 주세요.');
    // Force a separate same-origin asset; small `new URL` assets can otherwise
    // become data: URLs in production and be refused by the site's CSP.
    await context.audioWorklet.addModule(captureWorkletUrl);
    worklet = new AudioWorkletNode(context, 'habi-audio-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    worklet.port.onmessage = ({ data }) => {
      if (data?.type === 'flushed') { flushResolve?.(); return; }
      if (!finished && data?.type === 'samples') {
        try { segmenter.push(resampler.push(data.samples)); }
        catch (error) { onError(error); }
      }
    };
    worklet.onprocessorerror = () => onError(new Error('기기 내 오디오 처리 중 오류가 발생했어요. 듣기를 다시 시작해 주세요.'));
    if (audioBuffer) {
      source = context.createBufferSource(); source.buffer = audioBuffer; source.onended = () => finishPlayback?.();
    } else source = context.createMediaStreamSource(stream);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(worklet);
    worklet.connect(silentGain);
    silentGain.connect(context.destination);
    for (const track of audioTracks) track.addEventListener('ended', endHandler);
    await context.resume();
    if (context.state !== 'running') throw new Error('오디오 시작 권한을 확인한 뒤 시작 버튼을 다시 눌러주세요.');
    if (audioBuffer) source.start();
    return { stop, sampleRate: 16000, ended };
  } catch (error) {
    await stop({ flush: false });
    throw error;
  }
}
