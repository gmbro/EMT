import {withDeadline} from '../deadline.mjs';
import { StreamingResampler } from './pcm.mjs';
import { SpeechSegmenter } from './segmenter.mjs';
import captureWorkletUrl from './capture.worklet.js?worker&url';

/** Starts local PCM capture from an already-authorized MediaStream.
 * Caller supplies getUserMedia/getDisplayMedia; no browser recognition service
 * or network endpoint is used. stop() owns stream tracks by default. */
export async function createAudioCapture(stream, { onSegment = () => {}, onPCM, onLevel, onError = () => {}, onInputStatus = () => {}, onEnded, audioBuffer, audioContext, ...segmentOptions } = {}) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context || !window.AudioWorkletNode) {
    for (const track of stream?.getTracks() || []) track.stop();
    throw new Error('이 브라우저는 기기 내 오디오 캡처를 지원하지 않아요. 최신 브라우저를 사용해 주세요.');
  }
  let context;
  try {
    try { context = audioContext || new Context({ sampleRate: 16000, latencyHint: 'interactive' }); }
    catch { context = new Context({ latencyHint: 'interactive' }); }
  }
  catch (error) {
    for (const track of stream?.getTracks() || []) track.stop();
    throw error;
  }
  let source;
  let worklet;
  let processor;
  let silentGain;
  let stopPromise;
  let finished = false;
  let flushResolve;
  const segmenter = new SpeechSegmenter({ ...segmentOptions, sampleRate: 16000, onSegment, onLevel });
  const resampler = new StreamingResampler(context.sampleRate, 16000);
  const audioTracks = stream?.getAudioTracks() || [];
  let finishPlayback;
  const ended = audioBuffer ? new Promise(resolve => { finishPlayback = resolve; }) : null;
  const muteHandler = () => onInputStatus('오디오 입력이 음소거되었습니다. 마이크 또는 공유 탭의 소리를 확인해 주세요.');
  const unmuteHandler = () => onInputStatus('');
  const endHandler = () => {
    if (stopPromise) return;
    stop().then(() => onEnded?.()).catch(onError);
  };

  async function stop({ flush = true, stopTracks = true } = {}) {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      for (const track of audioTracks) {
        track.removeEventListener('ended', endHandler);
        track.removeEventListener('mute', muteHandler);
        track.removeEventListener('unmute', unmuteHandler);
      }
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
        const tail = resampler.flush(); onPCM?.(tail); segmenter.push(tail);
        segmenter.flush();
      }
      if (worklet) {
        worklet.port.onmessage = null;
        worklet.disconnect();
        worklet.port.close();
      }
      if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
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
    const receiveSamples = samples => {
      if (finished) return;
      try {
        const pcm = resampler.push(samples);
        onPCM?.(pcm);
        segmenter.push(pcm);
      } catch (error) { onError(error); }
    };
    try {
      await withDeadline(()=>context.audioWorklet.addModule(captureWorkletUrl),3000,'오디오 모듈 연결 시간 초과');
      worklet = new AudioWorkletNode(context, 'habi-audio-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    } catch (error) {
      if (!context.createScriptProcessor) throw error;
      processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = event => receiveSamples(event.inputBuffer.getChannelData(0));
    }
    if (worklet) {
      worklet.port.onmessage = ({ data }) => {
        if (data?.type === 'flushed') { flushResolve?.(); return; }
        if (data?.type === 'samples') receiveSamples(data.samples);
      };
      worklet.onprocessorerror = () => onError(new Error('기기 내 오디오 처리 중 오류가 발생했어요. 듣기를 다시 시작해 주세요.'));
    }
    if (audioBuffer) {
      source = context.createBufferSource(); source.buffer = audioBuffer; source.onended = () => finishPlayback?.();
    } else source = context.createMediaStreamSource(stream);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    const captureNode = worklet || processor;
    source.connect(captureNode);
    captureNode.connect(silentGain);
    silentGain.connect(context.destination);
    for (const track of audioTracks) {
      track.addEventListener('ended', endHandler);
      track.addEventListener('mute', muteHandler);
      track.addEventListener('unmute', unmuteHandler);
      if (track.muted) muteHandler();
    }
    await withDeadline(()=>context.resume(),8000,'오디오 입력이 시작되지 않았습니다. 장치와 브라우저 권한을 확인해 주세요.');
    if (context.state !== 'running') throw new Error('오디오 시작 권한을 확인한 뒤 시작 버튼을 다시 눌러주세요.');
    context.onstatechange=()=>{if(!finished&&!stopPromise&&context.state!=='running')onError(new Error('기기가 음성 입력을 일시 중단했어요. 화면을 켠 상태에서 시작을 다시 눌러주세요.'));};
    if (audioBuffer) source.start();
    return { stop, sampleRate: 16000, ended };
  } catch (error) {
    await stop({ flush: false });
    throw error;
  }
}
