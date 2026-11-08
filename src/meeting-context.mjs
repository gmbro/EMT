// Extractive context only: no extra model calls, invented summary or draft speech.
const terms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !['the','and','that','this','with','have','will','could','would','please'].includes(w)));
export function meetingContext(records, { before = Infinity, text = '', guide = false, purpose = '' } = {}) {
  const rows = records.filter(r => !r.sourcePending && r.status !== 'recognizing' && r.createdAt < before && r.original?.trim());
  const recent = rows.slice(guide ? -4 : -2), query = terms(text), chosen = new Set(recent);
  const ranked = rows.slice(0, -recent.length || rows.length).map((row, index) => ({row, index, score:[...terms(row.original)].filter(w=>query.has(w)).length}));
  for (const {row,score} of ranked.sort((a,b)=>b.score-a.score||b.index-a.index).slice(0, guide ? 3 : 1)) if(score >= 2) chosen.add(row);
  const budget = guide ? 2500 : 1400;
  // Keep recent full rows first; never sever a qualifier by slicing a row.
  let total = 0; const selected = [];
  for (const row of [...recent].reverse().concat([...chosen].filter(r=>!recent.includes(r)).reverse())) {
    const value = `[${rows.indexOf(row)+1}] ${row.speakerId?'화자 '+row.speakerId+' · ':''}${row.original}`;
    if (value.length + total > budget) continue;
    total += value.length + 1; selected.push({row,value});
  }
  return [guide && purpose ? `User's stated meeting purpose: ${purpose.slice(0,300)}` : '', ...selected.sort((a,b)=>a.row.createdAt-b.row.createdAt).map(r=>r.value)].filter(Boolean).join('\n');
}
export function isGuideMoment(text) {
  return /[?？]|\b(?:decision|approve|approval|concern|risk|next steps?|deadline|budget|scope|however|proposal|recommend|agree)\b/i.test(text);
}
