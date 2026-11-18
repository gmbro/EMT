const cancelled = () => Object.assign(new Error('번역을 취소했어요.'), { name: 'AbortError', code: 'CANCELLED' });

// One identical network operation can serve several consumers. Each consumer
// owns cancellation; the provider is cancelled only after the last one leaves.
export function createSharedTranslations() {
  const requests = new Map();
  function finish(entry, error, result) {
    if (entry.settled) return;
    entry.settled = true;
    if (requests.get(entry.key) === entry) requests.delete(entry.key);
    for (const subscriber of [...entry.subscribers]) {
      subscriber.detach();
      if (error) subscriber.reject(error); else subscriber.resolve(result);
    }
  }
  return {
    run(key, start, { signal, onText, onRetry } = {}) {
      if (signal?.aborted) return Promise.reject(cancelled());
      let entry = requests.get(key);
      if (!entry) {
        entry = { key, controller: new AbortController(), subscribers: new Set(), started: false, settled: false, text: null, retry: null };
        requests.set(key, entry);
      }
      return new Promise((resolve, reject) => {
        const detach = () => { signal?.removeEventListener('abort', abort); entry.subscribers.delete(subscriber); };
        const leave = error => {
          detach(); reject(error);
          if (!entry.settled && !entry.subscribers.size) {
            entry.controller.abort();
            if (requests.get(key) === entry) requests.delete(key);
          }
        };
        const abort = () => leave(cancelled());
        const subscriber = { resolve, reject, detach, onText, onRetry, leave };
        entry.subscribers.add(subscriber);
        signal?.addEventListener('abort', abort, { once: true });
        // A late subscriber sees useful current output without another request.
        try {
          if (entry.retry) onRetry?.(entry.retry);
          if (!entry.settled && entry.subscribers.has(subscriber) && entry.text) onText?.(...entry.text);
        } catch (error) { leave(error); }
        if (entry.settled || !entry.subscribers.has(subscriber) || entry.started) return;
        entry.started = true;
        const publish = (name, args) => {
          for (const listener of [...entry.subscribers]) {
            if (entry.settled || !entry.subscribers.has(listener)) continue;
            try { listener[name]?.(...args); } catch (error) { listener.leave(error); }
          }
        };
        Promise.resolve().then(() => {
          if (entry.controller.signal.aborted) throw cancelled();
          return start(entry.controller.signal, {
            onText(...args) { entry.text = args; publish('onText', args); },
            onRetry(info) { entry.retry = info; entry.text = null; publish('onRetry', [info]); },
          });
        }).then(result => finish(entry, null, result), error => finish(entry, error));
      });
    },
    clear() {
      for (const entry of [...requests.values()]) {
        entry.controller.abort();
        finish(entry, cancelled());
      }
      requests.clear();
    },
  };
}
