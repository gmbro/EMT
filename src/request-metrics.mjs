// Memory-only diagnostics. Keep only task names and numeric counters.
const rows = [];
const listeners = new Set();
const audio = new Map();
const tasks = new Map();
const emptyRequestTotals = () => ({ requests: 0, unknown: 0, input: 0, output: 0, thought: 0, cached: 0, failures: 0 });
const totals = emptyRequestTotals();
const countFields = Object.keys(totals);
const finite = value => Number.isFinite(value) ? value : 0;
let oldest = 0;

export function recordAudioUsage(id, metric) {
  audio.set(id, {
    capturedSeconds: finite(metric.capturedSeconds), sentSeconds: finite(metric.sentSeconds),
    reconnections: finite(metric.reconnections), usageReports: finite(metric.usageReports),
  });
  if (audio.size > 200) audio.delete(audio.keys().next().value);
  for (const listener of listeners) listener();
}

function addRequest(row, sign) {
  let bucket = tasks.get(row.task);
  if (!bucket) {
    bucket = emptyRequestTotals();
    tasks.set(row.task, bucket);
  }
  for (const field of countFields) {
    const delta = sign * row[field];
    bucket[field] += delta;
    totals[field] += delta;
  }
  if (!bucket.requests) tasks.delete(row.task);
}

export function recordRequest({ task, status, usage }) {
  const row = {
    task, requests: 1, unknown: usage ? 0 : 1, failures: status === 'complete' ? 0 : 1,
    input: finite(usage?.total_input_tokens), output: finite(usage?.total_output_tokens),
    thought: finite(usage?.total_thought_tokens), cached: finite(usage?.total_cached_tokens),
  };
  if (rows.length === 2000) {
    addRequest(rows[oldest], -1);
    rows[oldest] = row;
    oldest = (oldest + 1) % rows.length;
  } else rows.push(row);
  addRequest(row, 1);
  for (const listener of listeners) listener();
}

export function usageSummary() {
  const audioTotals = { capturedSeconds: 0, sentSeconds: 0, reconnections: 0, usageReports: 0 };
  for (const row of audio.values()) {
    audioTotals.capturedSeconds += row.capturedSeconds;
    audioTotals.sentSeconds += row.sentSeconds;
    audioTotals.reconnections += row.reconnections;
    audioTotals.usageReports += row.usageReports;
  }
  const byTask = Object.fromEntries(Array.from(tasks, ([name, bucket]) => [name, { ...bucket }]));
  const counts = Object.fromEntries(Array.from(tasks, ([name, bucket]) => [name, bucket.requests]));
  return { audio: audioTotals, ...totals, tasks: counts, byTask };
}

export const subscribeUsage = listener => { listeners.add(listener); return () => listeners.delete(listener); };
