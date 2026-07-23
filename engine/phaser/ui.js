// ui.js — Phaser UI kit: buttons, panels, toasts, and Tab/Enter keyboard focus. Assumes a
// global `Phaser` (loaded via a classic <script> before this module); only touched inside
// function bodies below so a future smoke test can stub it. Every factory positions by CENTER
// (x,y) for consistency across the module. Buttons take an optional `audio` (engine core
// audio) for a press cue and `settings` (engine core settings) so hover/press tweens and
// confetti motion respect `settings.reducedMotion()`.

import { placeholder } from './textures.js';

/** Minimum effective touch-target size in CSS px (K-4 fingers + iPad FIT downscaling). A
 * design element smaller than this on-canvas should widen its hit padding to reach it, not
 * just rely on its drawn size — see `HIT_PAD` usage in `button()`. */
export const MIN_TAP = 44;

const DEFAULT_HIT_PAD = 8;

// Generic, game-agnostic default palette. Every color/font is overridable per call via opts —
// these only keep placeholder UI legible before a game supplies its own theme.
const DEFAULTS = Object.freeze({
  fill: 0x2f6ef2,
  ink: 0x23232b,
  textColor: '#ffffff',
  panel: 0xffffff,
  panelLight: 0xf4f1ea,
  line: 0xd8d2c2,
  fontFamily: '"Trebuchet MS", "Segoe UI", system-ui, -apple-system, sans-serif',
});

function playPress(opts) {
  try { opts.audio?.sfx?.(opts.sfx || 'tap'); } catch (e) { /* audio is best-effort */ }
}

function reducedMotion(opts) {
  try { return !!opts.settings?.reducedMotion?.(); } catch (e) { return false; }
}

function registerFocusable(scene, target, focusable) {
  if (focusable === false) return;
  scene.__focusables = scene.__focusables || [];
  scene.__focusables.push(target);
}

/**
 * Draw the SNES-cartridge bevel primitive onto an existing Graphics object: a flat rect with a
 * hard outline and 2-3px bevels (light top/left, dark bottom/right; inverted when
 * `opts.pressed`, which also reads as "pushed in"). No gradients or blur — depth comes from the
 * hard offset shadow, not a glow.
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} fill fill color, 0xRRGGBB
 * @param {{ bevel?: number, hi?: number, lo?: number, shadow?: boolean, pressed?: boolean, border?: number }} [opts]
 */
export function bevelRect(g, x, y, w, h, fill, opts = {}) {
  const b = opts.bevel ?? 3;
  const c = Phaser.Display.Color.IntegerToColor(fill);
  const hi = opts.hi ?? c.clone().lighten(16).color;
  const lo = opts.lo ?? c.clone().darken(20).color;
  if (opts.shadow !== false) { g.fillStyle(0x000000, 0.35); g.fillRect(x + 3, y + 4, w, h); }
  g.fillStyle(opts.border ?? DEFAULTS.ink, 1); g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle(fill, 1); g.fillRect(x, y, w, h);
  g.fillStyle(opts.pressed ? lo : hi, 1); g.fillRect(x, y, w, b); g.fillRect(x, y, b, h);
  g.fillStyle(opts.pressed ? hi : lo, 1); g.fillRect(x, y + h - b, w, b); g.fillRect(x + w - b, y, b, h);
}

/**
 * Fill (and optionally stroke) a rounded rect on an existing Graphics object.
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 * @param {number} fill @param {number} [alpha=1]
 * @param {number|null} [strokeColor=null] @param {number} [strokeW=0]
 */
export function roundRect(g, x, y, w, h, r, fill, alpha = 1, strokeColor = null, strokeW = 0) {
  if (fill != null) { g.fillStyle(fill, alpha); g.fillRoundedRect(x, y, w, h, r); }
  if (strokeColor != null && strokeW > 0) { g.lineStyle(strokeW, strokeColor, 1); g.strokeRoundedRect(x, y, w, h, r); }
}

