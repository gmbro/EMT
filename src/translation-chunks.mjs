const abbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|e\.g|i\.e)|\b[A-Z])\.$/u;
const linkedWord = /(?:[0-9]|\p{Sc}|\b(?:not(?:\s+yet)?|never|no|cannot|by|before|after|until|unless|million|billion|trillion)|n['’]t)$/iu;

function leftOf(chars, offset, end) {
  return chars.slice(Math.max(offset, end - 20), end).join('').trimEnd();
}

/** Keep full meeting notes within a model's context budget. Prefer sentence
 * ends and word boundaries, while preserving every original code point. */
export function translationChunks(text, limit = 350, maxUnits = Infinity) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid translation chunk size.');
  if (maxUnits !== Infinity && (!Number.isInteger(maxUnits) || maxUnits < 2)) throw new RangeError('Invalid UTF-16 limit.');
  if (text.length <= Math.min(limit, maxUnits)) return text.length ? [text] : [];
  const chars = Array.from(text);
  const chunks = [];
  let offset = 0;
  while (offset < chars.length) {
    let end = Math.min(chars.length, offset + limit, offset + maxUnits);
    if (text.length !== chars.length && (end - offset) * 2 > maxUnits) {
      let index = offset;
      let units = 0;
      while (index < end && units + chars[index].length <= maxUnits) {
        units += chars[index].length;
        index++;
      }
      end = index;
    }
    if (end < chars.length) {
      const earliest = offset + Math.floor((end - offset) / 2);
      let boundary = -1;
      for (let i = end - 1; i >= earliest; i--) {
        if (!/[.!?。！？\n]/u.test(chars[i]) || !/\s/u.test(chars[i + 1])) continue;
        if (chars[i] === '.' && abbreviation.test(leftOf(chars, offset, i + 1))) continue;
        boundary = i + 1;
        break;
      }
      if (boundary < 0) {
        let lastSpace = -1;
        for (let i = end - 1; i >= earliest; i--) {
          if (!/\s/u.test(chars[i])) continue;
          if (lastSpace < 0) lastSpace = i + 1;
          const left = leftOf(chars, offset, i);
          if (abbreviation.test(left) || linkedWord.test(left)) continue;
          boundary = i + 1;
          break;
        }
        if (boundary < 0) boundary = lastSpace;
      }
      if (boundary > offset) end = boundary;
    }
    chunks.push(chars.slice(offset, end).join(''));
    offset = end;
  }
  return chunks;
}
