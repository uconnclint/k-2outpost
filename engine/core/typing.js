// typing.js — pure typing-pedagogy helpers shared by every typing game: WPM/
// accuracy/star math (newtyping's utils.js), the key-pool/normalization table
// (Key Runner's keys.js), a KeyQuest word-bank accessor, and a typing engine
// that implements BOTH house philosophies (voxel type's strict-stop and
// wonderglade's never-block letter-lock) behind one interface, so a game
// picks its pedagogy with one constructor option, not a rewrite.

/**
 * @param {number} correctKeystrokes
 * @param {number} seconds  elapsed time
 * @returns {number} words per minute (5 keystrokes = 1 word); 0 under 1s elapsed
 */
export function wpm(correctKeystrokes, seconds) {
  if (!(seconds >= 1)) return 0;
  const words = correctKeystrokes / 5;
  const minutes = seconds / 60;
  return Math.round(words / minutes);
}

/**
 * @param {number} correct
 * @param {number} total
 * @returns {number} 0-100; defaults to 100 when nothing has been typed yet
 *   (an empty run isn't a failed run)
 */
export function accuracy(correct, total) {
  if (!total) return 100;
  return Math.round((correct / total) * 100);
}

// Tier -> the WPM bar for 2/3 stars. Accuracy bars stay FIXED across tiers
// (quality expectations don't drop with grade) — only the speed bar scales.
// Unknown/omitted tiers fall back to DEFAULT_BAR (newtyping's original numbers).
const TIER_WPM_BARS = {
  1: { star2: 8, star3: 15 },
  2: { star2: 12, star3: 20 },
  3: { star2: 15, star3: 25 },
  4: { star2: 18, star3: 30 },
};
const DEFAULT_BAR = { star2: 15, star3: 20 };

/**
 * @param {number} wpmValue
 * @param {number} accuracyValue  0-100
 * @param {number|string} [tier]  1-4; unrecognized/omitted -> DEFAULT_BAR
 * @returns {1|2|3}
 */
export function starRating(wpmValue, accuracyValue, tier) {
  const bar = TIER_WPM_BARS[tier] || DEFAULT_BAR;
  if (accuracyValue >= 95 && wpmValue >= bar.star3) return 3;
  if (accuracyValue >= 80 && wpmValue >= bar.star2) return 2;
  return 1;
}

// ---------------------------------------------------------------- key pools
export const KEY_POOLS = {
  home: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  top: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  bottom: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
};
KEY_POOLS.mixed = [...new Set([...KEY_POOLS.home, ...KEY_POOLS.top, ...KEY_POOLS.bottom])];

const SHIFT_MAP = { ':': ';', '<': ',', '>': '.', '?': '/' };

/** @param {string} k @returns {string} lowercased single char, shifted punctuation mapped back to its base key, else '' */
export function normalizeKey(k) {
  if (!k) return '';
  if (SHIFT_MAP[k]) return SHIFT_MAP[k];
  return k.length === 1 ? k.toLowerCase() : '';
}

/** @param {string} k @returns {boolean} whether k is one of the 30 home/top/bottom letter keys */
export function isAllowedChar(k) { return KEY_POOLS.mixed.includes(k); }

export const IGNORE_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Enter', 'Backspace',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Insert', 'Delete', 'ContextMenu', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

// ---------------------------------------------------------------- word bank
/**
 * Accessor for the KeyQuest word-bank schema: { grade, roundSeconds, words[],
 * themes[][] }. `themes` are word-sequences for themed/sentence rounds.
 * @param {object} json  a parsed words-*.json
 * @returns {object}
 */
export function wordBank(json) {
  const data = json && typeof json === 'object' ? json : {};
  const words = Array.isArray(data.words) ? data.words.slice() : [];
  const themes = Array.isArray(data.themes) ? data.themes : [];
  return {
    grade: data.grade ?? null,
    roundSeconds: typeof data.roundSeconds === 'number' ? data.roundSeconds : 60,
    words,
    wordCount: words.length,
    themeCount: themes.length,
    /** @param {() => number} [rng] @returns {string|null} */
    randomWord(rng = Math.random) {
      return words.length ? words[Math.floor(rng() * words.length) % words.length] : null;
    },
    /** @param {number} n @param {() => number} [rng] @returns {string[]} n words, no repeats within the sample */
    sample(n, rng = Math.random) {
      const count = Math.max(0, Math.min(words.length, n | 0));
      const pool = words.slice();
      const out = [];
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(rng() * pool.length);
        out.push(pool.splice(idx, 1)[0]);
      }
      return out;
    },
    /** @param {number} i @returns {string[]} a copy of themes[i], or [] if out of range */
    theme(i) {
      return Array.isArray(themes[i]) ? themes[i].slice() : [];
    },
  };
}

