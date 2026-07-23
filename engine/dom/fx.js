// fx.js — the core/feedback sink for vanilla DOM games: floatText, particle
// burst, boing/wiggle/shake micro-animations, screen thump, confetti, plus
// the standalone makeStreak(el) pill widget. Ported near-verbatim from Math
// Arcade's fx.js + the confetti canvas loop in its utils.js. Self-contained:
// injects its own <style> with the keyframes it needs on first use, so a
// game doesn't have to remember to link a separate stylesheet. Every
// animation function takes an optional trailing `gates` object
// (`{quietCelebrations, reducedMotion}` — core/feedback.js passes this
// automatically) and dampens itself under reducedMotion.
// DOM-only — syntax-checked, not unit-tested (see docs/CONTRACTS.md "Tests").

import { el } from './ui.js';

let stylesInstalled = false;
function ensureStyles() {
  if (stylesInstalled || typeof document === 'undefined') return;
  stylesInstalled = true;
  const style = document.createElement('style');
  style.setAttribute('data-ce-fx', '');
  style.textContent = `
.ce-fx-float { position: fixed; z-index: 9990; pointer-events: none; font-weight: 800;
  font-size: clamp(16px, 3vw, 26px); text-shadow: 0 2px 0 rgba(0,0,0,0.25);
  transform: translate(-50%, 0); animation: ce-fx-float-up 1.1s ease-out forwards; }
.ce-fx-float.ce-fx-reduced { animation-duration: 0.6s; }
@keyframes ce-fx-float-up { 0% { opacity: 0; transform: translate(-50%, 6px) scale(0.9); }
  15% { opacity: 1; transform: translate(-50%, -6px) scale(1.05); }
  100% { opacity: 0; transform: translate(-50%, -46px) scale(1); } }

.ce-fx-particle { position: fixed; z-index: 9989; pointer-events: none; font-size: 20px;
  transform: translate(-50%, -50%); animation: ce-fx-particle-out 0.9s ease-out forwards; }
@keyframes ce-fx-particle-out { 0% { opacity: 1; transform: translate(-50%, -50%) rotate(0deg); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% + var(--dy, 0px))) rotate(var(--rot, 90deg)); } }

@keyframes ce-fx-boing { 0% { transform: scale(1); } 30% { transform: scale(1.18, 0.85); }
  55% { transform: scale(0.94, 1.08); } 100% { transform: scale(1); } }
.ce-fx-boing { animation: ce-fx-boing 0.38s cubic-bezier(.34,1.56,.64,1); }
.ce-fx-boing.ce-fx-reduced { animation: none; }

@keyframes ce-fx-wiggle { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-6deg); }
  75% { transform: rotate(6deg); } }
.ce-fx-wiggle { animation: ce-fx-wiggle 0.32s ease-in-out; }
.ce-fx-wiggle.ce-fx-reduced { animation-duration: 0.12s; }

@keyframes ce-fx-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
.ce-fx-shake { animation: ce-fx-shake 0.32s ease-in-out; }
.ce-fx-shake.ce-fx-reduced { animation-duration: 0.12s; }

@keyframes ce-fx-thump { 0% { transform: scale(1); } 40% { transform: scale(1.01); } 100% { transform: scale(1); } }
.ce-fx-thump { animation: ce-fx-thump 0.22s ease-out; }
`;
  document.head.appendChild(style);
}

function restartAnim(target, cls) {
  if (!target) return;
  target.classList.remove(cls);
  void target.offsetWidth; // force reflow so re-adding the class restarts the animation
  target.classList.add(cls);
}

/**
 * Floating text that rises and fades over `target`'s center.
 * @param {Element} target
 * @param {string} text
 * @param {{color?: string}} [opts]
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates] - passed automatically by core/feedback.js
 * @returns {void}
 */
export function floatText(target, text, opts, gates) {
  if (!target || typeof document === 'undefined') return;
  ensureStyles();
  const { color = '#ffd93d' } = opts || {};
  const r = target.getBoundingClientRect();
  const reduced = !!(gates && gates.reducedMotion);
  const f = el('div', 'ce-fx-float' + (reduced ? ' ce-fx-reduced' : ''), { text });
  f.style.left = r.left + r.width / 2 + 'px';
  f.style.top = r.top + 'px';
  f.style.color = color;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), reduced ? 650 : 1150);
}

/**
 * Emoji particle burst from `target`'s center.
 * @param {Element} target
 * @param {{emojis?: string[], count?: number}} [opts]
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates]
 * @returns {void}
 */
export function burst(target, opts, gates) {
  if (!target || typeof document === 'undefined') return;
  ensureStyles();
  const { emojis = ['✨', '⭐'], count = 10 } = opts || {};
  if (gates && gates.reducedMotion) return; // celebration-tier + motion-heavy: skip outright rather than dampen
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = el('div', 'ce-fx-particle', { text: emojis[i % emojis.length] });
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 60 + Math.random() * 70;
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist - 40 + 'px');
    p.style.setProperty('--rot', Math.random() * 360 - 180 + 'deg');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

