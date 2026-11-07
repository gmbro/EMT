import { sentenceBoundary } from './streaming-transcript.mjs';

export function canPublishPreview(current, requested) {
  // A growing utterance must not starve the translation stream. Revisions
  // (especially negations) invalidate it, while simple suffix growth does not.
  return current === requested || (current.startsWith(requested) && /[\s,.!?;:]/u.test(current[requested.length] || ''));
}
export function needsPreview(previous, next) {
  if (!previous) return true;
  if (previous === next) return false;
  return !next.startsWith(previous) || next.length-previous.length >= 24 || /[.!?。？！]$/u.test(next);
}
export function sentenceChunks(text) {
  const chunks=[];let rest=text;
  while(rest){const end=sentenceBoundary(rest);if(!end){chunks.push(rest);break;}chunks.push(rest.slice(0,end));rest=rest.slice(end).trimStart();}
  return chunks;
}

// Start on a short phrase, not an isolated word; retain the existing
// growth threshold for subsequent paid requests.
export function canStartPreview(text) {
  return typeof text === 'string' && text.length <= 1200 && /[a-z]{2,}\s+[a-z]{2,}/i.test(text);
}
export function canContinueFinalPreview(current, requested, currentGlossary, requestedGlossary) {
  return current === requested && currentGlossary === requestedGlossary;
}
