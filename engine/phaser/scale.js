// scale.js — Phaser FIT scaling: config factory, defensive resize/orientation/visibility
// guards, a portrait rotate-notice overlay, and DOM<->canvas coordinate conversion. Assumes a
// global `Phaser`; only touched inside function bodies below so a future smoke test can stub it.

/**
 * A `Phaser.Game` config `scale` block: FIT + CENTER_BOTH at a fixed base resolution, with
 * min/max clamps so the canvas never gets absurdly tiny or huge inside its parent. Default
 * min/max are +/-25% of the base — the exact ratio mail's gameConfig uses (1280x720 base ->
 * 960x540 min / 1600x900 max).
 * @param {{ width?: number, height?: number, min?: { width: number, height: number }, max?: { width: number, height: number } }} [opts]
 * @returns {object} spread into `new Phaser.Game({ ..., scale: fitConfig(...) })`
 */
export function fitConfig({ width = 1280, height = 720, min, max } = {}) {
  return {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width,
    height,
    min: min ?? { width: Math.round(width * 0.75), height: Math.round(height * 0.75) },
    max: max ?? { width: Math.round(width * 1.25), height: Math.round(height * 1.25) },
  };
}

/**
 * Wire the defensive listeners a FIT-scaled canvas needs on real classroom hardware: window
 * resize/orientationchange/focus, document visibilitychange, a ResizeObserver on the host
 * element (embedded previews and split-view layout shifts can move the canvas without firing a
 * `resize` event), and — because canvas bounds can also go stale between those events — a
 * cheap bounds recompute on every pointerdown/pointermove/mousedown/touchstart AND every frame
 * (`prestep`). `updateBounds` only re-reads the canvas's bounding rect, so running it that
 * often is intentionally cheap defensiveness, not a real perf cost.
 * @param {Phaser.Game} game
 * @param {{ hostEl?: Element, hostId?: string, perFrame?: boolean }} [opts] `hostId` (default
 *   'game') is looked up via `document.getElementById` when `hostEl` isn't given; `perFrame`
 *   (default true) toggles the per-frame bounds recheck.
 * @returns {() => void} teardown — removes every listener this installed
 */
export function installResizeGuards(game, opts = {}) {
  const hostEl = opts.hostEl ?? (typeof document !== 'undefined' ? document.getElementById(opts.hostId ?? 'game') : null);

  const refresh = () => { try { game.scale.refresh(); } catch (e) { /* ignore — best-effort */ } };
  const updateBounds = () => {
    try {
      const sm = game.scale;
      sm.updateBounds ? sm.updateBounds() : sm.refresh();
    } catch (e) { /* ignore — best-effort */ }
  };

  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined' && hostEl) {
    ro = new ResizeObserver(refresh);
    ro.observe(hostEl);
  }

  const boundsEvents = ['pointerdown', 'pointermove', 'mousedown', 'touchstart'];
  boundsEvents.forEach((ev) => window.addEventListener(ev, updateBounds, { capture: true, passive: true }));

  const perFrame = opts.perFrame !== false;
  if (perFrame) game.events.on('prestep', updateBounds);

  return function destroy() {
    window.removeEventListener('resize', refresh);
    window.removeEventListener('orientationchange', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    if (ro) ro.disconnect();
    boundsEvents.forEach((ev) => window.removeEventListener(ev, updateBounds, { capture: true }));
    if (perFrame) game.events.off('prestep', updateBounds);
  };
}

/**
 * A full-screen "please rotate your device" overlay, shown/hidden by a live orientation media
 * query (not a stylesheet rule) so it works with no CSS file of the game's own — generalizes
 * the `#rotate-notice` pattern used in index.html-based games into one callable helper.
 * @param {Element} parentEl usually `document.body`
 * @param {{ title?: string, message?: string, zIndex?: number, requireLandscape?: boolean }} [opts]
 *   `requireLandscape` (default true) shows the notice in portrait; set false for a
 *   portrait-designed game to show it in landscape instead.
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function rotateNotice(parentEl, opts = {}) {
  const {
    title = 'Landscape Please',
    message = 'Turn your device sideways to keep playing.',
    zIndex = 9999,
    requireLandscape = true,
  } = opts;

  const el = document.createElement('div');
  el.className = 'ce-rotate-notice';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = `position:fixed;inset:0;display:none;align-items:center;justify-content:center;`
    + `padding:24px;background:linear-gradient(135deg, rgba(20,20,28,.90), rgba(40,40,56,.92));z-index:${zIndex};`;

  const card = document.createElement('div');
  card.style.cssText = 'max-width:480px;padding:24px 28px;border-radius:24px;background:#fffdf7;'
    + 'box-shadow:0 18px 48px rgba(0,0,0,.35);text-align:center;color:#2b2b33;'
    + 'font-family:"Trebuchet MS","Gill Sans","Segoe UI",sans-serif;';

  const h1 = document.createElement('h1');
  h1.textContent = title;
  h1.style.cssText = 'margin:0 0 8px;font-size:clamp(1.6rem,3.8vw,2.2rem);';

  const p = document.createElement('p');
  p.textContent = message;
  p.style.cssText = 'margin:0;font-size:clamp(1rem,2.6vw,1.15rem);line-height:1.5;';

  card.append(h1, p);
  el.appendChild(card);
  parentEl.appendChild(el);

  const query = requireLandscape ? '(orientation: portrait)' : '(orientation: landscape)';
  const mq = window.matchMedia(query);
  const sync = () => { el.style.display = mq.matches ? 'flex' : 'none'; };
  sync();
  // Safari < 14 only has the deprecated addListener/removeListener pair.
  if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);

  return {
    el,
    destroy() {
      if (mq.removeEventListener) mq.removeEventListener('change', sync); else if (mq.removeListener) mq.removeListener(sync);
      el.remove();
    },
  };
}

/**
 * Convert a DOM page coordinate (e.g. `event.clientX/Y`) to logical/canvas coordinates. FIT
 * mode preserves aspect ratio, so a single uniform scale factor applies to both axes — this is
 * what lets a DOM-originated gesture (drag from an HTML palette, say) place something at the
 * right spot on a Phaser canvas that's been scaled up or down from its logical size.
 * @param {Phaser.Scale.ScaleManager} scaleManager usually `game.scale` or `scene.scale`
 * @param {number} x @param {number} y page coordinates
 * @returns {{ x: number, y: number }} logical/canvas coordinates
 */
export function pageToLogical(scaleManager, x, y) {
  const r = scaleManager.canvas.getBoundingClientRect();
  const s = r.width / scaleManager.width; // FIT => one uniform scale factor
  return { x: (x - r.left) / s, y: (y - r.top) / s };
}

/**
 * The inverse of `pageToLogical`: logical/canvas coordinates -> DOM page coordinates.
 * @param {Phaser.Scale.ScaleManager} scaleManager usually `game.scale` or `scene.scale`
 * @param {number} x @param {number} y logical/canvas coordinates
 * @returns {{ x: number, y: number }} page coordinates
 */
export function logicalToPage(scaleManager, x, y) {
  const r = scaleManager.canvas.getBoundingClientRect();
  const s = r.width / scaleManager.width;
  return { x: r.left + x * s, y: r.top + y * s };
}
