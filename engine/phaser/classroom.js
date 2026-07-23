// classroom.js — shared-device conveniences: idle auto-return-to-title, coarse device-tier
// detection, and a texture LRU so long sessions on locked-down iPads don't balloon memory.
// Assumes a global `Phaser` only where noted; window/document/navigator are read lazily inside
// function bodies (never at module top level) so importing this file never throws in node.

/**
 * Return to the title scene after `ms` of no pointer/keyboard/touch/wheel activity. A shared
 * classroom tablet left mid-game resets for the next kid instead of sitting on a stale screen.
 * Deliberately does NOT save anything — durable progress is expected to already be saved at its
 * own transaction boundaries, not by this watchdog.
 * @param {Phaser.Game} game
 * @param {{ ms?: number, titleKey?: string, checkMs?: number }} [opts] `ms` (default 5 min) idle
 *   threshold; `titleKey` (default 'TitleScene') the scene to return to; `checkMs` (default 30s)
 *   how often the watchdog polls
 * @returns {() => void} teardown — removes every listener and the poll interval
 */
export function idleReturnToTitle(game, opts = {}) {
  const ms = opts.ms ?? 5 * 60 * 1000;
  const titleKey = opts.titleKey ?? 'TitleScene';
  const checkMs = opts.checkMs ?? 30 * 1000;

  let last = Date.now();
  const touch = () => { last = Date.now(); };
  const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
  events.forEach((ev) => window.addEventListener(ev, touch, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', touch);

  const interval = window.setInterval(() => {
    if (Date.now() - last < ms) return;
    try {
      const mgr = game.scene;
      const active = mgr.getScenes(true).map((s) => s.scene.key);
      if (!active.length || active.includes(titleKey)) return;
      touch(); // reset the clock so a stuck watchdog can't restart the title in a loop
      active.forEach((k) => mgr.stop(k));
      mgr.start(titleKey);
    } catch (e) { /* never let the watchdog break the game */ }
  }, checkMs);

  return function destroy() {
    events.forEach((ev) => window.removeEventListener(ev, touch, { capture: true }));
    document.removeEventListener('visibilitychange', touch);
    window.clearInterval(interval);
  };
}

/**
 * Coarse device-capability tier for scaling particle counts / effect budgets. iPad Safari (and
 * "iPad-as-MacIntel-with-touch", Apple's UA quirk since iPadOS 13) is the tier that actually
 * needs trimming on this portfolio's hardware; everything else gets full effects.
 * @param {{ navigator?: Navigator }} [opts] inject a fake `navigator` for testing
 * @returns {{ isIpad: boolean, tier: 'low'|'full' }}
 */
export function deviceTier(opts = {}) {
  const nav = opts.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return { isIpad: false, tier: 'full' };
  const ua = nav.userAgent || '';
  const platform = nav.platform || '';
  const isIpad = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  return { isIpad, tier: isIpad ? 'low' : 'full' };
}

/**
 * A simplified LRU for procedurally/dynamically loaded textures (hatch's AssetLoader, reduced
 * to its essential shape). Call `touch(key)` whenever a texture is used, and `sweep(keepKeys)`
 * periodically (e.g. after a round ends) to evict the least-recently-used textures matching
 * `prefix` beyond `max` — anything in `keepKeys` is never evicted regardless of recency, since
 * "currently on screen" can't be inferred generically from here.
 * @param {Phaser.Scene} scene
 * @param {number} max
 * @param {{ prefix?: string, now?: () => number }} [opts]
 * @returns {{ touch: (key: string) => void, sweep: (keepKeys?: string[]) => void }}
 */
export function lruTextures(scene, max, opts = {}) {
  const prefix = opts.prefix ?? '';
  const now = opts.now ?? (() => Date.now());
  const use = new Map();

  function touch(key) { use.set(key, now()); }

  function sweep(keepKeys = []) {
    if (scene.load?.isLoading?.()) return; // never evict mid-load
    const keep = new Set(keepKeys);
    const loaded = Object.keys(scene.textures.list).filter((k) => k.startsWith(prefix) && !keep.has(k));
    if (loaded.length <= max) return;
    loaded
      .sort((a, b) => (use.get(a) || 0) - (use.get(b) || 0))
      .slice(0, loaded.length - max)
      .forEach((k) => { scene.textures.remove(k); use.delete(k); });
  }

  return { touch, sweep };
}
