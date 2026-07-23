// raceRoom.js — RaceRoom: reimplementation of the lost `game-multiplayer`
// worker's race protocol (MIGRATION_PLAN.md §9 Q5 — the deployed instance
// at game-multiplayer.csmcleod.workers.dev has no source on this machine).
// Reconstructed VERBATIM from what its two known clients send and expect:
// voxel type's `public/js/race-share.js` (RaceClient/ShareRace, the primary
// source — every message name and field below comes from its handler
// switch) and `nurburgring-grand-prix/public/mp.js` (confirms the same
// server also hosts a DIFFERENT relay-shape protocol at `/room/<name>` —
// see snapshotRelayRoom.js — which is how `makeCode`/`normalizeCode`'s
// shared alphabet convention (now `core/codes.js`) got cross-checked, even
// though mp.js's own game doesn't speak this file's message vocabulary).
//
// A `TickedLobbyRoom` configuration: same pure lobby/countdown/ticking/
// finished state machine, `lobbyMs: Infinity` so nothing auto-starts —
// racing only ever begins on an explicit host `start`, matching this
// protocol's host-authority design (no bot fill either — a share-code room
// is just the friends who joined it).
//
// ---------------------------------------------------------------- protocol
// Client connects directly to `wss://<worker>/race/<code>` — the WebSocket
// upgrade itself IS the join; there is no separate join message or
// reservation round-trip (a 5-char crypto code from `core/codes.js` makes
// collisions negligible, so the client mints its own and just connects).
//
// SERVER -> CLIENT
//   {type:'joined', you, hostId, phase}       sent once, to the new socket only
//   {type:'roster', hostId, phase, racers}    broadcast on every roster change;
//                                              racers: [{id,number,finished,place,wpm}]
//   {type:'countdown', startAt, text}         broadcast when the host starts
//   {type:'standings', racers}                broadcast every tick while live;
//                                              racers: [{number,progress,wpm,finished,place}]
//                                              (progress is a 0..1 FRACTION, not a char count)
//   {type:'finished', id, number, place, wpm} broadcast ONCE per racer, the moment they finish
//   {type:'raceOver', results}                broadcast once, race complete;
//                                              results: [{number,place,wpm}]
//   {type:'reset'}                            broadcast when the host resets
//   {type:'full'}                             sent to a socket rejected for being over capacity
//                                              (immediately followed by a 1013 close)
//
// CLIENT -> SERVER
//   {type:'start', text}     host only, lobby phase only; `text` is the full passage
//                             the host already picked — this server never chooses one
//   {type:'progress', index} anyone, mid-race; `index` = characters correctly typed so
//                             far (an ABSOLUTE count — converted to the outbound
//                             fraction server-side), safe to send on every keystroke
//   {type:'reset'}            host only; returns everyone to the lobby, roster kept

import { TickedLobbyRoom, humans, connectedHumans, joinRoom, leaveRoom, startNow, resetToLobby } from './tickedLobbyRoom.js';

const DEFAULT_COUNTDOWN_MS = 4000; // no source for the exact value (worker is lost) — Matchmaker's own default
const DEFAULT_AFTER_FIRST_FINISH_MS = 75 * 1000; // stragglers' grace window, same rationale as Matchmaker
const DEFAULT_MAX_RACE_MS = 5 * 60 * 1000; // safety backstop so an abandoned race can't hang forever
const DEFAULT_MAX_HUMANS = 24; // generous; the client only renders 5 cars but never caps the roster
const DEFAULT_MAX_TEXT_LEN = 2000;
const MAX_WPM = 250;

// ---------------------------------------------------------------------------
// Pure reducer helpers — no DO/socket dependency, fully unit-testable.
// ---------------------------------------------------------------------------

/**
 * Absolute typed-character count -> the 0..1 fraction the wire protocol
 * reports, clamped to the passage length.
 * @param {number} index
 * @param {number} textLength
 * @returns {number}
 */
export function progressFraction(index, textLength) {
  if (!textLength) return 0;
  const clamped = Math.max(0, Math.min(textLength, Math.floor(index) || 0));
  return clamped / textLength;
}

/**
 * @param {number} index  characters correctly typed so far
 * @param {number} elapsedMs  time since the race actually started
 * @returns {number} words per minute, clamped to a sane K-4 ceiling
 */
