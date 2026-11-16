// A tab can receive HTML just before the production domain changes deployments.
// Fetch a fresh document once if its entry module never mounted.
(() => {
  const retryKey = 'emt-startup-retry';
  const url = new URL(location.href);
  const recover = () => {
    const fallback = document.getElementById('startup-status');
    if (!fallback) return;
    if (url.searchParams.has(retryKey)) {
      fallback.firstElementChild.textContent = '앱을 불러오지 못했습니다.';
      fallback.querySelector('a').hidden = false;
      return;
    }
    url.searchParams.set(retryKey, String(Date.now()));
    location.replace(url.href);
  };
  addEventListener('DOMContentLoaded', () => {
    // React can schedule its initial commit after DOMContentLoaded.
    setTimeout(recover, 1500);
  }, { once: true });
})();
