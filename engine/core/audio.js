// audio.js — synth-first WebAudio engine: bus graph, cue tables, ducked
// music, mute wiring. Ported from IceCream's bus graph + lookahead music
// scheduler, scoop-troop's DynamicsCompressor graph, poison candy's duck(),
// and Math Arcade's asset-first-with-synth-fallback chain. Nothing here
// touches a browser global at import time — the AudioContext is created
// lazily on unlock()/sfx()/celebrate()/music.start(), so importing this
// module is always safe in Node.

const DEFAULT_MASTER_VOLUME = 0.9;
const DEFAULT_SFX_VOLUME = 0.6;
const DEFAULT_MUSIC_VOLUME = 0.18;
const DUCK_LEVEL = 0.35; // fraction of normal music volume while ducked
const LOOKAHEAD_MS = 40; // how often the music scheduler timer fires
const SCHEDULE_AHEAD_S = 0.12; // how far ahead (seconds) notes get scheduled

/**
 * @param {Function} [injected]
 * @returns {Function|null} an AudioContext constructor, or null if none exists
 */
function resolveAudioContextClass(injected) {
  if (injected) return injected;
  if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
    return window.AudioContext || window.webkitAudioContext;
  }
  if (typeof AudioContext !== 'undefined') return AudioContext;
  return null;
}

function resolveAudioElementClass() {
  if (typeof Audio !== 'undefined') return Audio;
  if (typeof window !== 'undefined' && window.Audio) return window.Audio;
  return null;
}

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * @param {{
 *   settings?: {get: Function, set?: Function, onChange?: Function},
 *   cues?: Object<string, Function|Object|Array>,
 *   music?: Object<string, {bpm: number, channels: Array}>,
 *   files?: Object<string, string>,
 *   audioContextClass?: Function,
 * }} [opts]
 * @returns {{
 *   unlock: () => void,
 *   isMuted: () => boolean,
 *   setMuted: (b: boolean) => void,
 *   sfx: (name: string) => void,
 *   celebrate: (name: string) => void,
 *   music: {start: (id: string) => void, stop: () => void, duck: (on: boolean) => void},
 *   unlocked: boolean,
 * }}
 */