export function wpmFromIndex(index, elapsedMs) {
  const elapsedMin = Math.max(1 / 60, elapsedMs / 60000);
  return Math.max(0, Math.min(MAX_WPM, Math.round((index / 5) / elapsedMin)));
}

/**
 * Multi-condition finish, mirroring Matchmaker's own: everyone connected
 * has finished (checked by the base state machine before this even runs),
 * OR the last human left, OR the race ran past its safety ceiling, OR it's
 * been too long since the first finisher crossed the line.
 * @param {object} room
 * @param {number} now
 * @param {{maxRaceMs?: number, afterFirstFinishMs?: number}} [limits]
 * @returns {boolean}
 */
export function raceIsFinished(room, now, limits = {}) {
  if (!connectedHumans(room).length) return true;
  if (room.startAt != null && limits.maxRaceMs != null && now - room.startAt > limits.maxRaceMs) return true;
  const finishTimes = [...room.players.values()]
    .filter((p) => p.finished && p.finishedAt != null)
    .map((p) => p.finishedAt);
  if (finishTimes.length && limits.afterFirstFinishMs != null
    && now - Math.min(...finishTimes) > limits.afterFirstFinishMs) return true;
  return false;
}

/**
 * @param {object} room
 * @returns {Array<{number: number, place: number|null, wpm: number}>}
 */
export function computeRaceResults(room) {
  return [...room.players.values()]
    .filter((p) => p.finished || p.place)
    .sort((a, b) => (a.place || 99) - (b.place || 99))
    .map((p) => ({ number: p.number, place: p.place, wpm: p.wpm }));
}

// ---------------------------------------------------------------------------
// DO layer
// ---------------------------------------------------------------------------

export class RaceRoom extends TickedLobbyRoom {
  /**
   * @param {*} ctx
   * @param {*} env
   * @param {object} [options]
   * @param {number} [options.countdownMs=4000]
   * @param {number} [options.tickMs=250]
   * @param {number} [options.maxHumans=24]
   * @param {number} [options.maxRaceMs]  safety backstop (default 5 minutes)
   * @param {number} [options.afterFirstFinishMs]  straggler grace window (default 75s)
   * @param {number} [options.maxTextLen=2000]  passage length cap (defensive; the
   *   protocol has no source-specified limit since the original worker is lost)
   */
  constructor(ctx, env, options = {}) {
    const maxRaceMs = options.maxRaceMs ?? DEFAULT_MAX_RACE_MS;
    const afterFirstFinishMs = options.afterFirstFinishMs ?? DEFAULT_AFTER_FIRST_FINISH_MS;
    super(ctx, env, {
      lobbyMs: Infinity, // host-triggered start only — see startNow() in handleStart
      countdownMs: options.countdownMs ?? DEFAULT_COUNTDOWN_MS,
      tickMs: options.tickMs ?? 250,
      maxHumans: options.maxHumans ?? DEFAULT_MAX_HUMANS,
      isFinished: (room, now) => raceIsFinished(room, now, { maxRaceMs, afterFirstFinishMs }),
      computeResults: (room) => computeRaceResults(room),
    });
    this.maxTextLen = options.maxTextLen ?? DEFAULT_MAX_TEXT_LEN;
    this.nextPlace = 0;
    this.nextNumber = 0;
    this.room.text = '';
  }

  // ---- join is at CONNECT time, not via a message (race-share.js never
  // sends one — the WebSocket upgrade itself is the join) -----------------

  async onJoin(ws, _meta, _request) {
    if (connectedHumans(this.room).length >= this.config.maxHumans) {
      this.send(ws, { type: 'full' });
      try { ws.close(1013, 'room full'); } catch { /* already gone */ }
      return;
    }
    const now = this.now();
    const id = 'r' + (++this.nextId);
    const meta = { number: ++this.nextNumber, progress: 0, wpm: 0, finished: false, place: null };
    const player = joinRoom(this.room, id, meta, now, this.config);
    ws.__lobbyId = id;
    this.send(ws, this.formatJoined(player));
    this.broadcast(this.formatLobby());
    this.ensureTicker();
  }

  // ---- wire protocol: start / progress / reset ----------------------------

