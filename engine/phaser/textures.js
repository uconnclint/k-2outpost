// textures.js — procedural placeholder textures + graceful asset-loaderror fallback, so every
// game is fully playable before any real art exists (the BootScene generateTexture idiom used
// across the portfolio). Assumes a global `Phaser`; only touched inside function bodies below.

/**
 * Generate (or reuse) a placeholder texture at `key` by running `drawFn(g, w, h)` on a detached
 * Graphics object, then baking it with `generateTexture`. Idempotent: if `key` already exists —
 * because real art loaded under the same key, or a previous call already made it — this does
 * nothing and just returns the key, so callers can call it unconditionally instead of tracking
 * whether they already generated it.
 * @param {Phaser.Scene} scene
 * @param {string} key stable texture key
 * @param {(g: Phaser.GameObjects.Graphics, w: number, h: number) => void} drawFn draws into a
 *   Graphics object sized (w,h); called with the object *not* added to the scene's display list
 * @param {{ width?: number, height?: number, force?: boolean }} [opts] force regenerates even
 *   if `key` already exists (default false — real/loaded art always wins)
 * @returns {string} `key`, so callers can chain `scene.add.image(x, y, placeholder(...))`
 */
export function placeholder(scene, key, drawFn, opts = {}) {
  const w = opts.width ?? 64;
  const h = opts.height ?? 64;
  if (!opts.force && scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ add: false });
  drawFn(g, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

/**
 * Wire a scene's loader so a missing/failed asset never breaks the boot (critter-codex's
 * `load.on('loaderror', () => {})`, generalized). Missing files just leave whatever placeholder
 * texture already exists at that key in place. Pass `onError(file)` to react to a specific
 * failed key (e.g. call `placeholder()` for exactly the keys that failed) — never required,
 * since the whole point is the game must always boot even if nobody handles the failure. Any
 * throw inside `onError` is swallowed: a broken fallback handler must never be the thing that
 * crashes the boot.
 * @param {Phaser.Scene} scene
 * @param {(file: any) => void} [onError]
 * @returns {() => void} teardown — removes the listener
 */
export function onLoadError(scene, onError) {
  const handler = (file) => {
    try { onError?.(file); } catch (e) { /* a broken fallback must never crash the boot */ }
  };
  scene.load.on('loaderror', handler);
  return () => scene.load.off('loaderror', handler);
}

/**
 * Up-to-2-letter initials from a name/label: "Ada Lovelace" -> "AL", "Rex" -> "RE".
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A colored rounded-square "initials card" — the fallback for missing portrait/avatar art seen
 * across the portfolio (hoop heroes' `portrait.js`). Unlike `placeholder()` this returns a live
 * Container, not a cached texture: the label is a real Text object, and a Graphics object can't
 * bake child text into `generateTexture`. Cheap enough to build per instance; a caller that
 * shows the same identity repeatedly can cache the returned container itself.
 * @param {Phaser.Scene} scene
 * @param {number} x @param {number} y
 * @param {string} name used for the initials shown
 * @param {{ size?: number, fill?: number, dark?: number, textColor?: string, fontFamily?: string, radius?: number }} [opts]
 * @returns {Phaser.GameObjects.Container}
 */
export function initialsCard(scene, x, y, name, opts = {}) {
  const size = opts.size ?? 120;
  const r = opts.radius ?? Math.round(size * 0.16);
  const fill = opts.fill ?? 0x3b4252;
  const dark = opts.dark ?? 0x252b38;
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  // dark base + lighter top band + a simple shoulders/head silhouette — legible at any size.
  g.fillStyle(dark, 1); g.fillRoundedRect(-size / 2, -size / 2, size, size, r);
  g.fillStyle(fill, 1); g.fillRoundedRect(-size / 2, -size / 2, size, size * 0.62, r);
  g.fillStyle(0x000000, 0.18);
  g.fillCircle(0, -size * 0.06, size * 0.2);
  g.fillEllipse(0, size * 0.34, size * 0.62, size * 0.4);
  c.add(g);
  const t = scene.add.text(0, 0, initials(name), {
    fontFamily: opts.fontFamily ?? '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
    fontSize: `${Math.round(size * 0.34)}px`,
    fontStyle: 'bold',
    color: opts.textColor ?? '#ffffff',
  }).setOrigin(0.5);
  t.setStroke('#00000055', 4);
  c.add(t);
  c.setSize(size, size);
  return c;
}

/**
 * Prefer a loaded/real texture at `key`; fall back to `fallbackKey` (typically a `placeholder()`
 * key) when it isn't loaded. The "art()" pattern several games use so a dropped-in PNG silently
 * overrides a procedural placeholder keyed the same way, with no call-site branching.
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @param {string} fallbackKey
 * @returns {string}
 */
export function resolveTexture(scene, key, fallbackKey) {
  return scene.textures.exists(key) ? key : fallbackKey;
}
