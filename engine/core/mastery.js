// mastery.js — createMastery(): per-family XP/stage tracking, missed-fact
// review resurfacing, and weighted "what to practice next" selection. A
// content-agnostic port of critter-codex's MasteryEngine — it schedules
// WHICH family to practice, never WHAT the specific question/word/fact is
// (that stays game content; pickNext() hands back a family id, the game
// supplies the concrete item). Plus makeDistractors(): believable wrong
// numeric answers for a multiple-choice grid (DistractorGenerator, per-op
// branches folded into one generalized near-miss/big-jump algorithm).
//
// Persistence is deliberately NOT this module's job (unlike progress.js) —
// call exportState() and stash the result in the game's own save blob
// (e.g. `ctx.save.get().mastery = mastery.exportState(); ctx.save.save();`),
// then pass it back in as `initialState` next session.

const REVIEW_CHANCE = 0.35;   // chance to re-surface a missed fact instead of a fresh pick
const MISSED_CAP = 15;        // max remembered misses
const WEIGHT_BASE = 1;
const WEIGHT_SLEEPY_BONUS = 2;
const WEIGHT_LOW_MASTERY_BONUS = 2;
const DEFAULT_XP = Object.freeze({ correct: 10, fastBonus: 5, fastMs: 2000, stages: [0, 100, 300] });
const DEFAULT_DECAY_MS = 24 * 60 * 60 * 1000; // 1 day

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function blankFamily() { return { xp: 0, lastPracticedAt: 0, timesSeen: 0 }; }

/**
 * @param {object} options
 * @param {Array} options.families  opaque family ids (numbers, strings — a
 *   times-table factor, a typing key-pair id, a spelling pattern...)
 * @param {object} [options.xp]  { correct, fastBonus, fastMs, stages }
 * @param {number} [options.decay]  ms of inactivity before a family goes "sleepy"
 * @param {() => number} [options.now]  injectable clock, for decay tests
 * @param {{state:object, missed:Array}} [options.initialState]  from a prior exportState()
 * @param {() => number} [options.rng]  defaults to Math.random; inject
 *   mulberry32() (random.js) for deterministic tests
 * @returns {object}
 */
