export async function withDeadline(operation, milliseconds, message, disposeLate) {
  let timeout;
  let expired = false;
  const pending = Promise.resolve().then(operation);
  pending.then(value => { if (expired) { try { disposeLate?.(value); } catch {} } }, () => {});
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timeout = setTimeout(() => { expired = true; reject(new Error(message)); }, milliseconds);
    })]);
  } finally { clearTimeout(timeout); }
}
