// naming.js — createNamer(): COPPA-safe word-picker names (pinball's
// naming.js, distilled to a headless service — no DOM here; dom/ui.js is
// where a game renders tap-tiles). A name is always [adjective] + [noun]
// from a fixed bank, so nothing a kid "writes" can be inappropriate or
// identifying — no free text, ever.

// A small default bank so every game works out of the box. Swap in a
// game-flavored `adjectives`/`nouns` bank for theming.
export const DEFAULT_ADJECTIVES = [
  'Silly', 'Brave', 'Zippy', 'Happy', 'Sparkly', 'Mighty', 'Wobbly', 'Cosmic',
  'Fuzzy', 'Sunny', 'Bouncy', 'Clever', 'Speedy', 'Gentle', 'Jolly', 'Plucky',
  'Radiant', 'Sneaky', 'Squishy', 'Turbo', 'Twinkly', 'Whimsical', 'Zany', 'Breezy',
  'Cheerful', 'Daring', 'Feisty', 'Giggly', 'Lucky', 'Nifty',
];
export const DEFAULT_NOUNS = [
  'Fox', 'Otter', 'Comet', 'Panda', 'Rocket', 'Dragon', 'Penguin', 'Muffin',
  'Wizard', 'Robot', 'Tiger', 'Narwhal', 'Pickle', 'Falcon', 'Dolphin', 'Cactus',
  'Meteor', 'Koala', 'Yeti', 'Biscuit', 'Unicorn', 'Beetle', 'Walrus', 'Nugget',
  'Pretzel', 'Gecko', 'Comet', 'Sprout', 'Marble', 'Cloud',
];

/**
 * @param {object} [options]
 * @param {string[]} [options.adjectives]  defaults to DEFAULT_ADJECTIVES
 * @param {string[]} [options.nouns]       defaults to DEFAULT_NOUNS
 * @param {() => number} [options.rng]     defaults to Math.random; pass a
 *   mulberry32() generator (see random.js) for deterministic tests/replays
 * @returns {{next: () => string, list: (n:number) => string[]}}
 */
export function createNamer(options = {}) {
  const { adjectives, nouns, rng = Math.random } = options;
  const adjBank = Array.isArray(adjectives) && adjectives.length ? adjectives : DEFAULT_ADJECTIVES;
  const nounBank = Array.isArray(nouns) && nouns.length ? nouns : DEFAULT_NOUNS;

  function pickOne(bank) { return bank[Math.floor(rng() * bank.length) % bank.length]; }

  /** @returns {string} e.g. "Silly Fox" */
  function next() {
    return `${pickOne(adjBank)} ${pickOne(nounBank)}`;
  }

  /**
   * `n` names, avoiding duplicates within the batch where the bank is large
   * enough to (a "pick your name" screen showing a few options shouldn't
   * repeat itself).
   * @param {number} n
   * @returns {string[]}
   */
  function list(n) {
    const count = Math.max(0, n | 0);
    const combos = adjBank.length * nounBank.length;
    const out = [];
    const seen = new Set();
    let guard = 0;
    while (out.length < count && guard < count * 20 + 20) {
      guard++;
      const name = next();
      if (seen.has(name) && seen.size < combos) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }

  return { next, list };
}
