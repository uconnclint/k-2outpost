// ============================================================
// SPACE BUILDERS — spoken voice (ElevenLabs "Alice" clips)
// Plays a friendly pre-recorded line at each game moment so pre-readers
// hear the category and building names out loud, through ctx.speech
// (engine/core/speech.js, wired via registerSpeechClips() below — see
// ../engine-bridge.js's header for why this file hands its clip source
// to the bridge instead of the bridge importing this file). ctx.speech
// adds the one thing this file never had: if a clip is missing or fails
// to load, the line gets SPOKEN via SpeechSynthesis instead of going
// silent — bug #2 this migration exists to fix (any building not yet
// recorded, or any clip a fetch hiccup drops, used to just say nothing).
//
// say(key, fallbackText): fallbackText is what SpeechSynthesis speaks if
// the `key` clip is missing/fails. Building/category names are passed in
// by ui.js (it already has the display name in scope at the tap site —
// same reasoning Scoop Troop's voice.js used for its orderSentence()
// fallback); FIXED_SPEECH below covers this file's own fixed narrator
// lines (welcome/blastoff/cheers/byebye), called with no explicit text.
//
// `enabled` mirrors ctx.settings' `muted` flag exactly like core/audio.js
// (see that file's header) — CE.settings.onChange is the single source
// of truth both engines react to. say()/cheer()/bye() no longer check
// `enabled` themselves before calling ctx.speech.say(): that would be a
// second, redundant mute check (ctx.speech.say() already gates on
// settings.get('muted') internally, live, every call) — enabled's only
// remaining job is applying setEnabled()'s "stop whatever's playing
// right now" side effect and satisfying anything (console debugging via
// window.__SB__.voice, audio.js parity) that reads it.
// ============================================================

import { CE, registerSpeechClips } from '../engine-bridge.js';

const VOICE_URLS = import.meta.glob('../assets/voice/*.mp3', { eager: true, query: '?url', import: 'default' });
function clipUrl(key) {
  const hit = Object.entries(VOICE_URLS).find(([k]) => k.endsWith('/' + key + '.mp3'));
  return hit ? hit[1] : null;
}

const YAYS = ['yay-1', 'yay-2', 'yay-3', 'yay-4', 'yay-5'];

// Fixed narrator lines this file owns outright — nothing on-screen to
// borrow display text from at the call site (contrast: 'cat-'/'b-' keys
// get their fallback text passed in by ui.js, which already has the
// building/category's display name in scope). Kept short and generic on
// purpose: unlike an instruction a kid must act on, exact wording doesn't
// matter for a cheer or a goodbye.
const FIXED_SPEECH = {
  welcome: 'Build your own space city on the Moon!', // matches index.html's boot-sub tagline
  blastoff: 'Blast off!',
  allclean: 'All clean!',
  byebye: 'Bye bye!',
  'yay-1': 'Yay!',
  'yay-2': 'Hooray!',
  'yay-3': 'Woohoo!',
  'yay-4': 'Nice building!',
  'yay-5': 'Great job!',
};

// ---- ctx.speech wiring: a clip source + a cache-reusing clip player ----
// Every call site here already knows the EXACT clip key it wants (built
// from a building/category id, not free text), so — like Scoop Troop's
// voice.js — there's no phrase to template-match against. say()/cheer()/
// bye() stash the resolved URL in `pendingUrl` immediately before calling
// ctx.speech.say(fallbackText); this source's resolve() just returns it,
// ignoring its `text` argument entirely (that argument is only ever the
// TTS FALLBACK text here, never a clip key). Safe despite the shared
// variable: ctx.speech's say() calls resolve() SYNCHRONOUSLY, inside its
// own call stack (see engine/core/speech.js's say() -> resolveFromSources()),
// before control ever returns to anything that could call say() again —
// no reentrancy window.
let pendingUrl = null;
const clipSource = {
  resolve() {
    const url = pendingUrl;
    pendingUrl = null;
    return url ? [url] : null;
  },
};

