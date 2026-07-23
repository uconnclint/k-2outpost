// random.js — deterministic, testable randomness (hoop heroes' rng.js,
// generalized). A seeded mulberry32 generator plus small pick/shuffle/randInt
// helpers, so game code never reaches for the unseedable Math.random()
// directly and every roll can be reproduced in a test.

/**
 * mulberry32 PRNG. Fast, tiny, good-enough statistical quality for games —
 * NOT for anything security-sensitive (see codes.js for that).
 * @param {number} seed  any 32-bit value (coerced with `>>> 0`)
 * @returns {() => number} a function returning a float in [0, 1) on each call
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns any string into a stable 32-bit seed (FNV-1a), so a run can be seeded
 * from something human-meaningful (a share code, a gameId, today's date).
 * @param {string} s
 * @returns {number} unsigned 32-bit integer
 */
export function seedFromString(s) {
  let h = 2166136261 >>> 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Pick one random element from an array.
 * @param {() => number} rng  a mulberry32()-shaped generator
 * @param {Array} arr
 * @returns {*} undefined for an empty/missing array
 */
export function pick(rng, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * Fisher-Yates shuffle. Returns a NEW array; never mutates the input.
 * @param {() => number} rng
 * @param {Array} arr
 * @returns {Array}
 */
export function shuffle(rng, arr) {
  const out = Array.isArray(arr) ? arr.slice() : [];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Random integer, inclusive on both ends (randInt(rng, 1, 6) is a die roll).
 * Order-independent — randInt(rng, 6, 1) works the same as (rng, 1, 6).
 * @param {() => number} rng
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function randInt(rng, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + Math.floor(rng() * (hi - lo + 1));
}
