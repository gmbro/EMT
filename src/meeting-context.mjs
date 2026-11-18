// Extractive context only: no extra model calls, invented summary or draft speech.
const stopWords = new Set(['the', 'and', 'that', 'this', 'with', 'have', 'will', 'could', 'would', 'please']);
const sourceTerms = new WeakMap();

function terms(text) {
  const unique = new Set();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []) {
    if (!stopWords.has(word)) unique.add(word);
  }
  return unique;
}

function overlap(row, query) {
  let cached = sourceTerms.get(row);
  if (cached?.source !== row.original) {
    cached = { source: row.original, words: [...terms(row.original)] };
    sourceTerms.set(row, cached);
  }
  let score = 0;
  for (const word of cached.words) if (query.has(word)) score++;
  return score;
}

export function meetingContext(records, { before = Infinity, text = '', guide = false, purpose = '' } = {}) {
  const rows = records.filter(r => !r.sourcePending && r.status !== 'recognizing' && r.createdAt < before && r.original?.trim());
  const recentStart = Math.max(0, rows.length - (guide ? 4 : 2));
  const selected = [];
  let remaining = guide ? 2500 : 1400;
  function format(index) {
    const row = rows[index];
    return `[${index + 1}] ${row.speakerId ? '화자 ' + row.speakerId + ' · ' : ''}${row.original}`;
  }
  function select(index, value) {
    if (value.length > remaining) return;
    remaining -= value.length + 1;
    selected.push({ index, value });
  }
  for (let index = rows.length - 1; index >= recentStart; index--) select(index, format(index));

  const query = terms(text);
  if (query.size >= 2 && remaining > 0) {
    const ranked = [];
    const limit = guide ? 3 : 1;
    // Newer rows win ties. Once every slot matches every query word, no older row can rank higher.
    for (let index = recentStart - 1; index >= 0; index--) {
      const row = rows[index];
      if (row.original.length > remaining) continue;
      const score = overlap(row, query);
      if (score < 2 || (ranked.length === limit && score <= ranked[limit - 1].score)) continue;
      const value = format(index);
      if (value.length > remaining) continue;
      const position = ranked.findIndex(candidate => candidate.score < score);
      ranked.splice(position < 0 ? ranked.length : position, 0, { index, score, value });
      if (ranked.length > limit) ranked.pop();
      if (ranked.length === limit && ranked[limit - 1].score === query.size) break;
    }
    // Spend the remaining budget on the strongest matches first, keeping full qualifiers.
    for (const candidate of ranked) select(candidate.index, candidate.value);
  }
  selected.sort((a, b) => rows[a.index].createdAt - rows[b.index].createdAt || a.index - b.index);
  const lines = selected.map(item => item.value);
  if (guide && purpose) lines.unshift(`User's stated meeting purpose: ${purpose.slice(0, 300)}`);
  return lines.join('\n');
}
export function isGuideQuestion(text) {
  return /[?？]|(?:^|[.!]\s+)(?:(?:please\s+)?(?:can|could|would|will)\s+you\b|(?:what|when|where|why|how|which|who)\b|(?:do|does|did|is|are|should|may)\s+(?:you|we|it|this|that|the)\b)/i.test(text);
}
export function isGuideMoment(text) {
  return isGuideQuestion(text) || /\b(?:decision|approve|approval|concern|risk|next steps?|deadline|budget|scope|however|proposal|recommend|agree)\b/i.test(text);
}
