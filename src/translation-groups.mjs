import { sentenceBoundary } from './streaming-transcript.mjs';

export const TRANSLATION_PACING = ['paragraph', 'after-speech'];
export const TRANSLATION_SILENCE_MS = 3000;
export const PARAGRAPH_MAX_MS = 25000;

function joinText(parts) {
  return parts.filter(Boolean).join(' ').replace(/\s+([,.;!?。？！])/gu, '$1').trim();
}
function sentencePrefix(text, count) {
  let end = 0;
  for (let index = 0; index < count; index++) {
    const boundary = sentenceBoundary(text.slice(end));
    if (!boundary) return 0;
    end += boundary;
    while (/\s/u.test(text[end] || '') && end < text.length) end++;
  }
  return end;
}

// Source captions arrive immediately. Only authoritative text crosses a
// translation boundary. Provider final chunks do not end a whole speech.
export function createTranslationGroups({
  mode = 'paragraph', onUpdate, onFinal, onDiscard = () => {},
  requestFinalize = () => {}, id = () => crypto.randomUUID(),
}) {
  let group = null, stable = '', drafts = new Map(), audioMs = 0;
  let quietMs = 0, heardVoice = false, startedAtAudio = 0;
  let finalizeRequested = false, disposed = false, lastCreatedAt = 0, sourceEnded = false, lastSourceMs = 0;

  const text = () => joinText([stable, ...[...drafts.values()].map(row => row.original)]);
  function begin(source) {
    const createdAt = Math.max(source.createdAt || Date.now(), lastCreatedAt + 1);
    lastCreatedAt = createdAt;
    group = { ...source, id: id(), createdAt, turnId: undefined, translationBatch: true };
    startedAtAudio = audioMs;
    finalizeRequested = false;
  }
  function snapshot(original, pending) {
    return { ...group, original, translation: '', sourcePending: pending,
      stableOriginal: pending ? stable : original, translationPacing: mode };
  }
  function publish() {
    if (group && text()) onUpdate(snapshot(text(), true));
  }
  function complete(prefix, remaining = '') {
    if (!group || !prefix.trim()) return;
    const previous = group;
    const completed = snapshot(prefix.trim(), false);
    group = null;
    stable = remaining.trimStart();
    onUpdate(completed);
    onFinal(completed);
    if (stable || drafts.size) {
      begin(drafts.values().next().value || previous);
      publish();
    }
  }
  function flush({ includeDrafts = false } = {}) {
    if (disposed || !group) return;
    if (!drafts.size) {
      complete(stable);
      return;
    }
    if (!includeDrafts) return;
    if (stable) complete(stable);
    if (group && drafts.size) {
      const incomplete = { ...snapshot(text(), true), incomplete: true };
      onUpdate(incomplete);
      onFinal(incomplete);
      group = null;
      stable = '';
      drafts.clear();
    }
  }
  function requestSourceFinal() {
    if (finalizeRequested || !group) return;
    finalizeRequested = true;
    requestFinalize();
  }
  function evaluate() {
    if (!group || disposed) return;
    if (mode === 'paragraph') {
      // With a known speaker, individual sentences are useful reading units.
      let boundary = sentencePrefix(stable, group.speakerId ? 1 : 3);
      while (boundary) {
        complete(stable.slice(0, boundary), stable.slice(boundary));
        boundary = group ? sentencePrefix(stable, group.speakerId ? 1 : 3) : 0;
      }
      if (group && (stable.length >= 1400 || audioMs - startedAtAudio >= PARAGRAPH_MAX_MS)) {
        if (stable) complete(stable);
        if (group && drafts.size) requestSourceFinal();
      }
    }
    if (group && heardVoice && quietMs >= TRANSLATION_SILENCE_MS) {
      // Some transcription-only providers omit a turn-end event. Allow a
      // short settling window for finalized text, but never commit a hypothesis.
      const settled = !drafts.size && quietMs >= TRANSLATION_SILENCE_MS + 300 && audioMs - lastSourceMs >= 300;
      if (sourceEnded || settled) flush();
      else requestSourceFinal();
    }
  }
  function ensureGroup(source) {
    // A language correction of the same hypothesis replaces that hypothesis.
    // It must not leave an invented English fragment in the saved transcript.
    if (group && group.language !== source.language && drafts.has(source.id)) {
      drafts.delete(source.id);
      if (stable) complete(stable);
      else group.language = source.language;
    }
    const changedLanguage = group && group.language !== source.language;
    const changedSpeaker = group?.speakerId && source.speakerId && group.speakerId !== source.speakerId;
    if (changedLanguage || mode === 'paragraph' && changedSpeaker && !drafts.has(source.id)) flush({ includeDrafts: true });
    else if (changedSpeaker && mode === 'after-speech') {
      group.speakerId = '';
      group.mixedSpeakers = true;
    }
    if (!group) begin(source);
    if (!stable && source.speakerId && !group.mixedSpeakers) group.speakerId = source.speakerId;
  }
  return {
    update(source) {
      if (disposed || !source.original?.trim()) return;
      lastSourceMs = audioMs;
      ensureGroup(source);
      drafts.set(source.id, source);
      publish();
      evaluate();
    },
    final(source) {
      if (disposed || !source.original?.trim()) return;
      lastSourceMs = audioMs;
      ensureGroup(source);
      drafts.delete(source.id);
      if (source.sourcePending) {
        drafts.set(source.id, source);
        flush({ includeDrafts: true });
        return;
      }
      stable = joinText([stable, source.original]);
      publish();
      if (source.language === 'ko-KR') flush();
      else evaluate();
    },
    discard(sourceId) {
      if (disposed || !drafts.delete(sourceId)) return;
      if (!stable && !drafts.size) {
        onDiscard(group.id);
        group = null;
      } else publish();
    },
    audio(samples) {
      if (disposed || !samples.length) return;
      // Evaluate each 50 ms frame so large catch-up buffers retain pause timing.
      for (let offset = 0; offset < samples.length; offset += 800) {
        const frame = samples.subarray(offset, offset + 800);
        const duration = frame.length / 16;
        const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);
        audioMs += duration;
        if (rms >= .003) { heardVoice = true; quietMs = 0; sourceEnded = false; }
        else if (heardVoice) quietMs += duration;
        evaluate();
      }
    },
    sourceEnd() { if (!disposed) { sourceEnded = true; evaluate(); } },
    setMode(next) {
      if (disposed || !TRANSLATION_PACING.includes(next) || mode === next) return;
      mode = next;
      publish();
      evaluate();
    },
    flush,
    dispose() { disposed = true; group = null; stable = ''; drafts.clear(); },
  };
}