/**
 * A touch-first button: container + graphics face + text (+ optional icon image). The hit area
 * extends `hitPad` px beyond the drawn face so the effective tap target reaches `MIN_TAP` even
 * when the face itself is drawn smaller. Press redraws instantly (bevel invert / offset — no
 * tween needed, so it's never gated by reduced motion); hover applies a light tint plus, unless
 * `settings.reducedMotion()` is on, a small scale tween. `onClick` fires on pointerup (not
 * pointerdown) so dragging off before release cancels the tap.
 * @param {Phaser.Scene} scene
 * @param {number} x @param {number} y button CENTER
 * @param {string} label
 * @param {() => void} onClick
 * @param {object} [opts]
 * @param {number} [opts.width] @param {number} [opts.height]
 * @param {number} [opts.fill] @param {string} [opts.textColor] @param {number} [opts.fontSize]
 * @param {string} [opts.fontFamily]
 * @param {string} [opts.icon] texture key drawn left of the label
 * @param {number} [opts.iconTint]
 * @param {number} [opts.hitPad=8]
 * @param {boolean} [opts.ghost] secondary/outline style preset (smaller, lighter fill)
 * @param {'rect'|'circle'} [opts.shape='rect']
 * @param {number|null} [opts.stroke] outline color (rect border / circle ring)
 * @param {boolean} [opts.shadow=true]
 * @param {object} [opts.audio] engine core audio — `sfx(name)` fires on press
 * @param {string} [opts.sfx='tap'] cue name passed to `audio.sfx()`
 * @param {object} [opts.settings] engine core settings — gates hover/press tweens via `reducedMotion()`
 * @param {boolean} [opts.focusable=true] register into `scene.__focusables` for `enableKeyboardNav`
 * @returns {Phaser.GameObjects.Container} with `.label`, `.setLabel()`, `.setEnabled()`, `.setDisabled()`
 */