const cache = new Map(); // url -> HTMLAudioElement, warmed by preload()
function cachedEl(url) {
  let a = cache.get(url);
  if (!a) { a = new Audio(url); a.preload = 'auto'; cache.set(url, a); }
  return a;
}

// Custom playClip for ctx.speech: reuses the SAME cached <audio> elements
// preload() warms (the engine's default playClip would construct a fresh
// Audio() every call, silently defeating preload()).
function playClipCached(url) {
  let a;
  try { a = cachedEl(url); a.currentTime = 0; } catch (err) { return Promise.reject(err); }
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    function cleanup() {
      try { a.removeEventListener('ended', onEnded); a.removeEventListener('error', onError); } catch { /* ignore */ }
    }
    function onEnded() { if (settled) return; settled = true; cleanup(); resolve(); }
    function onError() { if (settled) return; settled = true; cleanup(); reject(new Error('clip playback error: ' + url)); }
    try { a.addEventListener('ended', onEnded); a.addEventListener('error', onError); } catch { /* ignore */ }
    let p;
    try { p = a.play(); } catch (err) { onError(); return; }
    if (p && p.catch) p.catch(onError);
  });
  promise.stop = () => { try { a.pause(); } catch { /* ignore */ } };
  return promise;
}

// Hand our clip source + player to the bridge NOW, at this file's own
// module-eval time — safe because engine-bridge.js never imports this
// file (only the reverse), so there is no circular-import ordering
// concern; see engine-bridge.js's header for the full reasoning.
registerSpeechClips(clipSource, playClipCached);

class Voice {
  constructor() {
    this.enabled = !CE.settings.get('muted');
    this._lastYay = 0;
    this._lastBye = 0;
    CE.settings.onChange((key, value) => { if (key === 'muted') this._applyMuted(!!value); });
  }

  // Applies a mute/unmute that's ALREADY landed in CE.settings (called
  // from the onChange listener above) — never call this directly, call
  // setEnabled() so the choice actually persists. Stops via ctx.speech
  // (which owns playback now, not a locally-tracked <audio> element).
  _applyMuted(muted) {
    this.enabled = !muted;
    if (muted) CE.speech.stop();
  }

  // Speak a clip by key, cutting off whatever was talking. fallbackText
  // (or FIXED_SPEECH[key] if omitted) is what SpeechSynthesis speaks if
  // the clip is missing or fails to load — ctx.speech.say() handles both
  // the clip-vs-TTS decision AND the mute/readAloud gating internally.
  say(key, fallbackText) {
    pendingUrl = clipUrl(key);
    CE.speech.say(fallbackText || FIXED_SPEECH[key] || '');
  }

  // A random cheer, but not on every single tap.
  cheer(now = performance.now()) {
    if (now - this._lastYay < 1500) return;
    this._lastYay = now;
    this.say(YAYS[(Math.random() * YAYS.length) | 0]);
  }

  bye(now = performance.now()) {
    if (now - this._lastBye < 1200) return;
    this._lastBye = now;
    this.say('byebye');
  }

  setEnabled(on) {
    CE.settings.set('muted', !on);
  }

  // Warm a few clips so the first line isn't delayed (unchanged public
  // surface from the pre-engine version — not currently called by any
  // site, kept for API parity).
  preload(keys) {
    (keys || []).forEach((k) => {
      const u = clipUrl(k);
      if (u) { try { cachedEl(u).load(); } catch { /* ignore */ } }
    });
  }

  // iOS/Safari needs a play() inside the first user gesture to unlock
  // audio — the pre-engine version never had this (every call site
  // happened to already run inside a click handler), but ctx.speech's
  // TTS fallback can land a frame or two AFTER the triggering gesture
  // (it runs from inside a Promise .then(), once a clip fails — see
  // engine/core/speech.js's playClipSequence), which is exactly the kind
  // of "not quite synchronous with the tap" case iOS Safari can silently
  // refuse. Called once from main.js's startGame(), next to audio.init().
  unlock() {
    CE.speech.unlock();
  }
}

export const voice = new Voice();
