const segmenter = typeof Intl.Segmenter==='function' ? new Intl.Segmenter('ko',{granularity:'sentence'}) : null;
// Extract complete statements so that qualifications, amounts and dates survive copying.
export function meetingSummary(records) {
  const sections = new Map(['주요 논의','결정 사항','후속 작업','열린 질문'].map(title => [title, new Map()]));
  for (const row of records) {
    if (row.sourcePending || row.incomplete) continue;
    const english = row.language === 'en-US';
    const text = (english && row.status === 'complete' && row.translation || row.original || '').trim();
    if (!text) continue;
    const parts = segmenter ? Array.from(segmenter.segment(text), item=>item.segment) : [text];
    for (const part of parts) {
      const line = part.trim();
      if (!line || /^(?:네|예|음|감사합니다|안녕하세요|yes|ok(?:ay)?|thanks)[.! ]*$/i.test(line)) continue;
      const question = /[?？]$|(?:인가요|할까요|습니까)[. ]*$/.test(line);
      const decision = /(?:하기로 (?:했습니다|합의)|확정했습니다|승인했습니다|결정했습니다|\bwe (?:decided|agreed|approved)\b)/i.test(line);
      const action = /(?:하겠습니다|해 ?주세요|해야 (?:합니다|해요)|예정입니다|\b(?:we will|I will|please|need to)\b)/i.test(line);
      const title = question?'열린 질문':decision?'결정 사항':action?'후속 작업':'주요 논의';
      const items = sections.get(title);
      const key = line.toLowerCase().replace(/[\s.!?]+$/g,'');
      const terms = english && parts.length===1 ? [...new Set(row.original.match(/\b(?:[A-Z]{2,}[A-Z0-9]*|[A-Z][a-z]*[A-Z][A-Za-z0-9]*)\b/g)||[])].filter(term=>!line.includes(term)) : [];
      const display = terms.length ? line+' ('+terms.join(', ')+')' : line;
      items.set(key,{display,score:Number(/\d/.test(line))+Number(/예산|일정|검토|비용|계약|문제|budget|review|deadline/i.test(line)),order:items.size});
    }
  }
  return [...sections].filter(([,items])=>items.size).map(([title,items])=>{
    const selected=[...items.values()].sort((a,b)=>b.score-a.score||b.order-a.order).slice(0,3).sort((a,b)=>a.order-b.order);
    return '['+title+']\n'+selected.map(item=>'• '+item.display).join('\n');
  }).join('\n\n────────────\n\n');
}