// ---------------------------------------------------------------- typing engine
/**
 * One interface, two house philosophies:
 *  - 'strict-stop' (voxel type): a wrong key stops the caret until backspace
 *    clears it; confirmed-correct characters can never be deleted. Accuracy
 *    is never optional — a documented per-game choice, not the default.
 *  - 'never-block' (wonderglade, the default): a wrong key just doesn't
 *    advance the caret — no lockout, no buffer; the very next keystroke gets
 *    a fresh, unpenalized chance. "Never punish a miss."
 *
 * @param {object} [options]
 * @param {'strict-stop'|'never-block'} [options.mode='never-block']
 * @param {string} [options.passage='']
 * @param {() => number} [options.now]  defaults to performance.now()/Date.now()
 * @param {(event:string) => void} [options.onEvent]  'correct'|'error'|'fix'|'finish'
 * @returns {object}
 */
export function createTypingEngine(options = {}) {
  const mode = options.mode === 'strict-stop' ? 'strict-stop' : 'never-block';
  const clock = typeof options.now === 'function'
    ? options.now
    : () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let passage = typeof options.passage === 'string' ? options.passage : '';
  let onEventFn = typeof options.onEvent === 'function' ? options.onEvent : () => {};

  let pos = 0;
  let errorBuffer = '';
  let started = false; // tracked separately from startTime — a legit start(0) must not read as "not started"
  let startTime = 0;
  let correctCount = 0;
  let errorCount = 0;
  let combo = 0;
  let maxCombo = 0;
  const keyErrors = {};
  let finished = false;
  let finishTime = 0;

  function fireCorrectKey(t) {
    pos++; correctCount++; combo++;
    if (combo > maxCombo) maxCombo = combo;
    if (pos >= passage.length) {
      finished = true; finishTime = t;
      onEventFn('finish');
    } else {
      onEventFn('correct');
    }
  }

  function keyStrict(ch, t) {
    if (ch === '\b') return backspace(t);
    if (ch.length !== 1) return false;

    if (errorBuffer.length) {
      // must clear the mistake first — extra wrong keys pile on (capped at 4)
      if (errorBuffer.length < 4) errorBuffer += ch;
      errorCount++;
      onEventFn('error');
      return true;
    }
    const expected = passage[pos] || '';
    if (ch === expected) {
      fireCorrectKey(t);
    } else {
      errorBuffer = ch;
      errorCount++;
      combo = 0;
      keyErrors[expected] = (keyErrors[expected] || 0) + 1;
      onEventFn('error');
    }
    return true;
  }

  function keyNeverBlock(ch, t) {
    if (ch === '\b') return backspace(t);
    if (ch.length !== 1) return false;

    const expected = passage[pos] || '';
    if (ch === expected) {
      fireCorrectKey(t);
    } else {
      errorCount++;
      combo = 0;
      keyErrors[expected] = (keyErrors[expected] || 0) + 1;
      onEventFn('error');
      // no error buffer, no lockout — the cursor just waits for the next try
    }
    return true;
  }

  /**
   * @param {string} ch  a single character, or '\b' for backspace
   * @param {number} [t]
   * @returns {boolean} whether state changed
   */
  function key(ch, t = clock()) {
    if (finished || !started || t < startTime) return false;
    return mode === 'strict-stop' ? keyStrict(ch, t) : keyNeverBlock(ch, t);
  }

  /** @param {number} [t] @returns {boolean} whether state changed */
  function backspace(t = clock()) {
    if (finished || !started) return false;
    if (mode === 'strict-stop') {
      if (!errorBuffer.length) return false; // confirmed-correct chars can't be deleted
      errorBuffer = errorBuffer.slice(0, -1);
      onEventFn('fix');
      return true;
    }
    // never-block: a forgiving one-character undo (there's no error buffer —
    // wrong keys never advanced the caret in the first place)
    if (pos <= 0) return false;
    pos--;
    onEventFn('fix');
    return true;
  }

  return {
    get mode() { return mode; },
    get passage() { return passage; },
    /** @returns {string} the next character the passage expects */
    get expected() { return passage[pos] || ''; },
    /** @returns {object} a snapshot of the engine's state */
    get state() {
      return {
        pos, errorBuffer, correct: correctCount, errors: errorCount,
        combo, maxCombo, finished, startTime, finishTime, keyErrors: { ...keyErrors },
      };
    },
    get onEvent() { return onEventFn; },
    set onEvent(fn) { onEventFn = typeof fn === 'function' ? fn : () => {}; },

    /** @param {number} [t] */
    start(t = clock()) {
      started = true;
      startTime = t;
      finished = false;
      finishTime = 0;
    },

    /** Restarts the run in place, optionally with a new passage. @param {string} [newPassage] */
    reset(newPassage) {
      if (typeof newPassage === 'string') passage = newPassage;
      started = false;
      pos = 0; errorBuffer = ''; startTime = 0; correctCount = 0; errorCount = 0;
      combo = 0; maxCombo = 0; finished = false; finishTime = 0;
      for (const k in keyErrors) delete keyErrors[k];
    },

    key,
    backspace,

    /** @param {number} [t] @returns {number} */
    wpm(t = clock()) {
      const end = finished ? finishTime : t;
      const seconds = (end - startTime) / 1000;
      if (!(seconds >= 1)) return 0;
      return Math.round((correctCount / 5) / (seconds / 60));
    },

    /** @returns {number} 0-100 */
    accuracy() {
      const total = correctCount + errorCount;
      return total ? Math.round((correctCount / total) * 100) : 100;
    },
  };
}
