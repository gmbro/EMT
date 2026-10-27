// Turbo uses q4 weights with fp32 activations, avoiding the known fp16 Whisper
// overflow. If GPU cannot run it, explicitly disclose the smaller CPU model.
export function speechConfiguration(profile = 'fast', webgpu = false) {
  if (profile !== 'quality') return { profile: 'fast', key: 'speech', device: 'wasm', dtype: 'q8', label: 'Whisper Base · CPU' };
  return webgpu
    ? { profile: 'quality', key: 'speechTurbo', device: 'webgpu', dtype: 'q4', label: 'Whisper Large v3 Turbo · GPU' }
    : { profile: 'quality', key: 'speechQuality', device: 'wasm', dtype: 'q8', label: 'GPU 미지원: Whisper Small · CPU', notice: '이 기기에서는 GPU 모델 대신 Whisper Small을 CPU에서 실행해요. 실시간 속도는 기기에 따라 달라요.' };
}

export function localModelURL(input, origin, prefixes, method = 'GET') {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
  if (url.origin !== origin || url.search || !prefixes.some(prefix => url.pathname.startsWith(prefix)) || !['GET', 'HEAD'].includes(method)) {
    throw new Error('Only static local model files may be requested.');
  }
  return url;
}
