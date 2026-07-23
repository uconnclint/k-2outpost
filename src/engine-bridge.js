// ============================================================
// engine-bridge.js — ES module bridge between Space Builders' game code
// and clint-engine.
//
// Real ESM, no window.CE global needed: Space Builders is already a real
// ES-module/Vite game (like netrunner/mail, the Vite-path precedent this
// migration follows), unlike the classic-script Phaser games (e.g.
// critter-codex, scoop-troop) that need a window bridge because their
// scene/game files are plain <script> globals.
//
// This file builds ONE shared `CE` service bundle at module-eval time and
// exports it as a named singleton; any module that needs save/settings/
// speech does `import { CE } from '../engine-bridge.js'`.
//
// SPEECH WIRING IS INDIRECT ON PURPOSE (registerSpeechClips, below) rather
// than this file importing core/voice.js directly to read its clip
// source/player: core/voice.js needs `CE` itself (CE.settings, CE.speech)
// inside its own methods, so `engine-bridge.js -> voice.js -> engine-
// bridge.js` would be a genuine ES-module import cycle — whichever file
// gets evaluated first would find the other's export still in its
// temporal-dead-zone (an ES `const` circular reference), so the first
// real synchronous use would throw. voice.js instead imports ONLY from
// here (one direction) and calls registerSpeechClips(...) once, at ITS
// OWN module-eval time, to hand its clip source + player into the
// mutable slots below — which the speech config was already constructed
// against (arrays/closures are captured by reference, not by value, so a
// push/assign after construction is still visible to every future
// ctx.speech.say() call). See core/voice.js's own header for the other
// half of this handshake.
// ============================================================

import { createGameContext } from '../engine/core/context.js';

const GAME_ID = 'space-builders';
const SAVE_VERSION = 1;

// createSave()'s own primary-key format (engine/core/save.js:
// `${gameId}.save.v${version}`) — computed here, once, so state.js's
// hasSave()/clearSave() (which need to check/touch the raw storage key
// directly, not just the live ctx.save object — see state.js for why)
// never have to duplicate or guess the format.
export const PRIMARY_SAVE_KEY = `${GAME_ID}.save.v${SAVE_VERSION}`;
export const LEGACY_SAVE_KEY = 'space-builders-save-v1';

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// ── Save: the pre-engine shape was already exactly this ────────────
// src/core/state.js's original save() always wrote ONE flat blob,
// {v:1, buildings:[...], uidCounter:N} — no settings/progress ever lived
// in it (Space Builders never had a settings blob at all; see the
// "Settings" note below, and bug #1 in the migration brief). So unlike
// netrunner's four-key fold or mail's three-subtree merge, migrating this
// legacy blob is a straight passthrough with just type-safety guards —
// no field renaming, no deep merge, no `progress`-key collision to dodge
// (none of these field names shadow ctx.progress's reserved `progress`
// key, and ctx.progress is left disabled below regardless — see CONTRACTS.md).
const SAVE_DEFAULTS = { v: 1, buildings: [], uidCounter: 1 };

// migrate(data, fromKey): createSave() calls this with `data` = the
// already-JSON.parsed contents of space-builders-save-v1 (the only entry
// in legacySaveKeys below, so fromKey is always that same string here).
// `v` is passed through unchanged for shape fidelity even though nothing
// has ever read it (the original load() never checked it either — see
// state.js) — kept only so a byte-level diff of an adopted blob still
// looks like the game's own shape, not a decision this file is basing
// anything on.
function migrateLegacySave(data) {
  const d = isPlainObject(data) ? data : {};
  return {
    v: 1,
    buildings: Array.isArray(d.buildings) ? d.buildings : [],
    uidCounter: Number.isInteger(d.uidCounter) ? d.uidCounter : 1,
  };
}

// ── Settings: nothing to adopt — this IS bug #1 ─────────────────────
// Space Builders never persisted a mute choice anywhere (src/core/
// audio.js's `enabled`/src/core/voice.js's `enabled` were both in-memory-
// only fields, hardcoded `true`, reset to audible on every reload — see
// the migration brief). So there is no legacySettingsReaders entry here:
// there is no old key, flag, or save-blob field to read a kid's prior
// choice from. Every player, new or returning, gets the engine's
// muted:true default (Q11) with nothing to preserve — which is strictly
// MORE correct than the pre-engine behavior (which never remembered a
// mute choice at all, legacy or otherwise).

// ── Speech: deferred clip-source/player registration (see file header) ──
const speechSources = [];
let clipPlayer;

/**
 * Called once by core/voice.js at its own module-eval time to hand this
 * bridge its clip-resolving source + cache-reusing player — see this
 * file's header comment for why the wiring runs this direction instead
 * of engine-bridge.js importing voice.js.
 * @param {{resolve: (text: string) => (string[]|null)}} source
 * @param {(url: string) => Promise<void>} playClip
 */
export function registerSpeechClips(source, playClip) {
  speechSources.push(source);
  clipPlayer = playClip;
}

export const CE = createGameContext({
  gameId: GAME_ID,
  saveVersion: SAVE_VERSION,
  saveDefaults: SAVE_DEFAULTS,
  legacySaveKeys: [LEGACY_SAVE_KEY],
  saveMigrate: migrateLegacySave,
  // progress: intentionally omitted (opt-in per engine v0.1.2+) — Space
  // Builders has no XP/badge system of its own to collide with, but there's
  // nothing here worth turning on either; a no-goals free-build sandbox has
  // no notion of "progress" to award.
  speech: {
    sources: speechSources,
    // Defensive fallback in case this is ever somehow called before
    // voice.js's registerSpeechClips() runs (shouldn't happen — the whole
    // module graph, including voice.js, finishes evaluating before any
    // real user gesture can call ctx.speech.say() — but a clean rejection
    // here just falls through to ctx.speech's own TTS path instead of
    // throwing a raw "clipPlayer is not a function").
    playClip: (url) => (clipPlayer ? clipPlayer(url) : Promise.reject(new Error('no clip player registered yet'))),
  },
});
