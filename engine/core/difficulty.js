// difficulty.js — createDifficulty(): an explicit tier dial (hoop heroes'
// "one knob, swapped everywhere" GRADES concept — renderers only ever read
// config fields, never tier ids) plus an optional adaptive rolling-accuracy
// suggester (slime's DifficultyEngine, generalized past one game's tiers).

const DEFAULT_ADAPTIVE = { windowSize: 5, up: 0.85, down: 0.55 };

// `tiers` may be an ordered array of ids, OR an {id: config} map (hoop
// heroes' GRADES shape) — either way `order` is the dial order, lowest first.
function normalizeTiers(tiers) {
  if (Array.isArray(tiers)) return { order: tiers.slice(), configs: null };
  if (tiers && typeof tiers === 'object') return { order: Object.keys(tiers), configs: tiers };
  return { order: [], configs: null };
}

/**
 * @param {object} options
 * @param {Array|object} options.tiers  ordered tier ids, or an {id: config} map
 * @param {*} [options.initial]  starting tier id; defaults to the first tier
 * @param {object} [options.save]  optional createSave() instance — when
 *   given, the current tier persists at save.get().difficulty.tier
 * @returns {{get: Function, set: Function, getConfig: Function, tiers: Array, adaptive: Function}}
 */
export function createDifficulty(options = {}) {
  const { tiers, initial, save } = options;
  const { order, configs } = normalizeTiers(tiers);

  function validTier(t) { return order.length === 0 ? t !== undefined : order.includes(t); }

  function loadPersisted() {
    if (!save || typeof save.get !== 'function') return undefined;
    const d = save.get().difficulty;
    return d && validTier(d.tier) ? d.tier : undefined;
  }

  let current = loadPersisted();
  if (current === undefined) current = validTier(initial) ? initial : order[0];

  function persist() {
    if (!save || typeof save.save !== 'function') return;
    const root = save.get();
    const prior = root.difficulty && typeof root.difficulty === 'object' ? root.difficulty : {};
    root.difficulty = { ...prior, tier: current };
    save.save();
  }

  /** @returns {*} the current tier id */
  function get() { return current; }

  /** @returns {*} the config blob for the current tier, when `tiers` was given as a map — else null */
  function getConfig() { return configs ? (configs[current] ?? null) : null; }

  /** @param {*} tier @returns {boolean} whether it was applied (false = not a known tier, ignored) */
  function set(tier) {
    if (!validTier(tier)) return false;
    if (tier === current) return true;
    current = tier;
    persist();
    return true;
  }

  function indexOf(tier) { return order.indexOf(tier); }

  /**
   * A rolling-accuracy suggester bound to this dial. Purely advisory:
   * suggestion() never calls set() itself — the game decides whether/when to
   * act on it. When `tiers` gives an ordered dial, suggestions are clamped
   * at the ceiling/floor (never suggests 'up' with nowhere higher to go).
   * @param {object} [cfg]
   * @param {number} [cfg.windowSize=5]  how many recent results to roll over
   * @param {number} [cfg.up=0.85]       rolling accuracy at/above this -> 'up'
   * @param {number} [cfg.down=0.55]     rolling accuracy at/below this -> 'down'
   * @returns {{record: Function, suggestion: Function, reset: Function}}
   */
  function adaptive(cfg = {}) {
    const windowSize = Number(cfg.windowSize) > 0 ? Number(cfg.windowSize) : DEFAULT_ADAPTIVE.windowSize;
    const up = typeof cfg.up === 'number' ? cfg.up : DEFAULT_ADAPTIVE.up;
    const down = typeof cfg.down === 'number' ? cfg.down : DEFAULT_ADAPTIVE.down;
    let results = [];

    /** @param {boolean} correct */
    function record(correct) {
      results.push(!!correct);
      if (results.length > windowSize) results.shift();
    }

    /** @returns {'up'|'down'|null} null = not enough data yet, or hold steady */
    function suggestion() {
      if (results.length < windowSize) return null;
      const acc = results.filter(Boolean).length / results.length;
      const idx = indexOf(current);
      if (acc >= up) {
        if (order.length && idx >= 0 && idx >= order.length - 1) return null; // already at the ceiling
        return 'up';
      }
      if (acc <= down) {
        if (order.length && idx === 0) return null; // already at the floor
        return 'down';
      }
      return null;
    }

    function reset() { results = []; }

    return { record, suggestion, reset };
  }

  return { get, set, getConfig, tiers: order, adaptive };
}
