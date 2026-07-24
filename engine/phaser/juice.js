// juice.js — opt-in game-feel toolkit: squash-and-stretch pop, camera shake, pooled particle
// bursts, overshoot-and-settle UI transitions, a success-celebration combo, and a deliberately
// understated "try again" ack. Nothing here fires on its own — a game calls these explicitly (see
// the game-juicer skill, which maps a game's actions/events onto this module with Clint's
// approval). Assumes a global `Phaser`; only touched inside function bodies below so a future
// smoke test can stub it. Every function takes an optional `settings` (engine core settings) in
// its opts and gates itself the same way core/feedback.js's two tiers do: "always" cues (pop,
// popIn/popOut, tryAgain, the collect/sparkle burst presets) just shorten/thin out under
// reducedMotion; "celebration" cues (shake, the celebrate burst preset, the celebrate() combo)
// are fully skipped under quietCelebrations OR reducedMotion — screen-wide motion is the one
// effect here that can't be dampened instead of removed.
//
// Two ownership rules keep juice safe to call on real game objects: (1) a target's rest pose
// (scaleX/scaleY/alpha as the game last left them) is captured the first time an effect touches
// it and restored on settle — never a hardcoded scale 1, so sprites and containers with non-1
// base scales survive juicing; (2) effects only ever stop tweens this module itself started —
// never `killTweensOf(target)`, which would also kill game-owned movement/patrol tweens.

import { placeholder } from './textures.js';

function reducedMotion(opts) {
  try { return !!opts.settings?.reducedMotion?.(); } catch (e) { return false; }
}

function quietCelebrations(opts) {
  try { return !!opts.settings?.get?.('quietCelebrations'); } catch (e) { return false; }
}

// Clint's house palette (core/codes.js's DEFAULT_PALETTE, as 0xRRGGBB for Phaser tinting).
const PALETTE = [0xe63946, 0xf1a208, 0x2a9d8f, 0x264653, 0xe76f51, 0x457b9d, 0x8338ec, 0x3a86ff];

const SHAKE_LEVELS = {
  small: { duration: 120, intensity: 0.004 },
  medium: { duration: 220, intensity: 0.009 },
  big: { duration: 380, intensity: 0.018 },
};

const BURST_PRESETS = {
  collect: { colors: [0xf1a208, 0x2a9d8f, 0xffffff], count: 8, size: 8, spread: 55, life: 460 },
  sparkle: { colors: [0xffffff, 0xf1a208, 0x457b9d], count: 9, size: 6, spread: 30, life: 520 },
  celebrate: { colors: PALETTE, count: 22, size: 13, spread: 240, life: 950 },
};

const STATE_KEY = '__ceJuiceState';

// Per-target juice state: the rest pose captured while the target was un-juiced, plus the tweens
// this module started on it. Created on first touch, dropped on settle (release) so a game's
// later setScale/setAlpha becomes the new rest next time.
function juiceState(target) {
  if (!target[STATE_KEY]) {
    target[STATE_KEY] = {
      sx: target.scaleX ?? 1,
      sy: target.scaleY ?? 1,
      alpha: target.alpha ?? 1,
      tweens: [],
    };
  }
  return target[STATE_KEY];
}

function killOwnTweens(state) {
  for (const t of state.tweens) {
    try { t.stop(); } catch (e) { /* already removed by Phaser — nothing left to stop */ }
  }
  state.tweens = [];
}

function release(target) {
  target[STATE_KEY] = null;
}

/**
 * Quick squash-and-stretch bounce on a sprite/image/container — the general "this reacted" cue
 * (tap, hit, pick-up). Rapid-fire triggers restart cleanly from the captured rest pose instead
 * of stacking; `stretch`/`squash` are multipliers on the rest scale, so a 0.5-scale sprite pops
 * around 0.5, not around 1.
 * @param {Phaser.GameObjects.GameObject} target must have a `.scene`
 * @param {{ squash?: number, stretch?: number, duration?: number, settings?: object }} [opts]
 * @returns {void}
 */
export function pop(target, opts = {}) {
  if (!target?.scene) return;
  const scene = target.scene;
  const st = juiceState(target);
  killOwnTweens(st);
  const dur = (reducedMotion(opts) ? 0.5 : 1) * (opts.duration ?? 260);
  const stretch = opts.stretch ?? 1.18;
  const squash = opts.squash ?? 0.82;
  target.setScale(st.sx, st.sy);
  st.tweens.push(scene.tweens.add({
    targets: target, scaleX: st.sx * stretch, scaleY: st.sy * squash, duration: dur * 0.35, ease: 'Quad.easeOut',
    onComplete: () => {
      st.tweens.push(scene.tweens.add({
        targets: target, scaleX: st.sx, scaleY: st.sy, duration: dur * 0.65, ease: 'Back.easeOut',
        onComplete: () => release(target),
      }));
    },
  }));
}

