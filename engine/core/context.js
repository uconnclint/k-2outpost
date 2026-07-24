// context.js — createGameContext(): assembles one game's full service bundle
// (save, settings, audio, speech, feedback, progress, random, events) so a
// game imports ONE thing and every cross-module wire is already connected
// correctly. The actual gating logic (settings.muted -> audio+speech,
// quietCelebrations -> feedback bursts, reducedMotion -> confetti) lives
// INSIDE audio.js/speech.js/feedback.js themselves — this file's real job is
// simpler and more important: make sure every service is built from the
// SAME `settings`/`save` instance, so a game can't wire two different
// settings objects and get inconsistent muting.
//
// audio.js/speech.js/feedback.js are statically imported (v0.2.0 — see the
// note at the import site). A caller (in practice, only this module's own
// test) may override some/all of them with `_factories` — TEST-ONLY, not
// part of the public contract, and never required in a real game.

import { createSave } from './save.js';
import { createSettings } from './settings.js';
import { createProgress } from './progress.js';
import { createEmitter } from './events.js';
import { mulberry32, seedFromString, pick, shuffle, randInt } from './random.js';

// v0.2.0: STATIC imports. The original top-level-await dynamic-import hedge
// existed so this file could load before audio/speech/feedback were written;
// all three now exist, are node-safe, and are covered by the test suite — and
// the top-level await broke Vite's default esbuild target in every Vite game
// (found in the clintsgolf migration). `_factories` remains the test seam.
import { createAudio } from './audio.js';
import { createSpeech } from './speech.js';
import { createFeedback } from './feedback.js';

const _siblingFactories = { createAudio, createSpeech, createFeedback };

// Last-resort stand-ins so ctx.audio/speech/feedback are ALWAYS call-safe,
// even in the pathological case where the real modules never showed up.
// Deliberately tiny — this is a safety net, not a spec for those modules'
// real shape (see CONTRACTS.md for that).
const NOOP_FACTORIES = {
  createAudio: () => ({
    unlock() {}, sfx() {}, celebrate() {}, setMuted() {},
    music: { start() {}, stop() {}, duck() {} },
  }),
  createSpeech: () => ({ say() {}, stop() {} }),
  createFeedback: () => ({ diagnose: () => '' }),
};

/**
 * @param {object} options
 * @param {string} options.gameId  required, kebab-case
 * @param {number} [options.saveVersion=1]
 * @param {object} [options.saveDefaults={}]  top-level `progress` is RESERVED
 *   if options.progress is set — createProgress() claims save.get().progress
 *   at construction (netrunner renamed its own key to `run` over this)
 * @param {string[]} [options.legacySaveKeys]
 * @param {(data:*, fromKey:string) => object} [options.saveMigrate]
 * @param {number} [options.saveSlots]
 * @param {number} [options.saveDebounceMs]
 * @param {'local'|'none'} [options.saveMode]
 * @param {Array<(storage) => object|null>} [options.legacySettingsReaders]
 * @param {{extra?: object}} [options.settings]  extra settings defaults (see settings.js)
 * @param {object} [options.cues]   audio cue table (see audio.js)
 * @param {object} [options.music]  audio music config (see audio.js)
 * @param {object} [options.files]  audio asset-first config (see audio.js)
 * @param {object} [options.speech]  speech config: sources/ttsFallback/etc (see speech.js)
 * @param {object} [options.feedback]  feedback config: sink/etc (see feedback.js)
 * @param {object} [options.progress]  { xpPerLevel, badges, maxAwardsPerSession } (see progress.js);
 *   OPT-IN — omit and ctx.progress is null; enabling it reserves the save
 *   blob's top-level `progress` key for the engine
 * @param {Storage} [options.storage]  shared storage override for save+settings (tests)
 * @param {string|number} [options.randomSeed]  seeds ctx.random; default varies per load
 * @param {object} [options._factories]  TEST-ONLY override for
 *   { createAudio, createSpeech, createFeedback } — lets this module's own
 *   test build a context without audio.js/speech.js/feedback.js existing.
 *   Never use this in game code; real games get the real modules automatically.
 * @returns {{save:object, settings:object, audio:object, speech:object, feedback:object, progress:object, random:object, events:object, destroy:() => void}}
 */
export function createGameContext(options = {}) {
  const { gameId } = options;
  if (!gameId || typeof gameId !== 'string') {
    throw new Error('createGameContext: gameId (kebab-case string) is required');
  }

  const save = createSave({
    gameId,
    version: options.saveVersion ?? 1,
    defaults: options.saveDefaults ?? {},
    storage: options.storage,
    legacyKeys: options.legacySaveKeys,
    migrate: options.saveMigrate,
    slots: options.saveSlots,
    debounceMs: options.saveDebounceMs,
    mode: options.saveMode,
  });

  const settings = createSettings({
    gameId,
    defaults: options.settings?.extra,
    storage: options.storage,
    legacyReaders: options.legacySettingsReaders,
  });

  // options._factories may partially override — e.g. a test that only wants
  // to fake createAudio still gets the real createSpeech/createFeedback.
  const factories = { ...(_siblingFactories || NOOP_FACTORIES), ...(options._factories || {}) };

  // `settings` (and `save`, for progress) are spread in AFTER the caller's
  // config on purpose — a stray same-named key in options.speech/feedback/
  // progress must never shadow the shared instance every service is wired to.
  const audio = factories.createAudio({ cues: options.cues, music: options.music, files: options.files, settings });
  const speech = factories.createSpeech({ ...(options.speech || {}), settings });
  const feedback = factories.createFeedback({ ...(options.feedback || {}), settings });

  // Progress is OPT-IN (v0.1.2): it stores its state under the save blob's
  // `progress` key, and wiring it unconditionally wrote that subtree into
  // EVERY game's save — colliding with any game whose own save schema uses a
  // `progress` field (found during the netrunner + Math Arcade migrations).
  // Pass `progress: {}` (or real options) to enable; ctx.progress is null
  // otherwise and the engine never touches the save blob's `progress` key.
  const progress = options.progress ? createProgress({ ...options.progress, save }) : null;

  const seedInput = options.randomSeed;
  const seed = seedInput === undefined
    ? (Date.now() ^ seedFromString(gameId)) >>> 0
    : (typeof seedInput === 'string' ? seedFromString(seedInput) : seedInput >>> 0);
  const rng = mulberry32(seed);
  const random = {
    rng,
    next: () => rng(),
    pick: (arr) => pick(rng, arr),
    shuffle: (arr) => shuffle(rng, arr),
    randInt: (a, b) => randInt(rng, a, b),
  };

  const events = createEmitter();

  // One-call teardown for the whole bundle (a game's own destroy/scene-exit hook): the save's
  // last debounced write lands FIRST, then everything that ticks, listens, or speaks stops.
  // Idempotent, and every step is isolated — one service failing to tear down never blocks the
  // rest. Services built by _factories test stubs may lack these hooks; optional-chaining keeps
  // destroy() safe there too.
  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { save.destroy?.(); } catch { /* flush best-effort */ }
    try { audio.destroy?.(); } catch { /* ignore */ }
    try { speech.stop?.(); } catch { /* ignore */ }
    try { settings.destroy?.(); } catch { /* ignore */ }
    try { events.clear?.(); } catch { /* ignore */ }
  }

  return { save, settings, audio, speech, feedback, progress, random, events, destroy };
}
