// feedback.js — renderer-agnostic feedback core: gates a visual "sink" by
// settings (quietCelebrations + reducedMotion), builds kid-friendly
// diagnosis strings (goofy-rocket-lab's "Almost! ... Try changing X."
// pattern, ported from TypeScript to plain JS and generalized), tracks
// streaks, and runs a pip-meter state machine (netrunner's TrustMeter,
// stripped of Phaser down to pure state). No DOM, no canvas, no Phaser —
// dom/fx.js is the sink that actually draws things; Phaser games pass their
// own sink with the same method names.

/**
 * The two feedback tiers:
 *  - "always": small, per-interaction cues tied to a specific element
 *    (floatText, wiggle, shake, boing) — Ctrl+Create's insight is that these
 *    read as UI feedback, not a "celebration", so quiet classroom mode
 *    leaves them on. They still receive the current gates so the sink can
 *    dampen the motion for a reduced-motion player.
 *  - "celebration": bigger, broadcast-y, decorative beats (burst, confetti,
 *    thump) — suppressed outright by quietCelebrations OR reducedMotion.
 * @param {{
 *   settings?: {get: Function, reducedMotion?: Function},
 *   sink?: Object<string, Function>,
 * }} [opts]
 * @returns {{
 *   floatText: Function, wiggle: Function, shake: Function, boing: Function,
 *   burst: Function, thump: Function, confetti: Function,
 *   gates: () => {quietCelebrations: boolean, reducedMotion: boolean},
 *   diagnose: Function, createPipMeter: Function,
 *   createStreak: Function, streak: {hit: Function, miss: Function, reset: Function, value: number, best: number, isBonus: Function},
 * }}
 */
export function createFeedback({ settings, sink = {} } = {}) {
  function isQuiet() {
    try { return settings ? !!settings.get('quietCelebrations') : false; } catch { return false; }
  }
  function isReduced() {
    try { return settings && typeof settings.reducedMotion === 'function' ? !!settings.reducedMotion() : false; } catch { return false; }
  }
  function gates() { return { quietCelebrations: isQuiet(), reducedMotion: isReduced() }; }

  function invoke(name, { celebration = false } = {}, ...args) {
    if (celebration && (isQuiet() || isReduced())) return undefined;
    const fn = sink && sink[name];
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args, gates()); } catch { return undefined; } // a broken sink must never crash the game
  }

  return {
    /** Text that floats up from `target` and fades (always shown; sink dampens motion under reducedMotion). */
    floatText(target, text, opts) { return invoke('floatText', {}, target, text, opts); },
    /** Small rotate-wiggle on `target` — the "gentle mistake" cue. */
    wiggle(target) { return invoke('wiggle', {}, target); },
    /** Small horizontal shake on `target` — an alternate "gentle mistake" cue. */
    shake(target) { return invoke('shake', {}, target); },
    /** Quick squash-and-stretch bounce on `target` — the "gentle success" cue. */
    boing(target) { return invoke('boing', {}, target); },
    /** Emoji particle burst — a celebration beat; suppressed by quiet/reduced-motion. */
    burst(target, opts) { return invoke('burst', { celebration: true }, target, opts); },
    /** Subtle whole-screen thump for big moments — a celebration beat. */
    thump() { return invoke('thump', { celebration: true }); },
    /** Full-screen confetti — a celebration beat. */
    confetti(opts) { return invoke('confetti', { celebration: true }, opts); },

    /** Current gate state, in case a caller wants to branch without going through the sink. */
    gates,

    diagnose,
    createPipMeter,
    createStreak,
    /** A ready-to-use streak tracker shared by anything holding this feedback instance. */
    streak: createStreak(),
  };
}

/**
 * Kid-friendly "almost" message: what happened, what was needed, and the one
 * thing to try changing (goofy-rocket-lab's getDiagnosis()/getClue() shape).
 * Content-agnostic — the game decides which check failed and how to phrase
 * `observed`/`target`/`suggestion`; this just gives every game the same
 * gentle three-part sentence instead of hand-rolling it per mini-game.
 * @param {{observed?: string, target?: string, suggestion?: string}} [info]
 * @returns {string}
 */
export function diagnose({ observed, target, suggestion } = {}) {
  const bits = ['Almost!'];
  if (observed && target) bits.push(`${observed}, but ${target}.`);
  else if (observed) bits.push(`${observed}.`);
  else if (target) bits.push(`${target}.`);
  if (suggestion) bits.push(`Try changing ${suggestion}.`);
  else if (bits.length === 1) bits.push('Try again.');
  return bits.join(' ');
}

/**
 * Pure pip-meter state machine (netrunner's TrustMeter, minus Phaser/visuals):
 * n pips, absorb (damage) / refill (restore), edge-triggered onEmpty/onFull.
 * @param {{max?: number, initial?: number, onEmpty?: Function, onFull?: Function}} [opts]
 * @returns {{
 *   absorb: (amount?: number) => number, refill: (amount?: number) => number,
 *   reset: () => number, get: () => number,
 *   isEmpty: () => boolean, isFull: () => boolean, max: number,
 * }}
 */
export function createPipMeter({ max = 5, initial = max, onEmpty, onFull } = {}) {
  const cap = Math.max(1, max | 0);
  function clamp(v) { return Math.max(0, Math.min(cap, v)); }
  let pips = clamp(initial);

  function absorb(amount = 1) {
    const was = pips;
    pips = clamp(pips - Math.max(0, amount));
    if (pips !== was && pips === 0 && typeof onEmpty === 'function') onEmpty();
    return pips;
  }
  function refill(amount = 1) {
    const was = pips;
    pips = clamp(pips + Math.max(0, amount));
    if (pips !== was && pips === cap && typeof onFull === 'function') onFull();
    return pips;
  }
  function reset() { pips = clamp(initial); return pips; }

  return {
    absorb,
    refill,
    reset,
    get: () => pips,
    isEmpty: () => pips <= 0,
    isFull: () => pips >= cap,
    get max() { return cap; },
  };
}

/**
 * Pure streak counter (Math Arcade's makeStreak(), minus the DOM pill).
 * @param {{bonusAt?: number}} [opts]
 * @returns {{hit: () => number, miss: () => number, reset: () => number, value: number, best: number, isBonus: () => boolean}}
 */
export function createStreak({ bonusAt = 3 } = {}) {
  let n = 0;
  let best = 0;
  return {
    hit() { n += 1; if (n > best) best = n; return n; },
    miss() { n = 0; return n; },
    reset() { n = 0; return n; },
    get value() { return n; },
    get best() { return best; },
    isBonus() { return n >= bonusAt; },
  };
}
