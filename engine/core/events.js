// events.js — createEmitter(): the small pub/sub bus other core modules (and
// game code) use for cross-cutting notifications. Adapted from Space
// Builders' state.js Emitter, plus a '*' wildcard and an off() escape hatch.

/**
 * @returns {{on: Function, off: Function, emit: Function}}
 */
export function createEmitter() {
  const listeners = new Map(); // type -> Set<fn>

  function bucket(type) {
    let set = listeners.get(type);
    if (!set) { set = new Set(); listeners.set(type, set); }
    return set;
  }

  /**
   * Subscribe to one event type, or '*' for every event.
   * @param {string} type
   * @param {Function} fn  exact-type listeners are called (data); '*'
   *   listeners are called (type, data)
   * @returns {() => void} unsubscribe
   */
  function on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    bucket(type).add(fn);
    return () => off(type, fn);
  }

  /** @param {string} type @param {Function} fn */
  function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  }

  /**
   * @param {string} type
   * @param {*} [data]
   */
  function emit(type, data) {
    // Snapshot each bucket before iterating: a listener that subscribes or
    // unsubscribes mid-emit must not skip/duplicate other listeners.
    const exact = listeners.get(type);
    if (exact) for (const fn of [...exact]) callSafely(fn, data);
    if (type !== '*') {
      const wild = listeners.get('*');
      if (wild) for (const fn of [...wild]) callSafelyWild(fn, type, data);
    }
  }

  function callSafely(fn, data) {
    try { fn(data); } catch (err) { reportListenerError(err); }
  }
  function callSafelyWild(fn, type, data) {
    try { fn(type, data); } catch (err) { reportListenerError(err); }
  }

  return { on, off, emit };
}

function reportListenerError(err) {
  // A listener throwing must never break the emitter for other listeners, or
  // crash the game (rule: errors never reach kids) — surface it for devs only.
  try { console.error('[events] listener error:', err); } catch { /* no console in this sandbox */ }
}
