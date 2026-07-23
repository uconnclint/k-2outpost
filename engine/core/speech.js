// speech.js — read-aloud dispatch: clip banks resolved by a template matcher
// (Math Arcade's voicebank.js dispatch shape), played as a cancel-token
// sequence (Scoop Troop's voice.js model — a new say() silently stops the
// old one), with AUTOMATIC SpeechSynthesis fallback whenever no clip source
// matches or a clip fails to play. Silence is never acceptable — that is the
// entire reason this module exists (Space Builders' silent-failure bug is
// the cautionary tale). Nothing touches a browser global at import time.

/**
 * @param {Object} [injected]
 * @returns {{speak: Function, cancel: Function, createUtterance: Function}|null}
 */
function resolveSpeech(injected) {
  if (injected) return injected;
  if (typeof window !== 'undefined' && window.speechSynthesis && window.SpeechSynthesisUtterance) {
    const synth = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;
    return {
      speak: (u) => synth.speak(u),
      cancel: () => synth.cancel(),
      createUtterance: (text) => new Utterance(text),
    };
  }
  if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
    return {
      speak: (u) => speechSynthesis.speak(u),
      cancel: () => speechSynthesis.cancel(),
      createUtterance: (text) => new SpeechSynthesisUtterance(text),
    };
  }
  return null;
}

function resolveAudioElementClass() {
  if (typeof Audio !== 'undefined') return Audio;
  if (typeof window !== 'undefined' && window.Audio) return window.Audio;
  return null;
}

/**
 * Default clip player: a real HTMLAudioElement, resolving on 'ended',
 * rejecting on 'error'. A `.stop()` is attached to the returned promise so
 * `stop()`/a new say() can silence an in-flight clip immediately rather than
 * letting it play out after it's been superseded.
 */
function defaultPlayClip(url) {
  const AudioCtor = resolveAudioElementClass();
  if (!AudioCtor) return Promise.reject(new Error('no Audio element available'));
  let a;
  try { a = new AudioCtor(url); } catch (err) { return Promise.reject(err); }
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const onEnded = () => { if (settled) return; settled = true; cleanup(); resolve(); };
    const onError = () => { if (settled) return; settled = true; cleanup(); reject(new Error('clip playback error: ' + url)); };
    function cleanup() {
      try { a.removeEventListener('ended', onEnded); a.removeEventListener('error', onError); } catch { /* ignore */ }
    }
    try { a.addEventListener('ended', onEnded); a.addEventListener('error', onError); } catch { /* ignore */ }
    let p;
    try { p = a.play(); } catch (err) { onError(); return; }
    if (p && p.catch) p.catch(onError);
  });
  promise.stop = () => { try { a.pause(); } catch { /* ignore */ } };
  return promise;
}

/**
 * @param {{
 *   settings?: {get: Function},
 *   sources?: Array<{resolve: (text: string) => (string[]|null)}>,
 *   ttsFallback?: boolean,
 *   speech?: {speak: Function, cancel: Function, createUtterance: Function},
 *   playClip?: (url: string) => Promise<void>,
 * }} [opts]
 * @returns {{say: (text: string, opts?: {interrupt?: boolean}) => Promise<void>, stop: () => void, unlock: () => void}}
 */