/**
 * Camera shake with three preset intensity levels: `'small'` (a light bump), `'medium'` (a solid
 * hit), `'big'` (a rare, high-impact moment). Fully skipped under quietCelebrations OR
 * reducedMotion — the textbook vestibular-motion trigger, so it's an on/off effect, not a
 * dampened one.
 * @param {Phaser.Scene} scene
 * @param {'small'|'medium'|'big'} [level='medium']
 * @param {{ settings?: object }} [opts]
 * @returns {void}
 */
export function shake(scene, level = 'medium', opts = {}) {
  if (!scene?.cameras?.main) return;
  if (quietCelebrations(opts) || reducedMotion(opts)) return;
  const spec = SHAKE_LEVELS[level] ?? SHAKE_LEVELS.medium;
  scene.cameras.main.shake(spec.duration, spec.intensity);
}

const POOL_KEY = '__ceJuicePool';

function getPool(scene) {
  if (!scene[POOL_KEY]) {
    scene[POOL_KEY] = [];
    // Scene instances get reused across restart(); drop the pool on shutdown so a fresh
    // getPool() call re-inits (and re-registers this listener) instead of holding onto
    // references Phaser already destroyed.
    scene.events.once('shutdown', () => { scene[POOL_KEY] = null; });
  }
  return scene[POOL_KEY];
}

function acquireParticle(scene, textureKey) {
  const p = getPool(scene).pop();
  if (p) return p.setTexture(textureKey).setActive(true).setVisible(true);
  return scene.add.image(0, 0, textureKey);
}

function releaseParticle(scene, p) {
  scene.tweens.killTweensOf(p);
  p.setActive(false).setVisible(false);
  getPool(scene).push(p);
}

function dotTexture(scene, color, size) {
  return placeholder(scene, `ce-juice-dot-${color.toString(16)}-${size}`, (g) => {
    g.fillStyle(color, 1).fillCircle(size / 2, size / 2, size / 2);
  }, { width: size, height: size });
}

/**
 * Pooled particle burst at (x, y) — dots are reused via a per-scene pool instead of created and
 * destroyed on every call, so a pickup that happens dozens of times a session stays cheap on
 * Chromebooks. Three presets in Clint's house palette (core/codes.js): `'collect'` (a quick
 * mostly-upward puff for pickups — an "always" cue, just thinner under reducedMotion),
 * `'sparkle'` (a UI highlight that twinkles in place — same tier as collect), and `'celebrate'`
 * (a big outward burst across the whole palette that falls like confetti — a celebration beat,
 * fully skipped under quietCelebrations or reducedMotion, same as core/feedback's burst/confetti).
 * @param {Phaser.Scene} scene
 * @param {number} x @param {number} y
 * @param {'collect'|'sparkle'|'celebrate'} [preset='celebrate']
 * @param {{ count?: number, colors?: number[], depth?: number, settings?: object }} [opts]
 * @returns {void}
 */
export function burst(scene, x, y, preset = 'celebrate', opts = {}) {
  if (!scene) return;
  const spec = BURST_PRESETS[preset] ?? BURST_PRESETS.celebrate;
  const celebration = preset === 'celebrate';
  if (celebration && (quietCelebrations(opts) || reducedMotion(opts))) return;
  let count = opts.count ?? spec.count;
  if (!celebration && reducedMotion(opts)) count = Math.max(1, Math.round(count / 2));
  const colors = opts.colors ?? spec.colors;
  const depth = opts.depth ?? 80;

  for (let i = 0; i < count; i++) {
    const key = dotTexture(scene, colors[i % colors.length], spec.size);
    const p = acquireParticle(scene, key).setDepth(depth);

    if (preset === 'sparkle') {
      const dx = (Math.random() - 0.5) * spec.spread;
      const dy = (Math.random() - 0.5) * spec.spread;
      p.setPosition(x + dx, y + dy).setScale(0).setAlpha(0).setAngle(0);
      scene.tweens.add({
        targets: p, scale: 1, alpha: 1, duration: 140, ease: 'Back.easeOut',
        onComplete: () => {
          scene.tweens.add({
            targets: p, scale: 0, alpha: 0, delay: 100, duration: Math.max(80, spec.life - 140),
            onComplete: () => releaseParticle(scene, p),
          });
        },
      });
      continue;
    }

    p.setPosition(x, y).setScale(1).setAlpha(1).setAngle(0);
    const ang = preset === 'collect'
      ? -Math.PI / 2 + (Math.random() - 0.5) * 1.4 // mostly-upward puff
      : Math.random() * Math.PI * 2; // celebrate: every direction
    const dist = spec.spread * (0.5 + Math.random() * 0.5);
    const fall = celebration ? spec.spread * 0.8 : 0; // confetti-style fall after the outward pop
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(ang) * dist,
      y: y + Math.sin(ang) * dist + fall,
      angle: celebration ? Math.random() * 360 - 180 : 0,
      alpha: { from: 1, to: 0 },
      duration: spec.life,
      ease: preset === 'collect' ? 'Cubic.easeOut' : 'Cubic.easeIn',
      onComplete: () => releaseParticle(scene, p),
    });
  }
}

