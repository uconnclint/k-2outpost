// progress.js — createProgress(): XP/levels, badge/sticker booleans, and
// named counters. Content-agnostic (scratchy's game/progress.js for the
// debounced-persist + anti-farming-cap + defensive-load shape; voxel type's
// profile.js for the iterative level curve). Persists by piggybacking on a
// game's existing `save` instance (save.get().progress) rather than owning a
// second storage key — "one versioned JSON blob per game" stays true.

const DEFAULT_MAX_AWARDS_PER_SESSION = 40; // scratchy's anti-farming cap

// Gently super-linear default curve (scratchy's numbers): completing level n
// costs 100*n XP (L1->2 = 100, L2->3 = 200, ...). Games with their own flavor
// curve pass a function instead: xpPerLevel(level) => xp needed to clear it.
function defaultXpPerLevel(level) {
  return 100 * Math.max(1, level);
}

function xpNeeded(level, xpPerLevel) {
  const raw = typeof xpPerLevel === 'function' ? xpPerLevel(level) : Number(xpPerLevel);
  const n = Math.round(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Walks up from level 1 rather than inverting a closed-form sum, so ANY
// xpPerLevel shape (constant, linear, custom curve) works uniformly.
function levelForXP(xp, xpPerLevel) {
  let level = 1;
  let remaining = Math.max(0, xp);
  let guard = 0;
  while (remaining >= xpNeeded(level, xpPerLevel) && guard < 100000) {
    remaining -= xpNeeded(level, xpPerLevel);
    level++;
    guard++;
  }
  return { level, into: remaining, needed: xpNeeded(level, xpPerLevel) };
}

function freshProgressState() {
  return { xp: 0, badges: {}, counters: {} };
}

// Defensive coercion for whatever is sitting at save.get().progress —
// corrupt/missing fields get replaced, never thrown on (scratchy's load()).
function ensureState(save) {
  const root = save.get();
  const p = root.progress;
  if (!p || typeof p !== 'object') { root.progress = freshProgressState(); return root.progress; }
  if (typeof p.xp !== 'number' || !isFinite(p.xp) || p.xp < 0) p.xp = 0;
  if (!p.badges || typeof p.badges !== 'object') p.badges = {};
  if (!p.counters || typeof p.counters !== 'object') p.counters = {};
  return p;
}

function safeCall(fn, arg) {
  try { fn(arg); } catch { /* a bad listener must not break progress bookkeeping */ }
}

/**
 * @param {object} options
 * @param {object} options.save  a createSave() instance — progress persists
 *   through it (save.get().progress), inheriting its debounce/flush/reset.
 * @param {number|((level:number)=>number)} [options.xpPerLevel]
 * @param {Array<string|{id:string}>} [options.badges]  the game's full badge
 *   manifest (ids, or {id,...meta} descriptors), used by allBadges(); plain
 *   unlock(id) works fine without declaring a manifest at all.
 * @param {number} [options.maxAwardsPerSession=40]  anti-farming cap, per reason string
 * @returns {object}
 */
export function createProgress(options = {}) {
  const { save, xpPerLevel = defaultXpPerLevel, badges = [], maxAwardsPerSession = DEFAULT_MAX_AWARDS_PER_SESSION } = options;

  if (!save || typeof save.get !== 'function' || typeof save.save !== 'function') {
    throw new Error('createProgress: a createSave() instance is required');
  }

  ensureState(save);
  const badgeDefs = Array.isArray(badges) ? badges : [];
  const sessionAwardCounts = Object.create(null); // NOT persisted, by design (scratchy)
  const unlockListeners = new Set();
  const levelUpListeners = new Set();

  function state() { return ensureState(save); }
  function persist() { save.save(); }

  /** @returns {{level:number, xp:number, into:number, needed:number, pct:number}} */
  function level() {
    const p = state();
    const info = levelForXP(p.xp, xpPerLevel);
    const pct = info.needed > 0 ? Math.max(0, Math.min(100, Math.round((info.into / info.needed) * 100))) : 100;
    return { level: info.level, xp: p.xp, into: info.into, needed: info.needed, pct };
  }

  /** Uncapped XP primitive — addXP always applies. Use award() for routine per-action grants. */
  function addXP(amount, reason) {
    const delta = Math.round(Number(amount) || 0);
    const p = state();
    const before = levelForXP(p.xp, xpPerLevel).level;
    if (delta) {
      p.xp = Math.max(0, p.xp + delta);
      persist();
    }
    const after = levelForXP(p.xp, xpPerLevel);
    const leveledUp = after.level > before;
    if (leveledUp) {
      for (const fn of [...levelUpListeners]) safeCall(fn, { level: after.level, xp: p.xp, reason: reason || null });
    }
    return { xp: p.xp, level: after.level, leveledUp, reason: reason || null };
  }

  /** Session-capped XP grant (scratchy's 40-per-reason anti-farming cap). */
  function award(reason, amount) {
    const key = reason || 'default';
    const n = sessionAwardCounts[key] || 0;
    if (n >= maxAwardsPerSession) {
      const info = level();
      return { xp: info.xp, level: info.level, leveledUp: false, reason: key, capped: true };
    }
    sessionAwardCounts[key] = n + 1;
    return { ...addXP(amount, key), capped: false };
  }

  /** @param {string} id @returns {boolean} true if this call newly unlocked it (idempotent) */
  function unlock(id) {
    if (!id) return false;
    const p = state();
    if (p.badges[id]) return false;
    p.badges[id] = true;
    persist();
    for (const fn of [...unlockListeners]) safeCall(fn, id);
    return true;
  }

  function hasUnlocked(id) { return !!state().badges[id]; }
  function unlockedList() {
    const b = state().badges;
    return Object.keys(b).filter((id) => b[id]);
  }
  /** Merges the declared badge manifest with current unlock state — handy for a "badge case" screen. */
  function allBadges() {
    return badgeDefs.map((def) => {
      const id = typeof def === 'string' ? def : def.id;
      const meta = typeof def === 'string' ? {} : def;
      return { ...meta, id, unlocked: hasUnlocked(id) };
    });
  }

  function bump(name, amount = 1) {
    if (!name) return 0;
    const p = state();
    const v = (Number(p.counters[name]) || 0) + (Number(amount) || 0);
    p.counters[name] = v;
    persist();
    return v;
  }
  function count(name) { return Number(state().counters[name]) || 0; }
  function setMax(name, value) {
    if (!name) return 0;
    const p = state();
    const v = Number(value) || 0;
    if (v > (Number(p.counters[name]) || 0)) { p.counters[name] = v; persist(); }
    return Number(p.counters[name]) || 0;
  }

  /** @param {(id:string) => void} fn @returns {() => void} unsubscribe */
  function onUnlock(fn) { if (typeof fn === 'function') unlockListeners.add(fn); return () => unlockListeners.delete(fn); }
  /** @param {(info:{level:number,xp:number,reason:string|null}) => void} fn @returns {() => void} unsubscribe */
  function onLevelUp(fn) { if (typeof fn === 'function') levelUpListeners.add(fn); return () => levelUpListeners.delete(fn); }

  function reset() {
    const root = save.get();
    root.progress = freshProgressState();
    for (const k in sessionAwardCounts) delete sessionAwardCounts[k];
    persist();
    return root.progress;
  }

  return {
    addXP, award, level,
    unlock, hasUnlocked, unlockedList, allBadges,
    bump, count, setMax,
    onUnlock, onLevelUp,
    state, reset,
  };
}
