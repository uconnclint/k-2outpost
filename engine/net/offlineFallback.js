// offlineFallback.js — sessionFactory(): the same-interface online/local
// swap voxel type's `public/js/net.js` pioneered (`OnlineRace`/`LocalRace`,
// consumed by `race.js`/`scene-race.js` — both classes expose an identical
// `on/emit/join/sendProgress/leave` surface, so the game code that DRIVES a
// race never has to know or care which one it got). This file generalizes
// that pattern so any game can degrade a dropped connection to
// practice-vs-bots with ZERO call-site changes, without having to hand-roll
// its own swap-and-replay-listeners wrapper each time.
//
// `online`/`local` are plain factories returning THE GAME'S OWN session
// objects (e.g. an `OnlineRace`/`LocalRace` pair, or a `roomClient.js`
// instance paired with a bot-sim) — this file doesn't define what a session
// looks like, only how to swap one out for the other transparently.

/**
 * @param {object} options
 * @param {() => object} options.online  builds the online session; must
 *   expose `.on(event, fn)` and emit one of `fallbackOn`'s events on
 *   connect failure (voxel type's `OnlineRace` emits `'error'`)
 * @param {() => object} options.local  builds the local/practice session —
 *   the SAME public interface as the online one (`LocalRace`'s shape)
 * @param {string[]} [options.fallbackOn=['error']]  online-session event
 *   names that trigger a one-time swap to the local session
 * @param {(reason: *) => void} [options.onFallback]  fires once, right
 *   before swapping, so the game can toast "Couldn't connect — playing solo!"
 * @returns {object} a session with the SAME shape as `online()`/`local()` —
 *   every property/method access forwards to whichever session is
 *   currently live; `.on(event, fn)` handlers registered before a fallback
 *   are automatically re-registered on the new local session; `.isOnline`
 *   reports which one is currently active.
 */
export function sessionFactory(options = {}) {
  const { online, local, fallbackOn = ['error'], onFallback } = options;
  if (typeof online !== 'function' || typeof local !== 'function') {
    throw new Error('sessionFactory: options.online and options.local factories are required');
  }

  let active = online();
  let fellBack = false;
  const registeredHandlers = []; // [event, fn] pairs, replayed onto local() if we fall back

  function swapToLocal(reason) {
    if (fellBack) return;
    fellBack = true;
    try { active.leave?.(); } catch { /* already gone */ }
    active = local();
    for (const [ev, fn] of registeredHandlers) active.on?.(ev, fn);
    try { onFallback?.(reason); } catch { /* a broken toast must never break the swap */ }
  }

  for (const ev of fallbackOn) {
    active.on?.(ev, (data) => swapToLocal(data));
  }

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'isOnline') return !fellBack;
      const value = active[prop];
      if (typeof value !== 'function') return value;
      if (prop === 'on') {
        // Remember every handler so a later swap can replay it onto the
        // fresh local session — the game never has to re-subscribe itself.
        return (ev, fn) => { registeredHandlers.push([ev, fn]); return active.on(ev, fn); };
      }
      return value.bind(active);
    },
    has(_target, prop) {
      return prop === 'isOnline' || prop in active;
    },
  });
}
