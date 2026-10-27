/** Native Translator streams are deltas, unlike the cumulative UI callback.
 * Bound each operation and abort it so a stalled draft cannot block finals. */
export async function translateNative(translator, text, { onText, timeoutMs = 20000, signal } = {}) {
  const controller = new AbortController();
  let reader;
  let timer;
  let active = true;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const operation = async () => {
    let output = '';
    if (onText && typeof translator.translateStreaming === 'function') {
      reader = translator.translateStreaming(text, { signal: controller.signal }).getReader();
      while (active) {
        const { done, value } = await reader.read();
        if (done) break;
        output += value;
        if (active && !controller.signal.aborted) onText(output);
      }
    } else {
      output = await translator.translate(text, { signal: controller.signal });
      if (active && !controller.signal.aborted) onText?.(output);
    }
    if (!output?.trim()) throw new Error('번역 결과가 비어 있어요. 이 문장의 다시 번역을 눌러주세요.');
    return output.trim();
  };
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason || new DOMException('Aborted', 'AbortError')); });
  controller.signal.addEventListener('abort', rejectAbort, { once: true });
  if (controller.signal.aborted) rejectAbort();
  try {
    return await Promise.race([operation(), aborted, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('번역 응답이 늦어졌어요. 원문은 남아 있으니 다시 번역해 주세요.');
        active = false; reject(error); controller.abort(error);
      }, timeoutMs);
    })]);
  } finally {
    active = false; clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
    if (reader) {
      if (controller.signal.aborted) void reader.cancel().catch(() => {});
      else reader.releaseLock();
    }
  }
}