export function createSpeech({ settings, sources = [], ttsFallback = true, speech, playClip = defaultPlayClip } = {}) {
  let token = 0;
  let speaking = false;
  let currentAudioStop = null; // () => void, stops whatever defaultPlayClip is currently playing

  function isMuted() { try { return settings ? !!settings.get('muted') : false; } catch { return false; } }
  function isReadAloudOn() { try { return settings ? settings.get('readAloud') !== false : true; } catch { return true; } }

  function resolveFromSources(text) {
    for (const source of sources) {
      try {
        const clips = source && typeof source.resolve === 'function' ? source.resolve(text) : null;
        if (clips && clips.length) return clips;
      } catch { /* a broken source must not break dispatch — try the next one */ }
    }
    return null;
  }

  /** Cancels whatever is currently playing (clip sequence or TTS). Safe to call anytime. */
  function stop() {
    token += 1;
    if (currentAudioStop) { try { currentAudioStop(); } catch { /* ignore */ } currentAudioStop = null; }
    const adapter = resolveSpeech(speech);
    if (adapter) { try { adapter.cancel(); } catch { /* ignore */ } }
    speaking = false;
  }

  // Dispatch-and-return rather than waiting on the utterance's 'end' event:
  // SpeechSynthesis completion events are known-flaky across browsers, and
  // every reference implementation (Harvest/mail/scoop-troop) treats TTS as
  // fire-and-forget too. `onend`/`onerror` are still wired below as
  // best-effort bookkeeping — real browsers that DO fire them clear
  // `speaking` a little more accurately for the `interrupt:false` check —
  // but nothing here ever awaits them, so a platform/fake that never fires
  // them can't hang a caller who awaits say().
  function speakTTS(text, myToken) {
    if (myToken === token) speaking = false;
    if (!ttsFallback) return Promise.resolve();
    const adapter = resolveSpeech(speech);
    if (!adapter) return Promise.resolve(); // no TTS anywhere on this platform — nothing more we can do
    try {
      const utterance = adapter.createUtterance(text);
      if (utterance.rate == null) utterance.rate = 1;
      if (utterance.pitch == null) utterance.pitch = 1;
      if (utterance.volume == null) utterance.volume = 1;
      utterance.onend = () => {};
      utterance.onerror = () => {};
      adapter.speak(utterance);
    } catch { /* a broken TTS backend must never crash the game */ }
    return Promise.resolve();
  }

  function onClipError(myToken, fallbackText) {
    if (myToken !== token) return Promise.resolve(); // superseded — let the newer say() own the outcome
    return speakTTS(fallbackText, myToken);
  }

  function playClipSequence(urls, myToken, fallbackText) {
    let i = 0;
    const step = () => {
      if (myToken !== token) return Promise.resolve();
      if (i >= urls.length) { if (myToken === token) speaking = false; return Promise.resolve(); }
      const url = urls[i++];
      let result;
      try { result = playClip(url); } catch (err) { return onClipError(myToken, fallbackText); }
      if (result && typeof result.stop === 'function') currentAudioStop = result.stop;
      return Promise.resolve(result).then(
        () => step(),
        () => onClipError(myToken, fallbackText), // ANY clip failing falls back for the WHOLE line — never partial silence
      );
    };
    return step();
  }

  /**
   * Speak `text`: resolve it through `sources` in order, play the first
   * matching clip sequence, or fall back to SpeechSynthesis automatically.
   * By default a new say() interrupts whatever is currently speaking
   * (Scoop Troop's model — kids mash buttons); pass `interrupt: false` to
   * let the current line finish instead of being cut off.
   * @param {string} text
   * @param {{interrupt?: boolean}} [opts]
   * @returns {Promise<void>} resolves once playback (or fallback) has settled; never rejects
   */
  function say(text, opts = {}) {
    if (!text) return Promise.resolve();
    if (isMuted() || !isReadAloudOn()) return Promise.resolve();
    const interrupt = opts.interrupt !== false;
    if (speaking && !interrupt) return Promise.resolve();
    stop(); // bumps the cancel token and clears whatever was playing
    const myToken = token;
    speaking = true;
    const clean = String(text);
    const clips = resolveFromSources(clean);
    return clips && clips.length ? playClipSequence(clips, myToken, clean) : speakTTS(clean, myToken);
  }

  /**
   * iOS/Safari needs a play() inside a user gesture to unlock clip audio.
   * Idempotent; safe (and cheap) to call from every entry-gesture handler
   * even on platforms/tests with no Audio element.
   */
  function unlock() {
    const AudioCtor = resolveAudioElementClass();
    if (!AudioCtor) return;
    try {
      const a = new AudioCtor();
      a.volume = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      if (p && p.then) p.then(() => { try { a.pause(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  }

  return { say, stop, unlock };
}

/**
 * Builds a `sources` entry from exact phrases + regex templates (Math
 * Arcade's voicebank.js shape, generalized). Content-agnostic: the engine
 * doesn't hardcode any language — games supply their own phrase/template
 * tables (e.g. number-word matchers), this just gives every game the same
 * ordered "exact match, then first matching template" dispatch instead of
 * reinventing it.
 * @param {{
 *   phrases?: Object<string, string|string[]>,
 *   templates?: Array<{re: RegExp, build: (match: RegExpMatchArray) => (string|string[]|null)}>,
 *   baseUrl?: string,
 *   ext?: string,
 * }} manifest
 * @returns {{resolve: (text: string) => (string[]|null)}}
 */
export function clipBank({ phrases = {}, templates = [], baseUrl = '', ext = '' } = {}) {
  const isAbsolute = (key) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(key) || key.startsWith('/');
  const toUrl = (key) => (isAbsolute(key) ? key : baseUrl + key + ext);
  const toUrls = (value) => (Array.isArray(value) ? value : [value]).map(toUrl);

  return {
    resolve(text) {
      const t = String(text ?? '').trim().replace(/\s+/g, ' ');
      if (!t) return null;
      if (Object.prototype.hasOwnProperty.call(phrases, t)) return toUrls(phrases[t]);
      for (const tpl of templates) {
        const m = t.match(tpl.re);
        if (!m) continue;
        const built = tpl.build(m);
        if (built) return toUrls(built);
      }
      return null;
    },
  };
}
