// ============================================================
// SPACE BUILDERS — spoken voice (ElevenLabs "Alice" clips)
// Plays a friendly pre-recorded line at each game moment so
// pre-readers hear the category and building names out loud.
// Clips live in src/assets/voice/<key>.mp3; missing keys are
// simply silent, so the game still runs before they're made.
// ============================================================

const VOICE_URLS = import.meta.glob('../assets/voice/*.mp3', { eager: true, query: '?url', import: 'default' });
function clipUrl(key) {
  const hit = Object.entries(VOICE_URLS).find(([k]) => k.endsWith('/' + key + '.mp3'));
  return hit ? hit[1] : null;
}

const YAYS = ['yay-1', 'yay-2', 'yay-3', 'yay-4', 'yay-5'];

class Voice {
  constructor() {
    this.enabled = true;
    this.cache = new Map();     // key -> HTMLAudioElement (or null if no clip)
    this.current = null;
    this._lastYay = 0;
    this._lastBye = 0;
  }

  _audio(key) {
    if (!this.cache.has(key)) {
      const url = clipUrl(key);
      const a = url ? new Audio(url) : null;
      if (a) a.preload = 'auto';
      this.cache.set(key, a);
    }
    return this.cache.get(key);
  }

  // Speak a clip, cutting off whatever was talking (so rapid taps don't pile up).
  say(key) {
    if (!this.enabled) return;
    const a = this._audio(key);
    if (!a) return;
    try {
      if (this.current && this.current !== a) { this.current.pause(); this.current.currentTime = 0; }
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      this.current = a;
    } catch { /* ignore */ }
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
    this.enabled = on;
    if (!on && this.current) { try { this.current.pause(); } catch { /* ignore */ } }
  }
}

export const voice = new Voice();