  async onMessage(ws, msg) {
    switch (msg.type) {
      case 'start': return this.handleStart(ws, msg);
      case 'progress': return this.handleProgress(ws, msg);
      case 'reset': return this.handleReset(ws);
      default: return undefined;
    }
  }

  handleStart(ws, msg) {
    const id = ws.__lobbyId;
    if (!id || id !== this.hostId() || this.room.phase !== 'lobby') return;
    const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, this.maxTextLen) : '';
    if (!text) return;
    this.room.text = text;
    const event = startNow(this.room, this.now(), this.config);
    if (event) this.broadcast(this.formatStart());
  }

  handleProgress(ws, msg) {
    const id = ws.__lobbyId;
    if (!id) return;
    if (this.room.phase !== 'countdown' && this.room.phase !== 'ticking') return;
    const player = this.room.players.get(id);
    if (!player || player.ghost || player.finished) return;
    const justFinished = this.applyInput(player, msg, this.now());
    if (justFinished) this.broadcast(this.formatFinished(player));
  }

  applyInput(player, msg, now) {
    const len = this.room.text ? this.room.text.length : 0;
    if (!len || typeof msg.index !== 'number' || !Number.isFinite(msg.index)) return false;
    const index = Math.max(0, Math.min(len, Math.floor(msg.index)));
    player.progress = progressFraction(index, len);
    player.wpm = wpmFromIndex(index, now - (this.room.startAt ?? now));
    if (index >= len && !player.finished) {
      player.finished = true;
      player.finishedAt = now;
      player.place = ++this.nextPlace;
      return true;
    }
    return false;
  }

  handleReset(ws) {
    const id = ws.__lobbyId;
    if (!id || id !== this.hostId()) return;
    resetToLobby(this.room);
    this.room.text = '';
    this.nextPlace = 0;
    for (const p of this.room.players.values()) {
      p.progress = 0; p.wpm = 0; p.finished = false; p.finishedAt = null; p.place = null;
    }
    this.broadcast({ type: 'reset' });
    this.broadcast(this.formatLobby());
  }

  async onLeave(ws) {
    const id = ws.__lobbyId;
    if (!id) return;
    leaveRoom(this.room, id, this.now());
    if (this.room.phase === 'lobby') this.broadcast(this.formatLobby());
  }

  // ---- host authority: always "earliest-joined still-connected racer" ----
  // (recomputed, not sticky — Ink Rush's TurfRoomDO.hostId() does the same,
  // so a departed host's authority quietly passes to whoever's next)

  hostId() {
    const ordered = connectedHumans(this.room)
      .slice()
      .sort((a, b) => (a.joinedAt - b.joinedAt) || (a.number - b.number));
    return ordered.length ? ordered[0].id : null;
  }

  wirePhase() {
    return this.room.phase === 'ticking' ? 'racing' : this.room.phase;
  }

  // ---- outbound formatting (external protocol names, not the base class's) --

  publicRacer(p) {
    return { id: p.id, number: p.number, finished: !!p.finished, place: p.place ?? null, wpm: p.wpm || 0 };
  }

  formatJoined(player) {
    return { type: 'joined', you: player.id, hostId: this.hostId(), phase: this.wirePhase() };
  }

  formatLobby() { // -> 'roster'
    return {
      type: 'roster',
      hostId: this.hostId(),
      phase: this.wirePhase(),
      racers: [...this.room.players.values()].map((p) => this.publicRacer(p)),
    };
  }

  formatStart() { // -> 'countdown'
    return { type: 'countdown', startAt: this.room.startAt, text: this.room.text };
  }

  formatState() { // -> 'standings'
    return {
      type: 'standings',
      racers: [...this.room.players.values()].map((p) => ({
        number: p.number,
        progress: Math.round((p.progress || 0) * 1000) / 1000,
        wpm: p.wpm || 0,
        finished: !!p.finished,
        place: p.place ?? null,
      })),
    };
  }

  formatFinished(player) {
    return { type: 'finished', id: player.id, number: player.number, place: player.place, wpm: player.wpm };
  }

  formatFinish() { // -> 'raceOver'
    return { type: 'raceOver', results: computeRaceResults(this.room) };
  }
}

// Re-exported for convenience so a game's tests can drive lobby/leave logic
// against a RaceRoom-shape room without importing tickedLobbyRoom.js too.
export { humans, connectedHumans };
