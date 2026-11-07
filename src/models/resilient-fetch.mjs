const transient = error => error.code !== 'INVALID_RANGE' && error.code !== 'INVALID_SIZE' && error.name !== 'AbortError';
const networkError = () => Object.assign(new Error('모델 다운로드 연결이 끊겼어요. 네트워크를 확인한 뒤 다시 준비해 주세요.'), { code: 'MODEL_NETWORK' });

/** Preserve already delivered bytes and resume immutable same-origin files.
 * A server that ignores or changes a requested range is never concatenated. */
export async function fetchModelAsset(url, options, { bytes, fetchImpl = fetch, onRetry = () => {}, retries = 2, timeoutMs = 30000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let reader, controller, release, retryCount = 0, offset = 0;
  const signal = options?.signal;
  async function close() {
    controller?.abort(); release?.();
    try { await reader?.cancel(); } catch {}
    reader = null;
  }
  async function connect() {
    controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    release = () => signal?.removeEventListener('abort', abort);
    const headers = new Headers(options?.headers);
    if (offset) headers.set('Range', `bytes=${offset}-`);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try { response = await fetchImpl(url, { ...options, headers, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw networkError(); }
    if (offset) {
      const range = response.headers.get('content-range');
      if (response.status !== 206 || range !== `bytes ${offset}-${bytes - 1}/${bytes}`) {
        await response.body?.cancel(); throw Object.assign(networkError(), { code: 'INVALID_RANGE' });
      }
    }
    return response;
  }
  async function recover(error) {
    await close();
    if (signal?.aborted) throw Object.assign(new Error('다운로드가 취소됐어요.'), { name: 'AbortError' });
    // An internal timeout can be retried even though fetch labels it AbortError.
    if (retryCount >= retries || (!transient(error) && error.name !== 'AbortError')) throw error.code ? error : networkError();
    onRetry({ attempt: ++retryCount, offset }); await wait(300 * retryCount);
  }
  let first;
  while (!first) { try { first = await connect(); } catch (error) { await recover(error); } }
  if (!first.ok || options?.method === 'HEAD' || !bytes || !first.body) { release?.(); return first; }
  reader = first.body.getReader();
  const headers = new Headers(first.headers);
  headers.delete('content-encoding'); headers.set('content-length', String(bytes));
  return new Response(new ReadableStream({
    async pull(output) {
      while (true) {
        try {
          if (!reader) {
            const response = await connect();
            if (!response.ok || !response.body) throw networkError();
            reader = response.body.getReader();
          }
          let timeout;
          let result;
          try { result = await Promise.race([reader.read(), new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(networkError()); }, timeoutMs); })]); }
          finally { clearTimeout(timeout); }
          if (result.done) {
            if (offset !== bytes) throw networkError();
            release?.(); output.close(); return;
          }
          if (offset + result.value.byteLength > bytes) throw Object.assign(networkError(), { code: 'INVALID_SIZE' });
          offset += result.value.byteLength; output.enqueue(result.value); return;
        } catch (error) {
          try { await recover(error); } catch (failure) { output.error(failure); return; }
        }
      }
    },
    async cancel() { await close(); },
  }), { status: first.status, headers });
}
