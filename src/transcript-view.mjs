function belongsToGroup(first, row, detected) {
  return !first.translationBatch && !row.translationBatch && first.language === row.language &&
    (!detected || (first.speakerId || '') === (row.speakerId || ''));
}

function groupRecords(records, detected, byFirstRow, previous) {
  let reuse = 0;
  if (previous && detected === previous.detected) {
    let prefix = 0;
    const count = Math.min(records.length, previous.records.length);
    while (prefix < count && records[prefix] === previous.records[prefix]) prefix++;
    if (prefix === records.length && prefix === previous.records.length) return { ...previous, records };
    if (prefix) {
      reuse = previous.ends.findLastIndex(end => end <= prefix) + 1;
      // A replacement or append can now join the last unchanged paragraph.
      const next = records[previous.ends[reuse - 1]];
      if (reuse && next && belongsToGroup(previous.groups[reuse - 1].rows[0], next, detected)) reuse--;
    }
  }
  const groups = reuse ? previous.groups.slice(0, reuse) : [];
  const ends = reuse ? previous.ends.slice(0, reuse) : [];
  for (let start = ends.at(-1) || 0; start < records.length;) {
    const first = records[start];
    let end = start + 1;
    if (!first.translationBatch) {
      while (end < records.length && belongsToGroup(first, records[end], detected)) end++;
    }
    let group = byFirstRow.get(first);
    if (!group || group.rows.length !== end - start ||
        (end > start + 1 && !group.rows.every((row, offset) => row === records[start + offset]))) {
      group = { speaker: first.speakerId || '', rows: records.slice(start, end) };
      byFirstRow.set(first, group);
    }
    groups.push(group);
    ends.push(end);
    start = end;
  }
  return { records, detected, groups, ends };
}

// A translation update replaces only its immutable row. Reuse the other
// paragraphs and their search matches without allocating their rows again.
export function createTranscriptView() {
  const byFirstRow = new WeakMap(), searchable = new WeakMap();
  let previous;
  let previousTerm, matches;
  return (records, { detected = false, search = '' } = {}) => {
    if (records !== previous?.records || detected !== previous.detected) {
      previous = groupRecords(records, detected, byFirstRow, previous);
    }
    const { groups } = previous;
    const term = search.toLowerCase();
    if (!term) return groups;
    if (term !== previousTerm) {
      matches = new WeakMap();
      previousTerm = term;
    }
    return groups.filter(group => {
      if (!matches.has(group)) {
        const match = group.rows.some(row => {
          if (!searchable.has(row)) searchable.set(row, `${row.original} ${row.translation || ''}`.toLowerCase());
          return searchable.get(row).includes(term);
        });
        matches.set(group, match);
      }
      return matches.get(group);
    });
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