/**
 * Overshoot-and-settle entrance for a UI element (panel, dialog, badge): scales up past 1 then
 * eases back, so it reads as arriving with a bit of bounce rather than a flat fade-in. Skips the
 * overshoot under reducedMotion — still scales/fades in, just without the bounce.
 * @param {Phaser.GameObjects.GameObject} target
 * @param {{ duration?: number, from?: number, settings?: object }} [opts]
 * @returns {void}
 */
export function popIn(target, opts = {}) {
  if (!target?.scene) return;
  const scene = target.scene;
  const st = juiceState(target);
  killOwnTweens(st);
  const from = opts.from ?? 0;
  target.setScale(st.sx * from, st.sy * from).setAlpha(0);
  const timing = reducedMotion(opts)
    ? { duration: 120, ease: 'Quad.easeOut' }
    : { duration: opts.duration ?? 320, ease: 'Back.easeOut' };
  st.tweens.push(scene.tweens.add({
    targets: target, scaleX: st.sx, scaleY: st.sy, alpha: st.alpha, ...timing,
    onComplete: () => release(target),
  }));
}

/**
 * The exit counterpart to `popIn` — settles down to a small scale and fades, rather than a flat
 * disappear. Deliberately leaves the target off-rest (hidden), so the juice state is kept alive
 * rather than released: a later `popIn` restores the true rest pose, not the shrunken one.
 * @see popIn
 * @param {Phaser.GameObjects.GameObject} target
 * @param {{ duration?: number, to?: number, settings?: object, onComplete?: Function }} [opts]
 * @returns {void}
 */
export function popOut(target, opts = {}) {
  if (!target?.scene) return;
  const scene = target.scene;
  const st = juiceState(target);
  killOwnTweens(st);
  const isReduced = reducedMotion(opts);
  const to = opts.to ?? 0.8;
  st.tweens.push(scene.tweens.add({
    targets: target,
    scaleX: st.sx * to,
    scaleY: st.sy * to,
    alpha: 0,
    duration: isReduced ? 100 : (opts.duration ?? 220),
    ease: isReduced ? 'Quad.easeIn' : 'Back.easeIn',
    onComplete: () => opts.onComplete?.(),
  }));
}

/**
 * The "success" combo: pop the target, fire a palette-wide particle burst at its position, and a
 * small camera shake — one call for the common "correct!" / "level complete!" moment instead of
 * hand-assembling three effects per game. Fully skipped under quietCelebrations or reducedMotion
 * (matches core/feedback's celebration tier) rather than a scaled-down version — firing only part
 * of a combo tends to look worse than not firing it.
 * @param {Phaser.GameObjects.GameObject} target anchor for the pop + burst position
 * @param {{ shakeLevel?: 'small'|'medium'|'big'|false, burst?: object, settings?: object }} [opts]
 * @returns {void}
 */
export function celebrate(target, opts = {}) {
  if (!target?.scene) return;
  if (quietCelebrations(opts) || reducedMotion(opts)) return;
  const scene = target.scene;
  pop(target, opts);
  burst(scene, target.x, target.y, 'celebrate', { ...opts.burst, settings: opts.settings });
  if (opts.shakeLevel !== false) shake(scene, opts.shakeLevel ?? 'small', opts);
}

/**
 * The gentle "try again" acknowledgment for a wrong answer — a soft dim-and-return pulse. Never a
 * shake, a red flash, or a buzzer: per Clint's no-fail philosophy this is deliberately the calmest
 * cue in the module and should read as "not quite, try again," never as punishment.
 * @param {Phaser.GameObjects.GameObject} target
 * @param {{ duration?: number, dip?: number, settings?: object }} [opts]
 * @returns {void}
 */
export function tryAgain(target, opts = {}) {
  if (!target?.scene) return;
  const scene = target.scene;
  const st = juiceState(target);
  killOwnTweens(st);
  const dur = (reducedMotion(opts) ? 0.5 : 1) * (opts.duration ?? 260);
  const dip = opts.dip ?? 0.55;
  target.setAlpha(st.alpha).setScale(st.sx, st.sy);
  st.tweens.push(scene.tweens.add({
    targets: target, alpha: st.alpha * dip, scaleX: st.sx * 0.97, scaleY: st.sy * 0.97,
    duration: dur * 0.4, ease: 'Sine.easeOut',
    onComplete: () => {
      st.tweens.push(scene.tweens.add({
        targets: target, alpha: st.alpha, scaleX: st.sx, scaleY: st.sy,
        duration: dur * 0.6, ease: 'Sine.easeIn',
        onComplete: () => release(target),
      }));
    },
  }));
}
