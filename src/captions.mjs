export const CAPTION_LIMIT = 10000;
const characters = text => Array.from(text || '');
export const captionLength = record => characters(record.original).length + characters(record.translation).length;

/** Bound the in-memory transcript by Unicode characters, keeping complete,
 * chronological bilingual rows where possible. A single very long row keeps
 * the tail of both languages instead of splitting surrogate pairs. */
export function boundCaptionHistory(records, limit = CAPTION_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('A positive caption limit is required.');
  const kept = [...records];
  let count = kept.reduce((sum, record) => sum + captionLength(record), 0);
  let removed = 0;
  while (count > limit && kept.length > 1) {
    const length = captionLength(kept.shift());
    count -= length; removed += length;
  }
  if (count > limit) {
    const record = kept[0];
    const original = characters(record.original), translation = characters(record.translation);
    const originalBudget = Math.min(original.length, Math.round(limit * original.length / count));
    const translationBudget = limit - originalBudget;
    kept[0] = { ...record, original: originalBudget ? original.slice(-originalBudget).join('') : '',
      translation: translationBudget ? translation.slice(-translationBudget).join('') : '', clipped: true };
    removed += count - limit; count = limit;
  }
  return { records: kept, characterCount: count, removed };
}

export function mutateCaptionHistory(history, mutate) {
  const result = boundCaptionHistory(mutate(history.records));
  return { records: result.records, characterCount: result.characterCount,
    historyTrimmed: history.historyTrimmed + result.removed };
}

/** A throttle, not a debounce: continuous input cannot postpone the first run.
 * While one translation runs, only the newest draft is retained. invalidate()
 * suppresses results from an earlier utterance without dropping new work. */
export function createLatestTaskRunner({ run, publish, onError = () => {}, canRun = () => true,
  delay = 220, schedule = setTimeout, cancel = clearTimeout }) {
  let latest = null, timer = null, busy = false, generation = 0, disposed = false;
  const arm = () => {
    if (disposed || timer !== null || busy || !latest) return;
    timer = schedule(tick, delay);
  };
  const tick = async () => {
    timer = null;
    if (disposed || busy || !latest) return;
    if (!canRun()) { arm(); return; }
    const task = latest, current = generation;
    latest = null; busy = true;
    const emit = value => { if (!disposed && current === generation) publish(value, task); };
    try { const value = await run(task, emit); if (value !== undefined) emit(value); }
    catch (error) { if (!disposed && current === generation) onError(error, task); }
    finally { busy = false; arm(); }
  };
  return {
    submit(task) { if (!disposed) { latest = task; arm(); } },
    invalidate() { generation++; latest = null; if (timer !== null) cancel(timer); timer = null; },
    dispose() { this.invalidate(); disposed = true; },
  };
}
