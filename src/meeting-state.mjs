// Record objects and arrays stay immutable. Reuse the ID index across ordinary
// row patches, and rebuild lazily after a bulk restore/filter/reorder.
export function createRecordIndex() {
  let current = null;
  const indices = new Map();
  function sync(records) {
    if (current === records) return;
    indices.clear();
    records.forEach((record, index) => { if (!indices.has(record.id)) indices.set(record.id, index); });
    current = records;
  }
  return {
    indexOf(records, id) { sync(records); return indices.get(id) ?? -1; },
    get(records, id) { const index = this.indexOf(records, id); return index < 0 ? undefined : records[index]; },
    updated(before, after, index) {
      if (current === before && before.length === after.length && before[index]?.id === after[index]?.id) current = after;
    },
    inserted(before, after, index) {
      if (current !== before || after.length !== before.length + 1) return;
      if (indices.has(after[index].id)) { current = null; return; }
      for (let offset = index; offset < after.length; offset++) indices.set(after[offset].id, offset);
      current = after;
    },
  };
}

export const unchangedRecord = (before, after) => Object.keys(after).every(key => Object.is(before[key], after[key]));

// The current UI displays input-active/input-idle, not a numeric volume meter.
// Publish every threshold transition immediately; amplitude-only changes need
// not re-render the transcript and all of its controls on every PCM frame.
export function createInputActivityPublisher(publish, threshold = .01) {
  let active = false;
  return {
    update(value) {
      const next = value > threshold;
      if (active === next) return;
      active = next;
      publish(value);
    },
    reset() { active = false; publish(0); },
  };
}

// A slow browser must not build an ever-growing queue of obsolete, full-meeting
// checkpoints. Keep the active write and at most the newest pending snapshot.
// Archive finalization awaits flush() before deleting the temporary checkpoint.
export function createLatestCheckpointWriter({ write, onSaved = () => {}, onError = () => {} }) {
  let active = null, pending = null, running = null;
  const same = (left, right) => left && right && left.key === right.key && left.stamp === right.stamp;
  function start() {
    if (running) return;
    running = Promise.resolve().then(async () => {
      while (pending) {
        const item = pending; pending = null; active = item;
        try { await write(item.key, item.snapshot); onSaved(item); }
        catch (error) { onError(error); }
        finally { active = null; }
      }
    }).finally(() => { running = null; if (pending) start(); });
  }
  return {
    submit(key, stamp, snapshot) {
      const item = { key, stamp, snapshot };
      if (same(active, item) || same(pending, item)) return;
      pending = item; start();
    },
    async flush() { while (running) await running; },
  };
}
