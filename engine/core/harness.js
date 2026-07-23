// harness.js — createRoundRunner(): Math Arcade's 45x-duplicated round/score/
// timer boilerplate (see js/main.js, GAME_CONTRACT.md, gradek/counting-
// carnival.js), formalized once. Plus loadRegistry(): the "Coming Soon"
// dynamic-import degradation pattern — a broken/missing game module never
// takes down the whole arcade.

/**
 * @param {object} [options]
 * @param {number} [options.rounds=8]
 * @param {*} [options.ctx]  passed through to onRound/onDone for convenience;
 *   the runner never reads it itself
 * @param {(round:number, rounds:number, ctx:*) => void} [options.onRound]
 *   build/show round N's UI; called once per round, including the first —
 *   the runner has no DOM opinions, this is entirely the game's job
 * @param {(result:{score:number,total:number,stars:number}, ctx:*) => void} [options.onDone]
 * @returns {object}
 */
export function createRoundRunner(options = {}) {
  let roundsTotal = Number.isInteger(options.rounds) && options.rounds > 0 ? options.rounds : 8;
  const ctx = options.ctx;
  const onRound = typeof options.onRound === 'function' ? options.onRound : () => {};
  const onDone = typeof options.onDone === 'function' ? options.onDone : () => {};

  let round = 0;
  let score = 0;
  let firstTry = true;
  let done = false;
  const timers = new Set();

  /**
   * The timer bag: every setTimeout a game schedules (round transitions,
   * sprite parade-ins, "wrong" shake clears...) goes through here so
   * destroy() can guarantee none of them fire after teardown.
   * @param {Function} fn @param {number} ms @returns {*} timer id, for clearLater()
   */
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  /** @param {*} id  cancel one pending later() call */
  function clearLater(id) {
    if (timers.has(id)) { clearTimeout(id); timers.delete(id); }
  }
  function clearAllTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  function starsFor(scoreVal, totalVal) {
    const total = totalVal > 0 ? totalVal : roundsTotal;
    const pct = total > 0 ? scoreVal / total : 0;
    if (pct >= 0.9) return 3;
    if (pct >= 0.7) return 2;
    return 1;
  }

  function finish() {
    if (done) return undefined;
    done = true;
    const result = { score, total: roundsTotal, stars: starsFor(score, roundsTotal) };
    onDone(result, ctx);
    return result;
  }

  function goToRound() {
    if (done) return;
    if (round >= roundsTotal) { finish(); return; }
    firstTry = true;
    onRound(round, roundsTotal, ctx);
  }

  /**
   * Call once the round's first tap/click resolves correctly.
   * @param {object} [opts]
   * @param {number} [opts.delay=800]  ms before auto-advancing to the next round
   * @param {boolean} [opts.advance=true]  pass false to advance manually (call start() yourself)
   */
  function correct(opts = {}) {
    if (done) return;
    if (firstTry) score++;
    round++;
    if (opts.advance === false) return;
    later(goToRound, opts.delay ?? 800);
  }

  /** Call on a wrong answer. No auto-anything — the kid just tries again (no-fail feedback). */
  function wrong() {
    if (done) return;
    firstTry = false;
  }

  /** Restarts the runner. @param {number} [newRounds] optionally change the round count too. */
  function reset(newRounds) {
    clearAllTimers();
    if (Number.isInteger(newRounds) && newRounds > 0) roundsTotal = newRounds;
    round = 0; score = 0; firstTry = true; done = false;
  }

  /** Stops the runner and clears every pending timer — call from the game's own destroy(). */
  function destroy() {
    done = true;
    clearAllTimers();
  }

  return {
    get round() { return round; },
    get score() { return score; },
    get firstTry() { return firstTry; },
    get done() { return done; },
    get rounds() { return roundsTotal; },
    start: goToRound,
    correct,
    wrong,
    later,
    clearLater,
    finish,
    stars: starsFor,
    reset,
    destroy,
  };
}

/**
 * Dynamic-imports a batch of modules; a missing/broken one degrades to
 * `{ ok:false, error }` instead of rejecting the whole batch ("Coming Soon").
 * @param {string[]} entries  import specifiers
 * @returns {Promise<Array<{ok:true,module:object,path:string}|{ok:false,error:*,path:string}>>}
 */
export async function loadRegistry(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const results = await Promise.allSettled(list.map((path) => import(path)));
  return results.map((r, i) => (
    r.status === 'fulfilled'
      ? { ok: true, module: r.value, path: list[i] }
      : { ok: false, error: r.reason, path: list[i] }
  ));
}