/**
 * Quick squash-and-stretch bounce — the "gentle success" cue.
 * @param {Element} target
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates]
 * @returns {void}
 */
export function boing(target, gates) {
  if (!target) return;
  ensureStyles();
  restartAnim(target, (gates && gates.reducedMotion) ? 'ce-fx-boing ce-fx-reduced' : 'ce-fx-boing');
}

/**
 * Small rotate-wiggle — the "gentle mistake" cue.
 * @param {Element} target
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates]
 * @returns {void}
 */
export function wiggle(target, gates) {
  if (!target) return;
  ensureStyles();
  restartAnim(target, (gates && gates.reducedMotion) ? 'ce-fx-wiggle ce-fx-reduced' : 'ce-fx-wiggle');
}

/**
 * Small horizontal shake — an alternate "gentle mistake" cue.
 * @param {Element} target
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates]
 * @returns {void}
 */
export function shake(target, gates) {
  if (!target) return;
  ensureStyles();
  restartAnim(target, (gates && gates.reducedMotion) ? 'ce-fx-shake ce-fx-reduced' : 'ce-fx-shake');
}

/**
 * Subtle whole-page thump for big moments.
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates]
 * @returns {void}
 */
export function thump(gates) {
  if (typeof document === 'undefined' || (gates && gates.reducedMotion)) return;
  ensureStyles();
  restartAnim(document.body, 'ce-fx-thump');
}

// ---- confetti: a plain <canvas id="ce-confetti-canvas"> overlay, created lazily ----
let confettiCanvas = null;
let confettiRunning = false;
function ensureConfettiCanvas() {
  if (confettiCanvas) return confettiCanvas;
  if (typeof document === 'undefined') return null;
  confettiCanvas = document.getElementById('ce-confetti-canvas');
  if (!confettiCanvas) {
    confettiCanvas = el('canvas', '', { id: 'ce-confetti-canvas' });
    Object.assign(confettiCanvas.style, { position: 'fixed', inset: '0', zIndex: '9995', pointerEvents: 'none' });
    document.body.appendChild(confettiCanvas);
  }
  return confettiCanvas;
}

/**
 * Full-screen confetti fall (Math Arcade's canvas loop). No-ops under reducedMotion.
 * @param {{count?: number, colors?: string[]}} [opts]
 * @param {{quietCelebrations?: boolean, reducedMotion?: boolean}} [gates]
 * @returns {void}
 */
export function confetti(opts, gates) {
  if (gates && gates.reducedMotion) return;
  const cv = ensureConfettiCanvas();
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const { count = 120, colors = ['#ff5fa2', '#ffd93d', '#4dd8ff', '#6bf178', '#b388ff', '#ff9f45'] } = opts || {};
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
    size: 6 + Math.random() * 8, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  let frames = 0;
  confettiRunning = true;
  // A second confetti() call before this one finishes shares the same
  // canvas + `confettiRunning` flag (Math Arcade's original behavior) —
  // both loops draw until the flag drops; stopConfetti()/reduced-motion
  // callers just need "off", not independent multi-burst bookkeeping.
  (function tick() {
    if (!confettiRunning) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (++frames < 180) requestAnimationFrame(tick);
    else { ctx.clearRect(0, 0, cv.width, cv.height); confettiRunning = false; }
  })();
}

/**
 * Stops and clears any in-flight confetti immediately.
 * @returns {void}
 */
export function stopConfetti() {
  confettiRunning = false;
  if (confettiCanvas) confettiCanvas.getContext('2d').clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

/**
 * Streak-meter pill widget (Math Arcade's makeStreak(hud)): games call
 * hit()/miss() on each answer; shows "🔥 xN" once the streak reaches
 * `bonusAt`. Purely visual/DOM — core/feedback.js's createStreak() is the
 * DOM-free version of the same counting logic, for games that want the
 * count without a pre-built pill.
 * @param {HTMLElement} hud - container the pill is appended to
 * @param {{bonusAt?: number}} [opts]
 * @returns {{hit: (target?: Element) => number, miss: Function, value: number}}
 */
export function makeStreak(hud, { bonusAt = 3 } = {}) {
  ensureStyles();
  const pill = el('div', 'hud-pill ce-streak-pill', { text: '' });
  pill.style.display = 'none';
  hud.appendChild(pill);
  let n = 0;
  return {
    hit(target) {
      n++;
      if (n >= bonusAt) {
        pill.style.display = '';
        pill.textContent = `🔥 x${n}`;
        boing(pill);
        if (target) floatText(target, n >= bonusAt + 2 ? '🔥 ON FIRE!' : '🔥 STREAK!', { color: '#ff9f45' });
      }
      return n;
    },
    miss() { n = 0; pill.style.display = 'none'; return n; },
    get value() { return n; },
  };
}
