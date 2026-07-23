// muteButton.js — a corner mute-toggle widget bound to engine core settings/audio. The icon is
// hand-drawn with Graphics (a speaker box + cone, plus sound-wave/X marks) rather than an emoji
// glyph, since emoji font coverage is inconsistent on managed Chromebooks. Assumes a global
// `Phaser`; only touched inside function bodies below.

const MIN_TAP = 44;

/**
 * Create a persistent mute toggle bound to `settings`/`audio`. Reacts to `settings.onChange`
 * so the icon stays correct even when mute is changed elsewhere (a settings screen, another
 * mute button, code) — settings is the single source of truth per the ctx contract. Also binds
 * the `M` key as a shortcut, matching the on-screen control.
 * @param {Phaser.Scene} scene
 * @param {number} x @param {number} y widget CENTER
 * @param {object} settings engine core settings — reads/writes the `muted` key
 * @param {object} [audio] engine core audio — `setMuted(bool)` is preferred when present (it
 *   mirrors to settings itself); without it this writes `settings.set('muted', ...)` directly
 * @param {{ size?: number, fill?: number, iconColor?: number, mutedColor?: number, depth?: number }} [opts]
 * @returns {{ container: Phaser.GameObjects.Container, redraw: () => void, destroy: () => void }}
 */
export function muteButton(scene, x, y, settings, audio, opts = {}) {
  if (!settings || typeof settings.get !== 'function') {
    throw new Error('muteButton requires a settings service ({ get, set, onChange })');
  }
  const size = Math.max(opts.size ?? 52, MIN_TAP);
  const fill = opts.fill ?? 0xf4f1ea;
  const iconColor = opts.iconColor ?? 0x23232b;
  const mutedColor = opts.mutedColor ?? 0xe4573d;
  const depth = opts.depth ?? 90;

  const c = scene.add.container(x, y).setDepth(depth);
  const bg = scene.add.graphics();
  const icon = scene.add.graphics();
  c.add([bg, icon]);
  c.setSize(size, size);

  function isMuted() {
    try { return !!settings.get('muted'); } catch (e) { return true; } // fail toward silent, never toward surprise sound
  }

  function drawBg() {
    bg.clear();
    bg.fillStyle(0x000000, 0.18); bg.fillCircle(3, 4, size / 2);
    bg.fillStyle(fill, 1); bg.fillCircle(0, 0, size / 2);
    bg.lineStyle(2, 0x000000, 0.15); bg.strokeCircle(0, 0, size / 2);
  }

  // Self-drawn speaker glyph, scaled to `size`: a box + cone always shown, plus either
  // sound-wave arcs (unmuted) or an X (muted) — mirrors netrunner's pixel-drawn MuteButton.
  function drawIcon() {
    const muted = isMuted();
    icon.clear();
    const s = size / 52; // original was tuned at 52px
    const bx = -14 * s, by = -8 * s;
    const color = muted ? mutedColor : iconColor;
    icon.fillStyle(color, 1);
    icon.fillRect(bx, by + 4 * s, 6 * s, 8 * s);
    icon.beginPath();
    icon.moveTo(bx + 6 * s, by + 4 * s);
    icon.lineTo(bx + 14 * s, by - 2 * s);
    icon.lineTo(bx + 14 * s, by + 18 * s);
    icon.lineTo(bx + 6 * s, by + 12 * s);
    icon.closePath();
    icon.fillPath();
    if (muted) {
      icon.lineStyle(3 * s, mutedColor, 1);
      icon.beginPath();
      icon.moveTo(bx + 18 * s, by + 2 * s); icon.lineTo(bx + 28 * s, by + 14 * s);
      icon.moveTo(bx + 28 * s, by + 2 * s); icon.lineTo(bx + 18 * s, by + 14 * s);
      icon.strokePath();
    } else {
      icon.lineStyle(2.5 * s, iconColor, 0.85);
      icon.beginPath(); icon.arc(bx + 6 * s, by + 8 * s, 12 * s, -0.6, 0.6); icon.strokePath();
      icon.beginPath(); icon.arc(bx + 6 * s, by + 8 * s, 18 * s, -0.5, 0.5); icon.strokePath();
    }
  }

  function redraw() { drawBg(); drawIcon(); }
  redraw();

  // Same GOTCHA as ui.js's button(): Phaser adds the container's displayOrigin (size/2,size/2,
  // fixed by Container for any sized object) to the local pointer BEFORE the hitArea callback
  // runs, so a circle centered on the art's true local origin (0,0) must be expressed here as
  // Circle(size/2, size/2, r) — Circle(0,0,r) would miss taps at the button's own visual center.
  c.setInteractive(new Phaser.Geom.Circle(size / 2, size / 2, size / 2 + 8), Phaser.Geom.Circle.Contains);

  function toggle() {
    const next = !isMuted();
    if (audio?.setMuted) audio.setMuted(next); else settings.set('muted', next);
  }
  c.on('pointerdown', () => { c.setScale(0.92); });
  c.on('pointerup', () => { c.setScale(1); toggle(); });
  c.on('pointerout', () => { c.setScale(1); });

  const offChange = typeof settings.onChange === 'function' ? settings.onChange(() => redraw()) : null;

  const onKeyM = () => toggle();
  scene.input?.keyboard?.on('keydown-M', onKeyM);

  function destroy() {
    try { offChange?.(); } catch (e) { /* ignore */ }
    scene.input?.keyboard?.off('keydown-M', onKeyM);
    c.destroy();
  }
  scene.events?.once('shutdown', destroy);

  return { container: c, redraw, destroy };
}