export function button(scene, x, y, label, onClick, opts = {}) {
  const shape = opts.shape ?? 'rect';
  const ghost = !!opts.ghost;
  const w = Math.max(opts.width ?? (ghost ? 176 : 220), shape === 'circle' ? MIN_TAP : 96);
  const h = Math.max(opts.height ?? (ghost ? 56 : 64), 44); // 44 design px is already the floor; callers scaling down should raise hitPad instead
  const fill = opts.fill ?? (ghost ? DEFAULTS.panelLight : DEFAULTS.fill);
  const textColor = opts.textColor ?? (ghost ? '#' + DEFAULTS.ink.toString(16).padStart(6, '0') : DEFAULTS.textColor);
  const fontSize = opts.fontSize ?? (ghost ? 20 : 26);
  const fontFamily = opts.fontFamily ?? DEFAULTS.fontFamily;
  const stroke = opts.stroke !== undefined ? opts.stroke : (ghost ? DEFAULTS.line : null);
  const HIT_PAD = opts.hitPad ?? DEFAULT_HIT_PAD;
  const hasIcon = !!opts.icon;

  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const icon = hasIcon
    ? scene.add.image(-w / 2 + 26, 0, opts.icon).setDisplaySize(24, 24).setTint(opts.iconTint ?? 0xffffff)
    : null;
  const t = scene.add.text(hasIcon ? 12 : 0, 0, label, {
    fontFamily, fontSize: `${fontSize}px`, fontStyle: 'bold', color: textColor, align: 'center',
  }).setOrigin(0.5);
  const fitLabel = () => {
    t.setScale(1);
    const maxW = w - 24 - (hasIcon ? 28 : 0);
    if (t.width > maxW) t.setScale(maxW / t.width);
  };
  fitLabel();

  let lightFillCache = null;
  const lightFill = () => {
    if (lightFillCache == null) {
      try { lightFillCache = Phaser.Display.Color.IntegerToColor(fill).clone().lighten(8).color; }
      catch (e) { lightFillCache = fill; }
    }
    return lightFillCache;
  };

  let isFocused = false;
  const draw = (pressed, hovered) => {
    const off = pressed ? 2 : 0;
    const faceFill = hovered && !pressed ? lightFill() : fill;
    g.clear();
    if (shape === 'circle') {
      const r = w / 2;
      if (opts.shadow !== false && !pressed) { g.fillStyle(0x000000, 0.25); g.fillCircle(3, 4, r); }
      g.fillStyle(faceFill, 1); g.fillCircle(off, off, r);
      if (stroke != null) { g.lineStyle(opts.strokeW ?? 3, stroke, 1); g.strokeCircle(off, off, r); }
      if (isFocused) { g.lineStyle(3, DEFAULTS.fill, 0.9); g.strokeCircle(off, off, r + 5); }
    } else {
      bevelRect(g, -w / 2 + off, -h / 2 + off, w, h, faceFill, { pressed, shadow: opts.shadow !== false, border: stroke ?? DEFAULTS.ink });
      if (isFocused) { g.lineStyle(3, DEFAULTS.fill, 0.9); g.strokeRect(-w / 2 - 4 + off, -h / 2 - 4 + off, w + 8, h + 8); }
    }
    t.setPosition(off + (hasIcon ? 12 : 0), off);
    if (icon) icon.setPosition(-w / 2 + 26 + off, off);
  };
  draw(false, false);
  c.add(hasIcon ? [g, icon, t] : [g, t]);
  c.setSize(w, h);

  // GOTCHA: Phaser adds the container's displayOrigin (w/2,h/2, set by setSize) to the
  // container-local pointer coordinates BEFORE the hitArea callback runs. So a hand-rolled hit
  // shape must be expressed TOP-LEFT-based — Rectangle(0,0,w,h) / Circle(w/2,h/2,r) — to land on
  // a centered-drawn face; a shape centered on the container's own (0,0) here silently shifts
  // every hit half a button off (left/up for a rect, or entirely missed for a circle centered
  // at the origin instead of at (w/2,h/2)).
  if (shape === 'circle') {
    c.setInteractive(new Phaser.Geom.Circle(w / 2, h / 2, w / 2 + HIT_PAD), Phaser.Geom.Circle.Contains);
  } else {
    c.setInteractive(new Phaser.Geom.Rectangle(-HIT_PAD, -HIT_PAD, w + HIT_PAD * 2, h + HIT_PAD * 2), Phaser.Geom.Rectangle.Contains);
  }

  let enabled = true;
  c.on('pointerover', () => {
    if (!enabled) return;
    scene.input.setDefaultCursor('pointer');
    draw(false, true);
    if (!reducedMotion(opts)) scene.tweens.add({ targets: c, scale: 1.03, duration: 90 });
  });
  c.on('pointerout', () => {
    if (!enabled) return;
    scene.input.setDefaultCursor('default');
    draw(false, false);
    if (!reducedMotion(opts)) scene.tweens.add({ targets: c, scale: 1, duration: 90 }); else c.setScale(1);
  });
  c.on('pointerdown', () => { if (enabled) draw(true, false); });
  c.on('pointerup', () => {
    if (!enabled) return;
    draw(false, false);
    playPress(opts);
    onClick && onClick();
  });

  c.setEnabled = (on) => {
    enabled = on;
    c.__disabled = !on;
    c.setAlpha(on ? 1 : 0.45);
    if (on) c.setInteractive(); else c.disableInteractive();
    draw(false, isFocused);
    return c;
  };
  c.setDisabled = (off) => c.setEnabled(!off);
  c.setLabel = (s) => { t.setText(s); fitLabel(); return c; };
  c.label = t;
  c.icon = icon;

  // enableKeyboardNav() protocol: __redraw(pressed, focused), __fire(), __focused, __disabled.
  c.__redraw = (pressed, focused) => { isFocused = focused; draw(pressed, false); };
  c.__fire = () => { if (enabled) { playPress(opts); onClick && onClick(); } };
  c.__focused = false;
  c.__disabled = false;

  registerFocusable(scene, c, opts.focusable);
  return c;
}

