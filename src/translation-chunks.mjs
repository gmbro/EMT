/** Keep full meeting notes within a model's context budget. Prefer sentence
 * ends and word boundaries, while preserving every original code point. */
export function translationChunks(text, limit = 350) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid translation chunk size.');
  const chars = Array.from(text);
  const chunks = [];
  let offset = 0;
  while (offset < chars.length) {
    let end = Math.min(chars.length, offset + limit);
    if (end < chars.length) {
      const earliest = offset + Math.floor(limit / 2);
      let boundary = -1;
      for (let i = end - 1; i >= earliest; i--) {
        if (/[.!?。！？\n]/u.test(chars[i]) && (i + 1 === chars.length || /\s/u.test(chars[i + 1]))) { boundary = i + 1; break; }
      }
      if (boundary < 0) for (let i = end - 1; i >= earliest; i--) {
        if (/\s/u.test(chars[i])) { boundary = i + 1; break; }
      }
      if (boundary > offset) end = boundary;
    }
    chunks.push(chars.slice(offset, end).join(''));
    offset = end;
  }
  return chunks;
}