export function createAudio({ settings, cues = {}, music = {}, files = null, audioContextClass } = {}) {
  let ctx = null;
  let master = null;
  let compressor = null;
  let sfxBus = null;
  let musicBus = null;
  let muted = readSettingsMuted();
  let unlocked = false;
  let musicDucked = false;
  const assetCache = new Map(); // name -> HTMLAudioElement | null (null = missing/unavailable)
  const musicState = { id: null, timer: null, voices: [] };

  function readSettingsMuted() {
    try { return settings ? !!settings.get('muted') : false; } catch { return false; }
  }
  function quietCelebrationsOn() {
    try { return settings ? !!settings.get('quietCelebrations') : false; } catch { return false; }
  }

  // settings is the single source of truth for mute: whenever it changes
  // (from a settings panel, another tab, whatever) the audio graph follows.
  if (settings && typeof settings.onChange === 'function') {
    try {
      settings.onChange((key, value) => { if (key === 'muted') applyMuted(!!value); });
    } catch { /* settings stub without onChange support — fine, still readable via get() */ }
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AC = resolveAudioContextClass(audioContextClass);
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : DEFAULT_MASTER_VOLUME;

      // master -> compressor -> destination (scoop-troop's gentle-ears graph)
      compressor = ctx.createDynamicsCompressor();
      setParam(compressor.threshold, -18);
      setParam(compressor.knee, 24);
      setParam(compressor.ratio, 4);
      setParam(compressor.attack, 0.005);
      setParam(compressor.release, 0.2);
      master.connect(compressor);
      compressor.connect(ctx.destination);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = DEFAULT_SFX_VOLUME;
      sfxBus.connect(master);

      musicBus = ctx.createGain();
      musicBus.gain.value = DEFAULT_MUSIC_VOLUME;
      musicBus.connect(master);
    } catch {
      // Never throw — audio is optional polish, not a hard dependency.
      ctx = null; master = null; compressor = null; sfxBus = null; musicBus = null;
    }
    return ctx;
  }

  function setParam(param, value) {
    try { param.setValueAtTime(value, ctx.currentTime); } catch { try { param.value = value; } catch { /* fake param, ignore */ } }
  }

  /** Idempotent; call from EVERY entry-gesture handler (iOS/Chromebook autoplay rules). */
  function unlock() {
    const c = ensureContext();
    unlocked = true;
    if (!c) return;
    if (c.state === 'suspended') {
      try { c.resume().catch(() => {}); } catch { /* some fakes return non-promise */ }
    }
  }

  function applyMuted(b) {
    muted = !!b;
    if (!ctx || !master) return;
    try {
      const t = ctx.currentTime;
      if (typeof master.gain.cancelScheduledValues === 'function') master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(muted ? 0 : DEFAULT_MASTER_VOLUME, t);
    } catch { try { master.gain.value = muted ? 0 : DEFAULT_MASTER_VOLUME; } catch { /* ignore */ } }
  }

  /** Sets mute AND mirrors it to settings — settings.onChange is what actually flips the graph. */
  function setMuted(b) {
    applyMuted(b);
    if (settings && typeof settings.set === 'function') {
      try { settings.set('muted', !!b); } catch { /* ignore */ }
    }
  }

  function isMuted() { return muted; }

  // ---- synth primitives, bus-agnostic (IceCream/scoop-troop envelope shape) ----
  // A cue's freq/gain envelopes are arrays of [timeOffsetSeconds, value] breakpoints.
  function tone(bus, { wave = 'sine', freq, gain, duration = 0.2, detune = 0 } = {}) {
    if (!ctx || !bus) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = wave;
      if (detune) osc.detune.value = detune;
      const t0 = ctx.currentTime;
      const freqEnv = freq && freq.length ? freq : [[0, 440]];
      freqEnv.forEach(([t, f], i) => {
        if (i === 0) osc.frequency.setValueAtTime(f, t0 + t);
        else osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t0 + t);
      });
      const gainEnv = gain && gain.length ? gain : [[0, 0.3], [duration, 0.0001]];
      gainEnv.forEach(([t, v], i) => {
        const safe = Math.max(0.0001, v);
        if (i === 0) g.gain.setValueAtTime(safe, t0 + t);
        else g.gain.exponentialRampToValueAtTime(safe, t0 + t);
      });
      osc.connect(g);
      g.connect(bus);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* ignore */ } };
    } catch { /* a bad cue must never crash the game */ }
  }

  function noise(bus, { duration = 0.08, gain, filterType = 'highpass', filterFreq = 1000, filterQ = 0.7 } = {}) {
    if (!ctx || !bus) return;
    try {
      const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      filter.Q.value = filterQ;
      const g = ctx.createGain();
      const t0 = ctx.currentTime;
      const env = gain && gain.length ? gain : [[0, 0.5], [duration, 0.0001]];
      env.forEach(([t, v], i) => {
        const safe = Math.max(0.0001, v);
        if (i === 0) g.gain.setValueAtTime(safe, t0 + t);
        else g.gain.exponentialRampToValueAtTime(safe, t0 + t);
      });
      src.connect(filter);
      filter.connect(g);
      g.connect(bus);
      src.start(t0);
      src.stop(t0 + duration + 0.02);
      src.onended = () => { try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch { /* ignore */ } };
    } catch { /* ignore */ }
  }

  const synth = { tone, noise };

  // A cue spec is a function(synth, bus), a single tone/noise options object,
  // or an array of specs to layer — ports IceCream/scoop-troop SFX recipes
  // almost verbatim while the engine owns bus routing + gating.
  function playCueSpec(bus, spec) {
    if (!spec) return;
    if (typeof spec === 'function') { try { spec(synth, bus); } catch { /* ignore */ } return; }
    if (Array.isArray(spec)) { spec.forEach((part) => playCueSpec(bus, part)); return; }
    if (spec.type === 'noise') { noise(bus, spec); return; }
    tone(bus, spec);
  }

  // ---- asset-first with synth fallback (Math Arcade's pattern) ----
  function loadFile(name, url) {
    if (assetCache.has(name)) return Promise.resolve(assetCache.get(name));
    const AudioCtor = resolveAudioElementClass();
    if (!AudioCtor || typeof fetch === 'undefined') { assetCache.set(name, null); return Promise.resolve(null); }
    return fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (!res || !res.ok) throw new Error('missing audio asset');
        const a = new AudioCtor(url);
        assetCache.set(name, a);
        return a;
      })
      .catch(() => { assetCache.set(name, null); return null; });
  }

  function playAssetOrSynth(name, bus, spec) {
    const url = files && files[name];
    // Only worth an async HEAD-check when there's a real chance of playing a
    // file: a configured url AND an Audio element in this environment. That
    // keeps the common "no files configured" / "no Audio in Node" cases
    // synchronous instead of leaving a silent gap for one microtask.
    const AudioCtor = url ? resolveAudioElementClass() : null;
    if (!url || !AudioCtor) { playCueSpec(bus, spec); return; }
    loadFile(name, url).then((a) => {
      if (!a) { playCueSpec(bus, spec); return; }
      try {
        const clone = a.cloneNode();
        clone.volume = 0.8;
        const p = clone.play();
        if (p && p.catch) p.catch(() => playCueSpec(bus, spec));
      } catch { playCueSpec(bus, spec); }
    });
  }

  /** Play a one-shot named cue. No-ops silently when muted or unknown. */
  function sfx(name) {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') { try { c.resume().catch(() => {}); } catch { /* ignore */ } }
    playAssetOrSynth(name, sfxBus, cues[name]);
  }

  /** Like sfx(), but suppressed by settings.quietCelebrations (classroom mode). */
  function celebrate(name) {
    if (muted || quietCelebrationsOn()) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') { try { c.resume().catch(() => {}); } catch { /* ignore */ } }
    playAssetOrSynth(name, sfxBus, cues[name]);
  }

  // ---- music: lookahead scheduler (Chris Wilson pattern, via IceCream) ----
  function scheduleTick(track) {
    if (!ctx || !musicBus) return;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;
    for (const voice of musicState.voices) {
      const { channel, secondsPerBeat } = voice;
      const notes = channel.notes;
      if (!notes || !notes.length) continue;
      while (voice.nextTime < horizon) {
        const [pitch, beats] = notes[voice.index];
        const dur = Math.max(0.02, (beats || 1) * secondsPerBeat);
        const vol = channel.volume != null ? channel.volume : 0.2;
        if (channel.wave === 'noise') {
          if (pitch != null) {
            const isAccent = pitch === 1;
            noise(musicBus, {
              duration: Math.min(dur, 0.12),
              gain: [[0, isAccent ? vol * 1.4 : vol * 0.8], [Math.min(dur, 0.12), 0.0001]],
              filterType: isAccent ? 'bandpass' : 'highpass',
              filterFreq: isAccent ? 1800 : 7000,
              filterQ: isAccent ? 1.2 : 0.6,
            });
          }
        } else if (pitch != null) {
          const pitches = Array.isArray(pitch) ? pitch : [pitch];
          pitches.forEach((p) => {
            tone(musicBus, {
              wave: channel.wave || 'triangle',
              freq: [[0, midiToFreq(p)]],
              gain: [[0, 0.0001], [Math.max(0.02, dur * 0.35), vol], [dur, 0.0001]],
              duration: dur,
            });
          });
        }
        voice.nextTime += dur;
        voice.index = (voice.index + 1) % notes.length;
      }
    }
  }

  function musicStart(id) {
    if (muted) return;
    if (musicState.id === id) return; // restarting the same track is a no-op
    const track = music[id];
    if (!track) return;
    const c = ensureContext();
    if (!c) return;
    musicStop();
    musicState.id = id;
    const secondsPerBeat = 60 / (track.bpm || 120);
    const startTime = c.currentTime + 0.05;
    musicState.voices = (track.channels || []).map((channel) => ({ channel, secondsPerBeat, index: 0, nextTime: startTime }));
    scheduleTick(track);
    musicState.timer = setInterval(() => scheduleTick(track), LOOKAHEAD_MS);
    if (musicState.timer && typeof musicState.timer.unref === 'function') musicState.timer.unref();
  }

  function musicStop() {
    musicState.id = null;
    if (musicState.timer != null) { clearInterval(musicState.timer); musicState.timer = null; }
    musicState.voices = [];
  }

  /** Temporarily lower music volume (e.g. while paused or a voice line plays). */
  function musicDuck(on) {
    musicDucked = !!on;
    if (!ctx || !musicBus) return;
    try {
      const t = ctx.currentTime;
      if (typeof musicBus.gain.cancelScheduledValues === 'function') musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(musicDucked ? DEFAULT_MUSIC_VOLUME * DUCK_LEVEL : DEFAULT_MUSIC_VOLUME, t);
    } catch { /* ignore */ }
  }

  return {
    unlock,
    isMuted,
    setMuted,
    sfx,
    celebrate,
    music: { start: musicStart, stop: musicStop, duck: musicDuck },
    get unlocked() { return unlocked; },
  };
}
