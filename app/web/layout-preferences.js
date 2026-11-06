(function () {
  const storageKey = 'scenelingo.workbench.layout.v1';
  const defaults = Object.freeze({ left: 244, right: 306 });
  let current = { ...defaults };
  let activeDrag = null;

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.right)) return { ...defaults };
      return { left: Math.round(value.left), right: Math.round(value.right) };
    } catch (_) { return { ...defaults }; }
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function apply() {
    const layout = document.querySelector('#subtitle-detail');
    if (!layout || layout.clientWidth <= 0) return;
    const compact = layout.clientWidth < 920;
    const minLeft = compact ? 165 : 205;
    const minCenter = compact ? 290 : 360;
    const minRight = compact ? 200 : 250;
    const available = Math.max(0, layout.clientWidth - 54);
    const maxLeft = Math.max(minLeft, Math.min(360, available - minCenter - minRight));
    const left = clamp(current.left, minLeft, maxLeft);
    const maxRight = Math.max(minRight, available - left - minCenter);
    const right = clamp(current.right, minRight, Math.min(390, maxRight));
    layout.style.gridTemplateColumns = `minmax(${minLeft}px, ${left}px) 7px minmax(${minCenter}px, 1fr) 7px minmax(${minRight}px, ${right}px)`;
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(current)); }
    catch (_) { /* Layout still works for this session when storage is unavailable. */ }
  }
  function begin(event) {
    const splitter = event.target.closest('[data-split]');
    if (!splitter || event.button !== 0) return;
    event.preventDefault();
    activeDrag = { side: splitter.dataset.split, x: event.clientX, layout: { ...current } };
    splitter.classList.add('is-dragging');
    splitter.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    if (!activeDrag) return;
    const delta = event.clientX - activeDrag.x;
    if (activeDrag.side === 'left') current.left = activeDrag.layout.left + delta;
    else current.right = activeDrag.layout.right - delta;
    apply();
  }
  function end(event) {
    if (!activeDrag) return;
    document.querySelectorAll('.workbench-splitter').forEach(item => item.classList.remove('is-dragging'));
    activeDrag = null;
    persist();
    if (event) event.target.releasePointerCapture?.(event.pointerId);
  }
  function reset() {
    current = { ...defaults };
    try { localStorage.removeItem(storageKey); } catch (_) { /* Reset applies in memory regardless. */ }
    apply();
  }
  function keydown(event) {
    const splitter = event.target.closest('[data-split]');
    if (!splitter || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    if (splitter.dataset.split === 'left') current.left += event.key === 'ArrowRight' ? step : -step;
    else current.right += event.key === 'ArrowLeft' ? step : -step;
    apply();
    persist();
  }
  function init() {
    current = read();
    const layout = document.querySelector('#subtitle-detail');
    if (!layout) return;
    layout.addEventListener('pointerdown', begin);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    layout.addEventListener('keydown', keydown);
    document.querySelector('#reset-workbench-layout')?.addEventListener('click', reset);
    window.addEventListener('resize', apply);
    const visibility = new MutationObserver(() => { if (!layout.hidden) requestAnimationFrame(apply); });
    visibility.observe(layout, { attributes: true, attributeFilter: ['hidden'] });
    requestAnimationFrame(apply);
  }
  window.SceneLingoLayoutPreferences = Object.freeze({ apply, reset });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
