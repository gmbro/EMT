// Memory-only diagnostics. Never retain meeting text, audio, keys or request URLs.
const rows = [];
const listeners = new Set();
const audio = new Map();
export function recordAudioUsage(id, metric) {
  audio.set(id, metric);
  if(audio.size>200)audio.delete(audio.keys().next().value);
  for(const listener of listeners)listener();
}
export function recordRequest(metric) {
  rows.push({task:metric.task, status:metric.status, code:metric.code, attempt:metric.attempt,
    milliseconds:metric.milliseconds, firstTokenMs:metric.firstTokenMs, usage:metric.usage || null});
  if(rows.length>2000) rows.shift();
  for(const listener of listeners) listener();
}
export function usageSummary() {
  const known = rows.filter(r=>r.usage), tasks = {}, byTask = {};
  for(const row of rows) {
    tasks[row.task]=(tasks[row.task]||0)+1;
    const bucket=byTask[row.task] ||= {requests:0,unknown:0,input:0,output:0,thought:0,cached:0,failures:0};
    bucket.requests++;bucket.unknown+=row.usage?0:1;bucket.failures+=row.status==='complete'?0:1;
    for(const [name,field] of [['input','total_input_tokens'],['output','total_output_tokens'],['thought','total_thought_tokens'],['cached','total_cached_tokens']])bucket[name]+=row.usage?.[field]||0;
  }
  const audioTotals=[...audio.values()].reduce((sum,row)=>({capturedSeconds:sum.capturedSeconds+row.capturedSeconds,sentSeconds:sum.sentSeconds+row.sentSeconds,reconnections:sum.reconnections+row.reconnections,usageReports:sum.usageReports+row.usageReports}),{capturedSeconds:0,sentSeconds:0,reconnections:0,usageReports:0});
  return {audio:audioTotals,requests:rows.length, unknown:rows.length-known.length, failures:rows.filter(r=>r.status!=='complete').length,
    input:known.reduce((n,r)=>n+(r.usage.total_input_tokens||0),0), output:known.reduce((n,r)=>n+(r.usage.total_output_tokens||0),0),
    thought:known.reduce((n,r)=>n+(r.usage.total_thought_tokens||0),0),
    cached:known.reduce((n,r)=>n+(r.usage.total_cached_tokens||0),0), tasks, byTask};
}
export const subscribeUsage = listener => {listeners.add(listener); return ()=>listeners.delete(listener);};