/**
 * Secondary/outline button preset — smaller, lighter fill, still >= MIN_TAP effective.
 * @see button
 */
export function ghostButton(scene, x, y, label, onClick, opts = {}) {
  return button(scene, x, y, label, onClick, { ...opts, ghost: true });
}

/**
 * A compact circular glyph button (mute, back, speaker-style corner controls). Thin wrapper
 * over `button()` with `shape: 'circle'`.
 * @param {Phaser.Scene} scene @param {number} x @param {number} y
 * @param {string} glyph text/emoji glyph rendered centered — for a fully self-drawn icon (no
 *   emoji-font dependency), see `muteButton.js` instead
 * @param {() => void} onClick
 * @param {object} [opts] see `button()`; `size` sets both width/height (default 52)
 * @returns {Phaser.GameObjects.Container}
 */
export function iconButton(scene, x, y, glyph, onClick, opts = {}) {
  const size = Math.max(opts.size ?? 52, MIN_TAP);
  return button(scene, x, y, glyph, onClick, {
    fill: DEFAULTS.panelLight,
    textColor: '#' + DEFAULTS.ink.toString(16).padStart(6, '0'),
    stroke: DEFAULTS.line,
    fontSize: Math.round(size * 0.46),
    hitPad: 8,
    ...opts,
    shape: 'circle',
    width: size,
    height: size,
  });
}

/**
 * A card/panel background, centered at (x,y) — consistent with every other factory here.
 * @param {Phaser.Scene} scene
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {{ style?: 'card'|'bevel', fill?: number, stroke?: number|null, strokeW?: number, radius?: number, shadow?: boolean, alpha?: number, depth?: number }} [opts]
 *   `style: 'card'` (default) is a rounded rect + soft drop shadow; `'bevel'` is the flat SNES
 *   cartridge look (`bevelRect`).
 * @returns {Phaser.GameObjects.Graphics}
 */
export function panel(scene, x, y, w, h, opts = {}) {
  const g = scene.add.graphics();
  if (opts.style === 'bevel') {
    bevelRect(g, x - w / 2, y - h / 2, w, h, opts.fill ?? DEFAULTS.panel, { shadow: opts.shadow, border: opts.stroke });
  } else {
    const r = opts.radius ?? 20;
    if (opts.shadow !== false) { g.fillStyle(0x000000, 0.08); g.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 6, w, h, r); }
    g.fillStyle(opts.fill ?? DEFAULTS.panel, opts.alpha ?? 1); g.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
    if (opts.stroke != null) { g.lineStyle(opts.strokeW ?? 3, opts.stroke, 1); g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r); }
  }
  g.setDepth(opts.depth ?? 0);
  return g;
}

/**
 * Centered title heading, optionally with a subtitle line beneath.
 * @param {Phaser.Scene} scene @param {string} title
 * @param {{ x?: number, y?: number, size?: number, color?: string, stroke?: boolean, strokeColor?: string, strokeThickness?: number, subtitle?: string, subtitleGap?: number, subtitleSize?: number, subtitleColor?: string, fontFamily?: string }} [opts]
 *   `x` defaults to the scene's horizontal center.
 * @returns {Phaser.GameObjects.Text} the title text object
 */
