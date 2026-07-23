// scale.js — two scaling recipes: integerScaleFit() for a fixed-logical-
// resolution 2D canvas (Scoop Dreams' pixel-art recipe) and viewportFill()
// for a full-viewport WebGL/Three.js renderer with a DPR cap (k-2outpost's
// Chromebook/iPad-friendly setup). Both refresh on resize, orientationchange,
// visibilitychange (becoming visible), and once on the first pointerdown —
// the house-style device gotcha that canvas bounds go stale after
// split-view/rotate on iPad/Chromebook.
// DOM-only — syntax-checked, not unit-tested (see docs/CONTRACTS.md "Tests").

function watchLayoutChanges(refresh) {
  const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
  const onceMore = () => refresh();
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pointerdown', onceMore, { once: true });
  return function unwatch() {
    window.removeEventListener('resize', refresh);
    window.removeEventListener('orientationchange', refresh);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pointerdown', onceMore);
  };
}

/**
 * Integer-scale-fit a logical-resolution canvas into the viewport: CSS-scales
 * by whole numbers only (so pixel art stays crisp) and disables image
 * smoothing. `w`/`h` are the canvas's fixed logical pixel resolution.
 * @param {HTMLCanvasElement} canvas
 * @param {number} w
 * @param {number} h
 * @returns {{refresh: () => number, destroy: Function}} refresh() returns the current integer scale
 */
export function integerScaleFit(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
  const ctx2d = canvas.getContext && canvas.getContext('2d');
  if (ctx2d) ctx2d.imageSmoothingEnabled = false;

  function refresh() {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / w, window.innerHeight / h)));
    canvas.style.width = w * scale + 'px';
    canvas.style.height = h * scale + 'px';
    return scale;
  }
  refresh();
  const unwatch = watchLayoutChanges(refresh);
  return { refresh, destroy: unwatch };
}

/**
 * Full-viewport resize helper for WebGL/Three.js renderers, with
 * devicePixelRatio capped (k-2outpost's 1.75 default — Chromebook/iPad
 * friendly, avoids melting integrated GPUs on 3x+ displays).
 * @param {(width: number, height: number, dpr: number) => void} rendererResize
 *   called with the new CSS size + clamped DPR; wire your renderer's
 *   setPixelRatio/setSize (and camera aspect update) inside it.
 * @param {{maxDpr?: number}} [opts]
 * @returns {{refresh: () => number, destroy: Function}} refresh() returns the current clamped DPR
 */
export function viewportFill(rendererResize, { maxDpr = 1.75 } = {}) {
  function refresh() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (typeof rendererResize === 'function') rendererResize(window.innerWidth, window.innerHeight, dpr);
    return dpr;
  }
  refresh();
  const unwatch = watchLayoutChanges(refresh);
  return { refresh, destroy: unwatch };
}
