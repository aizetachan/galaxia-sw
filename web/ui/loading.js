export function createChatLoadingManager({ chatEl, overlayEl }) {
  let isLoading = false;

  function apply() {
    if (!chatEl) return;
    chatEl.classList.toggle('loading-blur', isLoading);
    chatEl.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (overlayEl) overlayEl.classList.toggle('hidden', !isLoading);
  }

  return {
    set(on) {
      isLoading = !!on;
      apply();
    },
    get() {
      return isLoading;
    }
  };
}