export function header(scene, title, opts = {}) {
  const x = opts.x ?? scene.scale.width / 2;
  const y = opts.y ?? 46;
  const fontFamily = opts.fontFamily ?? DEFAULTS.fontFamily;
  const style = {
    fontFamily, fontSize: `${opts.size ?? 40}px`, fontStyle: 'bold',
    color: opts.color ?? DEFAULTS.textColor, align: 'center',
  };
  if (opts.stroke !== false) {
    style.stroke = opts.strokeColor ?? '#000000';
    style.strokeThickness = opts.strokeThickness ?? 4;
  }
  const t = scene.add.text(x, y, title, style).setOrigin(0.5);
  if (opts.subtitle) {
    scene.add.text(x, y + (opts.subtitleGap ?? 34), opts.subtitle, {
      fontFamily, fontSize: `${opts.subtitleSize ?? 20}px`, color: opts.subtitleColor ?? '#cccccc', align: 'center',
    }).setOrigin(0.5);
  }
  return t;
}

/**
 * A small rounded stat tag/badge, centered at (x,y), auto-sized to its text.
 * @param {Phaser.Scene} scene @param {number} x @param {number} y @param {string} text
 * @param {{ style?: 'card'|'bevel', fill?: number, stroke?: number|null, strokeW?: number, textColor?: string, fontSize?: number, fontFamily?: string, padX?: number, height?: number, minWidth?: number, radius?: number }} [opts]
 * @returns {Phaser.GameObjects.Container} with `.label` (the Text object)
 */