export function createMastery(options = {}) {
  const families = Array.isArray(options.families) ? options.families : [];
  const xpCfg = { ...DEFAULT_XP, ...(options.xp || {}) };
  if (!Array.isArray(xpCfg.stages) || xpCfg.stages.length === 0) xpCfg.stages = DEFAULT_XP.stages;
  const decayMs = typeof options.decay === 'number' && options.decay >= 0 ? options.decay : DEFAULT_DECAY_MS;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;

  const state = {};
  for (const f of families) state[f] = blankFamily();
  let missed = [];

  const seed = options.initialState;
  if (seed && typeof seed === 'object') {
    if (seed.state && typeof seed.state === 'object') {
      for (const f of families) {
        const s = seed.state[f];
        if (s && typeof s === 'object') {
          state[f] = {
            xp: Number(s.xp) || 0,
            lastPracticedAt: Number(s.lastPracticedAt) || 0,
            timesSeen: Number(s.timesSeen) || 0,
          };
        }
      }
    }
    if (Array.isArray(seed.missed)) missed = seed.missed.slice(0, MISSED_CAP);
  }

  /** @param {number} xpValue @returns {number} 0-based stage index */
  function stageFor(xpValue) {
    let stage = 0;
    for (let i = 0; i < xpCfg.stages.length; i++) {
      if (xpValue >= xpCfg.stages[i]) stage = i; else break;
    }
    return stage;
  }

  function masteryPercent(family) {
    const s = state[family];
    if (!s) return 0;
    const cap = xpCfg.stages[xpCfg.stages.length - 1];
    if (!(cap > 0)) return s.xp > 0 ? 1 : 0;
    return clamp01(s.xp / cap);
  }

  function isSleepy(family) {
    const s = state[family];
    // `timesSeen`, not lastPracticedAt's truthiness, is the "never practiced"
    // signal — a real practice event can legitimately land at timestamp 0
    // (e.g. a test clock, or Date.now() near a fixed epoch), which must not
    // read as "never happened".
    if (!s || s.timesSeen === 0) return false;
    return (now() - s.lastPracticedAt) > decayMs;
  }

  function missKey(family, id) { return `${family}:${id}`; }

  function recordMiss(family, id, extra) {
    for (let i = missed.length - 1; i >= 0; i--) {
      if (missKey(missed[i].family, missed[i].id) === missKey(family, id)) missed.splice(i, 1);
    }
    missed.push({ family, id, ...extra });
    while (missed.length > MISSED_CAP) missed.shift();
  }
  function clearMiss(family, id) {
    for (let i = missed.length - 1; i >= 0; i--) {
      if (missKey(missed[i].family, missed[i].id) === missKey(family, id)) missed.splice(i, 1);
    }
  }

  /**
   * @param {{family:*, id?:*, difficultyBonus?:number}} fact
   * @param {boolean} correct
   * @param {number} [ms]  elapsed answer time; under xp.fastMs earns a speed bonus
   * @returns {{gained:number, fast:boolean, xp:number, oldStage:number, newStage:number, stageUp:boolean}}
   */
  function award(fact, correct, ms) {
    const family = fact && fact.family;
    if (!(family in state)) state[family] = blankFamily();
    const s = state[family];
    const oldStage = stageFor(s.xp);
    let gained = 0;
    let fast = false;

    if (correct) {
      gained = xpCfg.correct;
      const bonus = fact && Number(fact.difficultyBonus);
      if (Number.isFinite(bonus)) gained += bonus;
      if (typeof ms === 'number' && ms < xpCfg.fastMs) { gained += xpCfg.fastBonus; fast = true; }
      s.xp += gained;
      if (fact && 'id' in fact) clearMiss(family, fact.id);
    } else if (fact && 'id' in fact) {
      recordMiss(family, fact.id, { difficultyBonus: fact.difficultyBonus });
    }
    s.lastPracticedAt = now();
    s.timesSeen += 1;

    const newStage = stageFor(s.xp);
    return { gained, fast, xp: s.xp, oldStage, newStage, stageUp: newStage > oldStage };
  }

  function familyWeight(family) {
    let w = WEIGHT_BASE;
    if (isSleepy(family)) w += WEIGHT_SLEEPY_BONUS;
    w += WEIGHT_LOW_MASTERY_BONUS * (1 - masteryPercent(family));
    return w;
  }

  function pickFamily() {
    if (families.length === 0) return null;
    let total = 0;
    const weights = families.map((f) => { const w = familyWeight(f); total += w; return w; });
    let roll = rng() * total;
    for (let i = 0; i < families.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return families[i];
    }
    return families[families.length - 1];
  }

  /** @returns {{family:*, id?:*, review:boolean}} which family (and, on review, which remembered fact) to practice next */
  function pickNext() {
    if (missed.length && rng() < REVIEW_CHANCE) {
      const m = missed[Math.floor(rng() * missed.length) % missed.length];
      return { family: m.family, id: m.id, review: true };
    }
    return { family: pickFamily(), review: false };
  }

  function getState(family) { return state[family] ? { ...state[family] } : null; }
  function allState() {
    const out = {};
    for (const f of families) out[f] = { ...state[f] };
    return out;
  }

  /** @returns {{state:object, missed:Array}} a serializable snapshot for the game's own save blob */
  function exportState() {
    return { state: allState(), missed: missed.map((m) => ({ ...m })) };
  }

  function reset() {
    for (const f of families) state[f] = blankFamily();
    missed = [];
  }

  return {
    award, pickNext, stageFor,
    masteryPercent, isSleepy,
    getState, allState, exportState, reset,
  };
}

function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Believable wrong numeric answers near `answer` — small off-by-N slips plus
 * a couple bigger jumps, never negative, never equal to the answer, never
 * repeated. Returns ONLY the distractors (not the answer) — combine and
 * shuffle with the real answer yourself.
 * @param {number} answer
 * @param {object} [opts]
 * @param {number} [opts.count=3]
 * @param {number} [opts.spread=10]
 * @returns {number[]} exactly `count` distinct distractors
 */
export function makeDistractors(answer, opts = {}) {
  const count = Number.isFinite(opts.count) && opts.count > 0 ? Math.floor(opts.count) : 3;
  const spread = Number.isFinite(opts.spread) && opts.spread > 0 ? Math.floor(opts.spread) : 10;
  const target = Math.round(Number(answer) || 0);

  const chosen = [];
  const seen = new Set([target]);
  function tryAdd(v) {
    v = Math.round(v);
    if (v < 0 || seen.has(v)) return;
    seen.add(v);
    chosen.push(v);
  }

  const nearOffsets = [1, -1, 2, -2, 3, -3, 5, -5];
  const farOffsets = [10, -10, spread, -spread, Math.round(spread / 2), -Math.round(spread / 2)];
  const candidates = shuffleArray([...nearOffsets, ...farOffsets]).map((o) => target + o);
  for (const c of candidates) {
    if (chosen.length >= count) break;
    tryAdd(c);
  }

  // Safety net: keep reaching outward until we have `count` distinct
  // non-negative distractors, even for a tiny answer (e.g. answer=0) where
  // most near-offsets go negative and get skipped.
  let pad = spread + 1;
  while (chosen.length < count) {
    tryAdd(target + pad);
    tryAdd(Math.max(0, target - pad));
    pad++;
  }

  return shuffleArray(chosen.slice(0, count));
}
