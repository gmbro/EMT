const INSTALLABLE = new Set(['downloadable', 'downloading']);
const SUPPORTED = new Set(['available', ...INSTALLABLE]);

function aborted() {
  const error = new Error('Local speech preparation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function deadline(operation, milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      callback(value);
    };
    const cancel = () => finish(reject, aborted());
    const timer = setTimeout(() => {
      const error = new Error('The browser local speech API did not respond in time.');
      error.name = 'TimeoutError';
      finish(reject, error);
    }, milliseconds);
    signal?.addEventListener('abort', cancel, { once: true });
    Promise.resolve().then(operation).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

function candidateOptions(language) {
  return [
    { langs: [language], processLocally: true, quality: 'dictation' },
    { langs: [language], processLocally: true },
  ];
}

function description(Recognition, language, options, status) {
  return { Recognition, language, options, status, ...(options.quality ? { quality: options.quality } : {}) };
}

function validRecognizer(Recognition, language) {
  return typeof Recognition === 'function' && typeof Recognition.available === 'function' && typeof language === 'string' && Boolean(language.trim());
}

async function probe(Recognition, options, { availabilityTimeoutMs = 10000, signal } = {}) {
  return deadline(() => Recognition.available(options), availabilityTimeoutMs, signal);
}

/** Probe the selected locale only. A browser may support English locally while
 * Korean is unavailable; asking for both would unnecessarily block English.
 * Dictation is preferred, then the browser's default capability is checked. */
export async function getLocalSpeechSupport(Recognition, language, timing = {}) {
  if (timing.signal?.aborted) throw aborted();
  if (!validRecognizer(Recognition, language)) return null;
  for (const options of candidateOptions(language)) {
    try {
      const status = await probe(Recognition, options, timing);
      if (SUPPORTED.has(status) && (status === 'available' || typeof Recognition.install === 'function')) {
        return description(Recognition, language, options, status);
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Newer quality options may be rejected by older local implementations.
    }
  }
  return null;
}

/** Prepare a native on-device recognizer, otherwise return null so the caller
 * can choose a separate device-local engine. It never enables remote speech. */
export async function prepareLocalSpeech(Recognition, language, onStatus = () => {}, timing = {}) {
  if (timing.signal?.aborted) throw aborted();
  const report = (phase, message) => onStatus({ phase, language, message });
  report('checking', '선택한 언어의 기기 내 음성 모델을 확인하고 있어요.');
  if (!validRecognizer(Recognition, language)) {
    report('unavailable', '브라우저 내장 로컬 음성 모델을 사용할 수 없어요.');
    return null;
  }

  let failed = false;
  for (const options of candidateOptions(language)) {
    try {
      let status = await probe(Recognition, options, timing);
      if (!SUPPORTED.has(status)) continue;
      if (INSTALLABLE.has(status)) {
        if (typeof Recognition.install !== 'function') continue;
        report('downloading', '선택한 언어의 기기 내 음성 모델을 내려받고 있어요.');
        const installed = await deadline(() => Recognition.install(options), timing.installTimeoutMs ?? 120000, timing.signal);
        if (installed !== true) { failed = true; continue; }
        // available() and install() must use the same quality capability floor.
        status = await probe(Recognition, options, timing);
        const readyBy = Date.now() + (timing.availabilityTimeoutMs ?? 10000);
        while (INSTALLABLE.has(status) && Date.now() < readyBy) {
          await deadline(() => new Promise(resolve => setTimeout(resolve, timing.readinessPollMs ?? 500)), (timing.readinessPollMs ?? 500) + 1000, timing.signal);
          status = await probe(Recognition, options, { ...timing, availabilityTimeoutMs: Math.max(1, readyBy - Date.now()) });
        }
      }
      if (status === 'available') {
        const prepared = description(Recognition, language, options, status);
        // Verify that an older/prefixed recognizer cannot silently ignore the
        // local requirement before reporting it ready.
        createLocalRecognition(prepared);
        report('ready', '선택한 언어의 기기 내 음성 모델이 준비됐어요.');
        return prepared;
      }
      failed = true;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      failed = true;
    }
  }
  report(failed ? 'failed' : 'unavailable', failed ? '브라우저 내장 음성 모델 준비에 실패했어요.' : '선택한 언어의 브라우저 내장 음성 모델이 지원되지 않아요.');
  return null;
}

export function createLocalRecognition(prepared) {
  if (!prepared || prepared.status !== 'available' || typeof prepared.Recognition !== 'function') {
    throw new Error('A prepared on-device speech recognizer is required.');
  }
  const recognition = new prepared.Recognition();
  // Assigning an unknown property creates an expando on old SpeechRecognition
  // objects. Require actual API support so that cannot masquerade as privacy.
  if (!('processLocally' in recognition)) throw new Error('이 음성 인식기는 기기 내 처리를 보장하지 않아요.');
  recognition.lang = prepared.language;
  recognition.processLocally = true;
  if (recognition.processLocally !== true) throw new Error('이 음성 인식기에서 기기 내 처리를 설정하지 못했어요.');
  // The specification currently defines quality for availability/install. Keep
  // the hint on instances for implementations exposing the same option.
  if (prepared.quality) recognition.quality = prepared.quality;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}
