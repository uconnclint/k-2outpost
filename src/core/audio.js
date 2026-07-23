// ============================================================
// SPACE BUILDERS — happy procedural audio (K-2 edition)
// 100% WebAudio, no assets. Cheerful little blips for placing and
// erasing, a rocket whoosh, and a soft twinkly background so the
// moon never feels lonely. One big mute button controls it all.
//
// `enabled` mirrors ctx.settings' `muted` flag (CE.settings, see
// ../engine-bridge.js) — single source of truth, fresh players start
// muted (Q11). setEnabled() only ever WRITES to CE.settings; the
// onChange listener below is what actually ramps the gain node, mirroring
// the exact idiom engine/core/audio.js uses internally for its own
// settings.onChange('muted')-drives-the-gain-node wiring (see that file)
// — Space Builders keeps this bespoke pentatonic synth rather than
// adopting core/audio.js wholesale, but borrows its reactive pattern by
// hand so core/voice.js's independent onChange subscription (next to
// this file) and any future settings UI all stay in lockstep with a
// single flip, not just whichever of setEnabled()'s two call sites
// happens to run first (see src/ui/ui.js's soundBtn handler).
// ============================================================

import { CE } from '../engine-bridge.js';

const PENTA = [0, 2, 4, 7, 9];   // major pentatonic — always sounds happy

class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.enabled = !CE.settings.get('muted');
    this._twinkleTimer = 0;
    this._started = false;
    CE.settings.onChange((key, value) => { if (key === 'muted') this._applyMuted(!!value); });
  }

  init() {
    if (this.ctx) { this._resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.18;      // background stays gentle
      this.musicGain.connect(this.master);
      this._started = true;
      this.start();   // welcome chime
    } catch { /* no audio, no problem */ }
  }

  _resume() {
    try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch { /* ignore */ }
  }

  // Applies a mute/unmute that's ALREADY landed in CE.settings (called
  // from the onChange listener registered in the constructor) — never
  // call this directly to change mute, call setEnabled() so the choice
  // actually persists.
  _applyMuted(muted) {
    this.enabled = !muted;
    if (this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(this.enabled ? 0.9 : 0, now + 0.15);
    }
    if (this.enabled) this._resume();
  }

  setEnabled(on) {
    CE.settings.set('muted', !on);
  }

  // ---- one note: freq (Hz), start offset, length, type, volume ----
  _note(freq, when, dur, type = 'sine', vol = 0.5, dest = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    g.connect(dest || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _midi(semis) { return 261.63 * Math.pow(2, semis / 12); }

  // ---- game sounds ----
  place() {
    if (!this.ctx) return;
    this._resume();
    // happy two-note "boop-beep" up
    this._note(this._midi(7), 0, 0.16, 'triangle', 0.5);
    this._note(this._midi(12), 0.09, 0.20, 'triangle', 0.5);
    this._note(this._midi(16), 0.16, 0.14, 'sine', 0.35);
  }

  erase() {
    if (!this.ctx) return;
    this._resume();
    // soft "boop" down
    this._note(this._midi(4), 0, 0.14, 'sine', 0.4);
    this._note(this._midi(-1), 0.08, 0.18, 'sine', 0.4);
  }

  tap() {
    if (!this.ctx) return;
    this._resume();
    this._note(this._midi(12), 0, 0.08, 'square', 0.18);
  }

  rocket() {
    if (!this.ctx) return;
    this._resume();
    // rising whoosh: swept saw + noisy air
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 1.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.0);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 2.1);
    // little "3-2-1" sparkle at the top
    this._note(this._midi(12), 1.4, 0.2, 'triangle', 0.4);
    this._note(this._midi(19), 1.55, 0.3, 'triangle', 0.4);
  }

  start() {
    if (!this.ctx) return;
    // gentle welcome arpeggio
    [0, 4, 7, 12].forEach((s, i) => this._note(this._midi(s), i * 0.12, 0.5, 'triangle', 0.4));
  }

  // ---- soft twinkly background, scheduled from the main loop ----
  update(dt) {
    if (!this.ctx || !this.enabled) return;
    this._twinkleTimer -= dt;
    if (this._twinkleTimer <= 0) {
      this._twinkleTimer = 1.4 + Math.random() * 2.2;
      const octave = 12 * (1 + (Math.random() < 0.5 ? 0 : 1));
      const semis = PENTA[(Math.random() * PENTA.length) | 0] + octave;
      this._note(this._midi(semis), 0, 1.8, 'sine', 0.5, this.musicGain);
      // a soft fifth below sometimes for warmth
      if (Math.random() < 0.4) this._note(this._midi(semis - 5), 0.02, 2.0, 'sine', 0.35, this.musicGain);
    }
  }
}

export const audio = new Audio();
