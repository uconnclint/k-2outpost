// settings.js — createSettings(): one small blob of persisted player prefs
// per game (KeyQuest store.js's one-blob shape), with Clint's non-negotiable
// standing decisions as built-in defaults that a game's own `defaults` can
// add to but never override.

const SETTINGS_VERSION = 1;
const PROBE_KEY = '__ce_settings_probe__';

// Clint's standing decisions (2026-07-22, see CONTRACTS.md). Every game
// starts silent; a kid's tap to enable sound persists from then on.
const BUILTIN_DEFAULTS = Object.freeze({
  muted: true,
  quietCelebrations: false,
  reducedMotion: null,
  readAloud: true,
});

function realStorage() {
  try {
    return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null;
  } catch {
    return null;
  }
}

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function probe(storage) {
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, '1');
    const ok = storage.getItem(PROBE_KEY) === '1';
    storage.removeItem(PROBE_KEY);
    return ok;
  } catch {
    return false;
  }
}

function safeParseObject(raw) {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} options
 * @param {string} options.gameId
 * @param {object} [options.defaults={}]  game-specific EXTRA keys only — the
 *   four built-in keys above always win over anything passed here, so a game
 *   can't accidentally (or deliberately) start un-muted
 * @param {Storage} [options.storage]
 * @param {Array<(storage) => (object|null)>} [options.legacyReaders]  each
 *   runs once, only the very first time this game's settings blob is
 *   created, to adopt a kid's existing choice from an old storage location
 *   (e.g. a `muted` flag buried in an old save, or a bare `netrunner_muted`
 *   key). A reader that throws just contributes nothing — never fatal.
 * @returns {{get: Function, set: Function, onChange: Function, reducedMotion: Function}}
 */
export function createSettings(options = {}) {
  const { gameId, defaults: extraDefaults = {}, storage: storageOverride, legacyReaders = [] } = options;

  if (!gameId || typeof gameId !== 'string') {
    throw new Error('createSettings: gameId (kebab-case string) is required');
  }

  const key = `${gameId}.settings.v${SETTINGS_VERSION}`;
  const candidateStorage = storageOverride !== undefined ? storageOverride : realStorage();
  const persistent = probe(candidateStorage);
  const storage = persistent ? candidateStorage : makeMemoryStorage();

  // Built-ins spread LAST so they always win over a game's own `defaults`;
  // any OTHER game-specific keys in `defaults` pass through untouched.
  const seedDefaults = { ...extraDefaults, ...BUILTIN_DEFAULTS };

  let state;
  // Post-probe reads still guard: managed profiles can revoke storage mid-session, and a
  // throwing read must degrade to "no saved settings", never crash startup.
  let existingRaw = null;
  try { existingRaw = storage.getItem(key); } catch { /* revoked after probe */ }
  const existing = safeParseObject(existingRaw);
  if (existing) {
    // Anything already chosen (including a kid's own un-mute) always wins;
    // seedDefaults only fills in keys this blob doesn't have yet.
    state = { ...seedDefaults, ...existing };
  } else {
    let adopted = {};
    for (const read of legacyReaders) {
      try {
        const partial = typeof read === 'function' ? read(storage) : null;
        if (partial && typeof partial === 'object') adopted = { ...adopted, ...partial };
      } catch { /* a broken legacy reader just contributes nothing */ }
    }
    state = { ...seedDefaults, ...adopted };
    persistNow();
  }

  function persistNow() {
    try { storage.setItem(key, JSON.stringify(state)); } catch { /* storage full/blocked — state stays live in memory this session */ }
  }

  const listeners = new Set();

  function notify(k, value) {
    const snapshot = { ...state };
    for (const fn of [...listeners]) {
      try { fn(k, value, snapshot); } catch { /* a bad listener must not break the others */ }
    }
  }

  return {
    /** @param {string} k @returns {*} */
    get(k) { return state[k]; },

    /** @param {string} k @param {*} value  persists immediately (not debounced) */
    set(k, value) {
      if (state[k] === value) return;
      state[k] = value;
      persistNow();
      notify(k, value);
    },

    /**
     * @param {(key:string, value:*, all:object) => void} fn
     * @returns {() => void} unsubscribe
     */
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Drops every onChange listener — the settings half of a context teardown. Idempotent. */
    destroy() {
      listeners.clear();
    },

    /**
     * Explicit setting if non-null, else the live `prefers-reduced-motion`
     * media query, else false. Re-evaluated every call — if the OS setting
     * changes mid-session (and no explicit choice was made), this reflects it.
     * @returns {boolean}
     */
    reducedMotion() {
      const explicit = state.reducedMotion;
      if (explicit !== null && explicit !== undefined) return !!explicit;
      try {
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
          return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }
      } catch { /* matchMedia unavailable — fall through */ }
      return false;
    },
  };
}
