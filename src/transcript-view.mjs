// Preserve immutable reading blocks while just the live tail changes. Cached
// normalized rows also avoid rebuilding a whole meeting's text per search key.
export function createTranscriptView() {
  let previous = new Map();
  const searchable = new WeakMap();
  return (records, { detected = false, search = '' } = {}) => {
    const next = [], byId = new Map();
    for (const row of records) {
      const last = next.at(-1);
      if (last && !last.rows[0].translationBatch && !row.translationBatch && last.rows[0].language === row.language && (!detected || last.speaker === (row.speakerId || ''))) last.rows.push(row);
      else next.push({ speaker: row.speakerId || '', rows: [row] });
    }
    for (let index = 0; index < next.length; index++) {
      const group = next[index], key = group.rows[0].id, cached = previous.get(key);
      if (cached && cached.speaker === group.speaker && cached.rows.length === group.rows.length && cached.rows.every((row, at) => row === group.rows[at])) next[index] = cached;
      byId.set(key, next[index]);
    }
    previous = byId;
    const term = search.toLowerCase();
    if (!term) return next;
    return next.filter(group => group.rows.some(row => {
      if (!searchable.has(row)) searchable.set(row, `${row.original} ${row.translation || ''}`.toLowerCase());
      return searchable.get(row).includes(term);
    }));
  };
}

// Mount a bounded latest slice first, then reveal older groups in idle batches.
// Immutable IDs retain the loaded prefix when new live groups arrive.
export function transcriptMountWindow(groups, previous, viewKey, batchSize = 80) {
  let start = -1;
  if (previous?.viewKey === viewKey) {
    if (previous.complete) start = 0;
    else if (previous.firstId != null) start = groups.findIndex(group => group.rows[0].id === previous.firstId);
  }
  if (start < 0) start = Math.max(0, groups.length - batchSize);
  return { viewKey, start, firstId: groups[start]?.rows[0].id ?? null, complete: groups.length > 0 && start === 0 };
}

export function prependTranscriptWindow(groups, current, batchSize = 80) {
  const start = Math.max(0, current.start - batchSize);
  return { viewKey: current.viewKey, firstId: groups[start]?.rows[0].id ?? null, complete: groups.length > 0 && start === 0 };
}
