// A retry starts its output again from the beginning. Keep the last useful
// translation on screen until the new attempt has caught up, then stream it.
export function createTranslationPublication(previous = '') {
  let displayed = typeof previous === 'string' ? previous : '';
  let minimumLength = displayed.length;
  return {
    retry() { minimumLength = displayed.length; },
    accept(text) {
      if (typeof text !== 'string' || !text.trim() || text.length < minimumLength) return false;
      minimumLength = 0;
      if (text === displayed) return false;
      displayed = text;
      return true;
    },
  };
}
