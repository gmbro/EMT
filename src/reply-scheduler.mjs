import { createLatestTaskRunner } from './captions.mjs';
import { isGuideMoment, isGuideQuestion } from './meeting-context.mjs';

// Keep the latest eligible turn through the cooldown and concurrent translation.
// Only one guide request runs at a time. The caller owns session cancellation.
export function createReplyScheduler({ generate, canGenerate, lastRequest, now = Date.now, schedule, cancel }) {
  let latest = null;
  const runner = createLatestTaskRunner({
    delay: 900,
    ...(schedule ? { schedule } : {}),
    ...(cancel ? { cancel } : {}),
    canRun: () => {
      const previous = lastRequest();
      const interval = isGuideQuestion(latest.original) ? 12000 : 30000;
      return canGenerate() && (!previous.at || now() - previous.at >= interval);
    },
    run: turn => {
      if (turn.original.trim().toLowerCase() === lastRequest().text) return;
      return generate(turn);
    },
    publish: () => {},
  });
  return {
    submit(turn) {
      if (!turn.original?.trim() || !isGuideMoment(turn.original)) return;
      if (turn.original.trim().toLowerCase() === lastRequest().text) return;
      latest = turn;
      runner.submit(turn);
    },
    invalidate() { runner.invalidate(); latest = null; },
    dispose() { runner.dispose(); latest = null; },
  };
}