export function pill(scene, x, y, text, opts = {}) {
  const padX = opts.padX ?? 14;
  const h = opts.height ?? 34;
  const fontSize = opts.fontSize ?? 18;
  const fontFamily = opts.fontFamily ?? DEFAULTS.fontFamily;
  const textColor = opts.textColor ?? '#' + DEFAULTS.ink.toString(16).padStart(6, '0');
  const tmp = scene.add.text(0, 0, text, { fontFamily, fontSize: `${fontSize}px`, fontStyle: 'bold' }).setVisible(false);
  const w = Math.max(opts.minWidth ?? 0, tmp.width + padX * 2);
  tmp.destroy();
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  if (opts.style === 'bevel') {
    bevelRect(g, -w / 2, -h / 2, w, h, opts.fill ?? DEFAULTS.panelLight, { bevel: 2, shadow: false });
  } else {
    const r = opts.radius ?? h / 2;
    g.fillStyle(opts.fill ?? DEFAULTS.panelLight, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    if (opts.stroke != null) { g.lineStyle(opts.strokeW ?? 2, opts.stroke, 1); g.strokeRoundedRect(-w / 2, -h / 2, w, h, r); }
  }
  const t = scene.add.text(0, 0, text, { fontFamily, fontSize: `${fontSize}px`, fontStyle: 'bold', color: textColor, align: 'center' }).setOrigin(0.5);
  c.add([g, t]);
  c.setSize(w, h);
  c.label = t;
  return c;
}

/**
 * A transient centered banner ("Saved!", "Nice try!"). Auto-dismisses after `holdMs`. Fades
 * quickly rather than being skipped outright when reduced motion is requested — the message
 * still needs to visibly appear and disappear either way.
 * @param {Phaser.Scene} scene @param {string} message
 * @param {{ x?: number, y?: number, fill?: number, textColor?: string, fontSize?: number, fontFamily?: string, padX?: number, holdMs?: number, depth?: number, settings?: object }} [opts]
 * @returns {{ bg: Phaser.GameObjects.Graphics, text: Phaser.GameObjects.Text }}
 */
export function toast(scene, message, opts = {}) {
  const x = opts.x ?? scene.scale.width / 2;
  const y = opts.y ?? 120;
  const fill = opts.fill ?? DEFAULTS.ink;
  const depth = opts.depth ?? 100;
  const t = scene.add.text(x, y, message, {
    fontFamily: opts.fontFamily ?? DEFAULTS.fontFamily, fontSize: `${opts.fontSize ?? 26}px`,
    fontStyle: 'bold', color: opts.textColor ?? '#ffffff', align: 'center',
  }).setOrigin(0.5).setDepth(depth);
  const pad = opts.padX ?? 18;
  const bg = scene.add.graphics().setDepth(depth - 1);
  bg.fillStyle(fill, 0.92).fillRoundedRect(x - t.width / 2 - pad, y - t.height / 2 - 8, t.width + pad * 2, t.height + 16, 18);
  const grp = [bg, t];
  const fast = reducedMotion(opts);
  grp.forEach((o) => o.setAlpha(0));
  scene.tweens.add({ targets: grp, alpha: 1, duration: fast ? 60 : 180 });
  scene.time.delayedCall(opts.holdMs ?? 2200, () => {
    scene.tweens.add({ targets: grp, alpha: 0, duration: fast ? 80 : 300, onComplete: () => grp.forEach((o) => o.destroy()) });
  });
  return { bg, text: t };
}

/**
 * A short celebratory confetti burst. Piece count (and so perceived motion) is cut down when
 * `settings.reducedMotion()` is on, rather than removed outright — suppressing celebrations
 * entirely is `settings.quietCelebrations`'s job (see core/feedback), not this function's.
 * @param {Phaser.Scene} scene @param {number} x @param {number} y
 * @param {{ count?: number, colors?: number[], depth?: number, settings?: object }} [opts]
 */
export function confettiBurst(scene, x, y, opts = {}) {
  let count = opts.count ?? 40;
  if (reducedMotion(opts)) count = Math.min(count, 10);
  const colors = opts.colors ?? [0x2f6ef2, 0xf27127, 0xe0a100, 0x2fae5f, 0xe4573d];
  const keys = colors.map((color) => placeholder(scene, `ce-confetti-${color.toString(16)}`, (g) => {
    g.fillStyle(color, 1).fillRoundedRect(0, 0, 18, 12, 4);
  }, { width: 18, height: 12 }));
  for (let i = 0; i < count; i++) {
    const p = scene.add.image(x, y, keys[i % keys.length]).setDepth(opts.depth ?? 90);
    const ang = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * 380;
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed - 220;
    scene.tweens.add({
      targets: p, x: x + vx, y: y + vy + 420, angle: Math.random() * 720 - 360,
      alpha: { from: 1, to: 0 }, duration: 1100 + Math.random() * 700, ease: 'Cubic.easeIn',
      onComplete: () => p.destroy(),
    });
  }
}

/**
 * Tab cycles focus among the scene's registered buttons (see `button()`'s `focusable` opt, on
 * by default); Enter or Space fires the focused one. Call once per scene that has buttons.
 * @param {Phaser.Scene} scene
 * @returns {() => void} teardown — removes the keyboard listeners this installed
 */
export function enableKeyboardNav(scene) {
  if (!scene.input?.keyboard) return () => {};
  const setFocus = (i) => {
    (scene.__focusables || []).forEach((b, k) => {
      b.__focused = k === i;
      if (b.active) b.__redraw?.(false, b.__focused);
    });
  };
  const onTab = (e) => {
    e.preventDefault();
    const list = (scene.__focusables || []).filter((b) => b.active && !b.__disabled);
    if (!list.length) return;
    const cur = list.findIndex((b) => b.__focused);
    const next = (cur + (e.shiftKey ? -1 : 1) + list.length) % list.length;
    setFocus((scene.__focusables || []).indexOf(list[next]));
  };
  const onFire = () => {
    const f = (scene.__focusables || []).find((b) => b.__focused && b.active);
    f?.__fire?.();
  };
  scene.input.keyboard.on('keydown-TAB', onTab);
  scene.input.keyboard.on('keydown-ENTER', onFire);
  scene.input.keyboard.on('keydown-SPACE', onFire);
  scene.events.once('shutdown', () => { scene.__focusables = []; });
  return () => {
    scene.input.keyboard.off('keydown-TAB', onTab);
    scene.input.keyboard.off('keydown-ENTER', onFire);
    scene.input.keyboard.off('keydown-SPACE', onFire);
  };
}
