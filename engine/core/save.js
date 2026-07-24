// save.js — createSave(): one versioned JSON blob per game, probe-guarded
// against locked-down storage, debounced writes, legacy-key migration.
// Adapted from pinball's SaveAdapter (probe + in-memory fallback), Harvest's
// SaveManager (debounce/flush/slots/onFail) + GameState (v1->v2 migrate
// pattern), and critter-codex's SaveManager (probe).
//
// Storage is never touched at module load — only lazily, inside
// createSave() — and every real read/write is try/catch-guarded, so this
// file importing cleanly (and behaving safely on a locked-down Chromebook)
// never depends on storage actually working (rule: errors never reach kids).

const DEFAULT_DEBOUNCE_MS = 300;
const PROBE_KEY = '__ce_save_probe__';

function realStorage() {
  try {
    // Some locked-down managed-Chrome profiles throw merely touching
    // window.localStorage, not just on read/write — guard the access itself.
    return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A Map-backed Storage-shaped fallback for when real storage is unavailable. */
function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// Prove we can actually write+read+delete, not just reference the object —
// some managed profiles expose `localStorage` but throw the moment it's used.
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

// The probe proves storage worked at construction time, but managed profiles can revoke it
// mid-session (policy refresh, private-mode purge) — a later read throwing must degrade to
// "no data", never crash a load.
function readItem(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function safeParse(raw) {
  if (raw == null) return { ok: false };
  try {
    const value = JSON.parse(raw);
    if (value === null || value === undefined) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function isMergeable(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Structural clone so callers' `defaults` object is never mutated by
// reference — reset() and every fresh load must get an independent copy.
function cloneDefaults(defaults) {
  try {
    return structuredClone(defaults);
  } catch {
    try { return JSON.parse(JSON.stringify(defaults)); } catch { return { ...defaults }; }
  }
}

function warn(...args) {
  try { console.warn('[save]', ...args); } catch { /* no console in this sandbox */ }
}

/**
 * @param {object} options
 * @param {string} options.gameId          required, kebab-case
 * @param {number} [options.version=1]     schema version -> key suffix
 * @param {object} [options.defaults={}]   merged under any loaded data
 * @param {Storage} [options.storage]      injectable; probed real localStorage by default
 * @param {string[]} [options.legacyKeys]  old storage keys to adopt-and-migrate from,
 *   checked in order; the FIRST key with usable data wins. The legacy key
 *   itself is left untouched so a rollback to the old engine still finds it.
 * @param {(data:*, fromKey:string) => object} [options.migrate]  transforms
 *   whatever was parsed from a legacy key into this version's shape
 * @param {number} [options.slots]         >0 enables useSlot(i) classroom slots
 * @param {number} [options.debounceMs=300]
 * @param {'local'|'none'} [options.mode]  'none' = in-memory only, always —
 *   a legitimate choice for server-authoritative games, not an error state
 * @param {(err:*) => void} [options.onFail]  fires once, the first time a
 *   write actually fails (storage probed OK but later broke, e.g. quota) —
 *   wire it to a one-time gentle toast (Harvest's "B8" pattern)
 * @returns {object}
 */
export function createSave(options = {}) {
  const {
    gameId,
    version = 1,
    defaults = {},
    storage: storageOverride,
    legacyKeys = [],
    migrate,
    slots,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    mode,
    onFail: initialOnFail = null,
  } = options;

  if (!gameId || typeof gameId !== 'string') {
    throw new Error('createSave: gameId (kebab-case string) is required');
  }

  const useMemoryOnly = mode === 'none';
  const candidateStorage = useMemoryOnly ? null : (storageOverride !== undefined ? storageOverride : realStorage());
  const persistent = !useMemoryOnly && probe(candidateStorage);
  const storage = persistent ? candidateStorage : makeMemoryStorage();

  const slotCount = Number.isInteger(slots) && slots > 0 ? slots : 0;
  let currentSlot = 0;
  let onFailFn = typeof initialOnFail === 'function' ? initialOnFail : null;
  let warnedFail = false;

  function primaryKey(slotIndex = currentSlot) {
    const base = `${gameId}.save.v${version}`;
    return slotCount > 0 ? `${base}.slot${slotIndex}` : base;
  }

  function tryMigrate(rawValue, fromKey) {
    if (typeof migrate !== 'function') return rawValue;
    try {
      return migrate(rawValue, fromKey);
    } catch (err) {
      warn('migrate() threw for', fromKey, err);
      return null;
    }
  }

  function writeNowTo(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      if (!warnedFail) {
        warnedFail = true;
        try { onFailFn && onFailFn(err); } catch { /* onFail itself must never throw back out */ }
      }
      return false;
    }
  }

  // The contract's load() order: primary key -> each legacyKeys entry in
  // turn (first one with usable data, after migrate(), wins).
  function loadFor(slotIndex) {
    const key = primaryKey(slotIndex);
    const primary = safeParse(readItem(storage, key));
    if (primary.ok && isMergeable(primary.value)) {
      return { ...cloneDefaults(defaults), ...primary.value };
    }

    // Slotted saves skip legacy-key adoption: a pre-slots save can't know
    // which slot it belongs to, and slots are opt-in for new games.
    if (slotCount === 0) {
      for (const legacyKey of legacyKeys) {
        const legacy = safeParse(readItem(storage, legacyKey));
        if (!legacy.ok) continue;
        const migrated = tryMigrate(legacy.value, legacyKey);
        if (isMergeable(migrated)) {
          const merged = { ...cloneDefaults(defaults), ...migrated };
          writeNowTo(key, merged); // adopt into the primary key now...
          // ...but the legacy key is deliberately left in place (Clint's
          // call): a rollback to the old engine must still find its save.
          return merged;
        }
        // This legacy key existed but didn't pan out (corrupt / migrate()
        // threw) — keep trying the rest before giving up on legacy data.
      }
    }

    return cloneDefaults(defaults);
  }

  let state = loadFor(currentSlot);
  let timer = null;

  function scheduleSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; writeNowTo(primaryKey(), state); }, debounceMs);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    writeNowTo(primaryKey(), state);
  }

  // Auto-wired so a kid closing the tab (or the OS switching apps on an
  // iPad) doesn't lose the last few debounced seconds of play. Handlers are
  // named + kept so destroy() can unhook them (a scene-restarting game must
  // not accumulate one flush listener per restart).
  let removeAutoFlush = () => {};
  (function wireAutoFlush() {
    try {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
      const onPageHide = () => flush();
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') flush();
      };
      window.addEventListener('pagehide', onPageHide);
      const hasDoc = typeof document !== 'undefined' && typeof document.addEventListener === 'function';
      if (hasDoc) document.addEventListener('visibilitychange', onVisibility);
      removeAutoFlush = () => {
        try { window.removeEventListener('pagehide', onPageHide); } catch { /* ignore */ }
        if (hasDoc) { try { document.removeEventListener('visibilitychange', onVisibility); } catch { /* ignore */ } }
      };
    } catch { /* listener wiring failed — flush() is still callable manually */ }
  })();

  const api = {
    get persistent() { return persistent; },
    get onFail() { return onFailFn; },
    set onFail(fn) { onFailFn = typeof fn === 'function' ? fn : null; },

    /** @returns {object} the live, mutable state object — mutate it directly, then call save()/patch() */
    get() { return state; },

    /** @param {object} partial  shallow-merged into state; schedules a debounced save */
    patch(partial) {
      if (partial && typeof partial === 'object') Object.assign(state, partial);
      scheduleSave();
      return state;
    },

    /** Schedule a debounced write of the current state (for direct get()-mutation callers). */
    save() { scheduleSave(); },

    /** Write immediately, synchronously, bypassing the debounce. */
    flush,

    /** Final flush, then teardown: clears the debounce timer and the page-lifecycle listeners. Idempotent. */
    destroy() {
      flush();
      removeAutoFlush();
      removeAutoFlush = () => {};
    },

    /** Reset to a fresh copy of `defaults` and persist immediately. */
    reset() {
      if (timer) { clearTimeout(timer); timer = null; }
      state = cloneDefaults(defaults);
      writeNowTo(primaryKey(), state);
      return state;
    },
  };

  if (slotCount > 0) {
    Object.defineProperty(api, 'slot', { get: () => currentSlot, enumerable: true });
    api.slotCount = slotCount;

    /** @param {number} i @returns {boolean} whether slot i has any saved data */
    api.hasSlot = function hasSlot(i) {
      if (!Number.isInteger(i) || i < 0 || i >= slotCount) return false;
      return safeParse(readItem(storage, primaryKey(i))).ok;
    };

    /** @param {number} i @returns {object|null} slot i's raw data, WITHOUT switching to it (for title-screen slot signs) */
    api.peekSlot = function peekSlot(i) {
      if (!Number.isInteger(i) || i < 0 || i >= slotCount) return null;
      const parsed = safeParse(readItem(storage, primaryKey(i)));
      return parsed.ok && isMergeable(parsed.value) ? { ...parsed.value } : null;
    };

    /** @param {number} i  flushes the outgoing slot, then loads slot i as the live state */
    api.useSlot = function useSlot(i) {
      if (!Number.isInteger(i) || i < 0 || i >= slotCount) {
        throw new Error(`createSave: slot ${i} is out of range [0, ${slotCount})`);
      }
      if (i === currentSlot) return state;
      flush(); // don't lose pending writes for the outgoing slot
      currentSlot = i;
      state = loadFor(currentSlot);
      return state;
    };
  }

  return api;
}
