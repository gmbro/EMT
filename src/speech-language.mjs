// Transformers v4.3.1 defaults to English when language is omitted. Detect the
// acoustic language token in the normal decoding pass, then force transcribe
// and no-timestamps tokens. This reuses the encoder and KV cache for the text.
export function chooseSpeechLanguage(logits, ids) {
  if (!logits || !Number.isInteger(ids?.en) || !Number.isInteger(ids?.ko) || !Number.isFinite(logits[ids.en]) || !Number.isFinite(logits[ids.ko])) throw new Error('음성 언어를 감지하지 못했어요. 설정에서 인식 언어를 선택해 주세요.');
  return logits[ids.ko] > logits[ids.en] ? 'ko-KR' : 'en-US';
}
export function whisperAutoLanguageOptions(config, onLanguage = () => {}) {
  const ids = { en: config.lang_to_id['<|en|>'], ko: config.lang_to_id['<|ko|>'] };
  const processor = (inputIds, logits) => {
    const step = inputIds[0].length;
    if (step > 3) return logits;
    let token;
    if (step === 1) {
      const language = chooseSpeechLanguage(logits.data, ids);
      onLanguage(language); token = language === 'ko-KR' ? ids.ko : ids.en;
    } else token = step === 2 ? config.task_to_id.transcribe : config.no_timestamps_token_id;
    if (!Number.isInteger(token)) throw new Error('음성 모델의 언어 설정을 읽지 못했어요.');
    logits.data.fill(-Infinity); logits.data[token] = 0;
    return logits;
  };
  return { decoder_input_ids: [[config.decoder_start_token_id]], logits_processor: [processor] };
}
