// tickedLobbyRoom.js — TickedLobbyRoom: the Matchmaker shape (voxel type
// src/worker.js:88-342) generalized into a reusable, per-room base class.
// voxel type ran ONE Matchmaker Durable Object as a global singleton
// managing many rooms internally in a `Map`; that's the scalability
// ceiling this class fixes — every room here is its OWN Durable Object
// instance, addressed by `idFromName(roomId)`, so load spreads across
// instances instead of funneling through one.
//
// Split in two layers, WWA's isomorphic-core pattern (shared/gameplay.cjs +
// worker/room.mjs):
//   1. A PURE state machine — plain functions over a plain `room` object and
//      an injected `now`, zero I/O, fully unit-testable without wrangler or
//      real timers (see test/net.tickedLobbyRoom.test.mjs).
//   2. `class TickedLobbyRoom extends RoomDO` — the thin transport: runs the
//      tick loop, wires WebSocket messages to the pure functions, and
//      formats outbound broadcasts. `static HIBERNATION = false` (poison
//      candy's rationale: an active countdown/tick loop wants this DO
//      pinned in memory, not evicted between ticks).
//
// The DO layer ships a Matchmaker-flavored DEFAULT wire protocol (join /
// progress / leave in; joined / lobby / start / state / finish out) so this
// class is immediately useful for a Matchmaker-shape game as-is. A
// different protocol — see raceRoom.js, which speaks the external
// game-multiplayer RaceRoom protocol instead — overrides the `format*`
// methods and `onMessage` while reusing the SAME pure state machine.

import { RoomDO } from './roomDO.js';

// ---------------------------------------------------------------------------
// Pure state machine — no imports, no globals, safe to unit-test directly.
// ---------------------------------------------------------------------------

/** @returns {object} a fresh, empty room in the 'lobby' phase. */
export function createRoom() {
  return {
    phase: 'lobby', // lobby -> countdown -> ticking -> finished
    players: new Map(),
    lobbyEndsAt: null,
    startAt: null,
    endAt: null,
    finishedAt: null,
    results: null,
  };
}

/** @returns {object[]} non-bot entries. */
export function humans(room) {
  return [...room.players.values()].filter((p) => !p.bot);
}

/** @returns {object[]} non-bot entries whose socket is still connected. */
export function connectedHumans(room) {
  return humans(room).filter((p) => p.connected);
}

/**
 * Add a player. Starts the lobby clock the moment the FIRST human joins
 * (Matchmaker: `if (humans(room).length === 1) room.lobbyEndsAt = ...`) —
 * `config.lobbyMs = Infinity` (RaceRoom's host-authority rooms) means the
 * clock is never armed and only `startNow()` can leave the lobby.
 * @param {object} room
 * @param {string} id
 * @param {object} meta  arbitrary game-specific player fields
 * @param {number} now
 * @param {{lobbyMs?: number}} [config]
 * @returns {object} the stored player record
 */
export function joinRoom(room, id, meta, now, config = {}) {
  const player = { id, connected: true, ghost: false, joinedAt: now, ...meta };
  room.players.set(id, player);
  if (room.phase === 'lobby' && room.lobbyEndsAt == null
    && humans(room).length === 1 && !player.bot
    && Number.isFinite(config.lobbyMs)) {
    room.lobbyEndsAt = now + config.lobbyMs;
  }
  return player;
}

/**
 * Remove or ghost a player, depending on phase. In the lobby, leaving frees
 * the seat outright (Matchmaker: nobody's mid-game yet). Anywhere else,
 * GHOST DON'T VANISH (Matchmaker's `leaveRoom`): the entry stays so the room
 * can still resolve/finish, just marked disconnected — a game's
 * `simulateTick`/`isFinished`/`computeResults` decide what a ghost means
 * (freeze in place, count as DNF, etc.).
 * @param {object} room
 * @param {string} id
 * @param {number} now
 * @returns {object|null} the affected player, or null if unknown
 */
export function leaveRoom(room, id, _now) {
  const p = room.players.get(id);
  if (!p) return null;
  if (room.phase === 'lobby') {
    room.players.delete(id);
  } else {
    p.connected = false;
    p.ghost = true;
  }
  return p;
}

/**
 * Force an immediate lobby -> countdown transition regardless of the lobby
 * timer (RaceRoom's host-triggered `start`). No-op outside the lobby phase.
 * @param {object} room
 * @param {number} now
 * @param {{countdownMs?: number, fillWithBots?: (room:object, now:number)=>void}} config
 * @returns {{type: string, startAt: number}|null}
 */
export function startNow(room, now, config = {}) {
  if (room.phase !== 'lobby') return null;
  config.fillWithBots?.(room, now);
  room.phase = 'countdown';
  room.startAt = now + (config.countdownMs ?? 4000);
  return { type: 'countdown', startAt: room.startAt };
}

/**
 * Return every ghosted/disconnected player's seat to the pool and reset the
 * room to a fresh lobby (RaceRoom's host-triggered `reset`, "play again").
 * Connected players stay put — the room is meant to be reused by the same
 * group, not torn down.
 * @param {object} room
 */
export function resetToLobby(room) {
  room.phase = 'lobby';
  room.startAt = null;
  room.endAt = null;
  room.finishedAt = null;
  room.results = null;
  room.lobbyEndsAt = null;
  for (const [id, p] of room.players) {
    if (p.ghost || !p.connected) room.players.delete(id);
  }
}

/**
 * Advance the room by one step. Pure — takes `now` instead of reading the
 * clock — so a test can drive the whole lobby -> countdown -> ticking ->
 * finished sequence with fake time and no real timers.
 * @param {object} room
 * @param {number} now
 * @param {object} config  {lobbyMs, countdownMs, fillWithBots, simulateTick, isFinished, computeResults}
 * @returns {{events: Array<{type: string, [key: string]: *}>}}
 */
export function tick(room, now, config = {}) {
  const events = [];

  if (room.phase === 'lobby') {
    if (room.lobbyEndsAt != null && now >= room.lobbyEndsAt) {
      if (!humans(room).length) {
        events.push({ type: 'empty' });
        return { events };
      }
      const event = startNow(room, now, config);
      if (event) events.push(event);
    }
    return { events };
  }

  if (room.phase === 'countdown') {
    if (now >= room.startAt) {
      room.phase = 'ticking';
      events.push({ type: 'start' });
    }
    return { events };
  }

  if (room.phase === 'ticking') {
    config.simulateTick?.(room, now);
    events.push({ type: 'tick' });
    const everyoneDone = connectedHumans(room).length > 0
      && connectedHumans(room).every((p) => p.finished);
    const done = everyoneDone || !!config.isFinished?.(room, now);
    if (done) {
      room.phase = 'finished';
      room.finishedAt = now;
      room.results = config.computeResults ? config.computeResults(room) : null;
      events.push({ type: 'finish', results: room.results });
    }
    return { events };
  }

  return { events }; // 'finished' — the DO layer decides teardown timing
}

// ---------------------------------------------------------------------------
// DO layer — thin transport wired to the pure functions above.
// ---------------------------------------------------------------------------

const INTERNAL_PLAYER_KEYS = new Set(['connected', 'ghost', 'joinedAt']);

export class TickedLobbyRoom extends RoomDO {
  static HIBERNATION = false;

  /**
   * @param {*} ctx
   * @param {*} env
   * @param {object} [config]
   * @param {number} [config.lobbyMs=8000]  Infinity to disable the auto-timer
   *   entirely and rely on an explicit `start` message instead (RaceRoom)
   * @param {number} [config.countdownMs=4000]
   * @param {number} [config.tickMs=250]
   * @param {number} [config.maxHumans=Infinity]
   * @param {(room:object, now:number) => void} [config.fillWithBots]
   * @param {(room:object, now:number) => void} [config.simulateTick]
   * @param {(room:object, now:number) => boolean} [config.isFinished]
   * @param {(room:object) => object} [config.computeResults]
   */
  constructor(ctx, env, config = {}) {
    super(ctx, env);
    this.config = {
      lobbyMs: config.lobbyMs ?? 8000,
      countdownMs: config.countdownMs ?? 4000,
      tickMs: config.tickMs ?? 250,
      maxHumans: config.maxHumans ?? Infinity,
      fillWithBots: config.fillWithBots,
      simulateTick: config.simulateTick,
      isFinished: config.isFinished,
      computeResults: config.computeResults,
    };
    this.room = createRoom();
    this.ticker = null;
    this.nextId = 0;
  }

  /** @returns {number} overridable clock — tests on the DO layer can stub this. */
  now() { return Date.now(); }

  ensureTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.runTick(), this.config.tickMs);
  }

  stopTicker() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
  }

  runTick() {
    const now = this.now();
    const { events } = tick(this.room, now, this.config);
    for (const event of events) this.handleLobbyEvent(event);
    if (this.room.phase === 'countdown' || this.room.phase === 'ticking') {
      this.broadcast(this.formatState());
    }
    if (this.room.phase === 'finished' || (this.room.phase === 'lobby' && !humans(this.room).length)) {
      this.stopTicker();
    }
  }

  handleLobbyEvent(event) {
    if (event.type === 'countdown') this.broadcast(this.formatStart());
    else if (event.type === 'finish') this.broadcast(this.formatFinish());
  }

  // ---- wire protocol (Matchmaker-flavored default; override freely) ------

  async onMessage(ws, msg, meta) {
    switch (msg.type) {
      case 'join': return this.handleJoin(ws, msg);
      case 'progress': return this.handleInput(ws, msg, meta);
      case 'leave': return this.handleLeaveMessage(ws);
      default: return undefined;
    }
  }

  handleJoin(ws, msg) {
    // One seat per socket: a repeat join from the same socket is answered idempotently with the
    // seat it already has. Without this, the orphaned first entry stays connected:true forever
    // and everyoneDone waits on a phantom racer — the room can never finish.
    if (ws.__lobbyId && this.room.players.has(ws.__lobbyId)) {
      this.send(ws, this.formatJoined(this.room.players.get(ws.__lobbyId)));
      return;
    }
    if (this.room.phase !== 'lobby') {
      // Lobby-only: a countdown/mid-race join would add a racer the finish condition waits on.
      this.send(ws, { type: 'busy', phase: this.room.phase });
      try { ws.close(1013, 'match in progress'); } catch { /* gone */ }
      return;
    }
    if (connectedHumans(this.room).length >= this.config.maxHumans) {
      this.send(ws, { type: 'full' });
      try { ws.close(1013, 'room full'); } catch { /* gone */ }
      return;
    }
    const now = this.now();
    const id = 'p' + (++this.nextId);
    const meta = this.buildPlayer(msg, id);
    const player = joinRoom(this.room, id, meta, now, this.config);
    ws.__lobbyId = id;
    this.send(ws, this.formatJoined(player));
    this.broadcast(this.formatLobby());
    this.ensureTicker();
  }

  /** Builds a new player's game-specific fields from their join message. Override per game. */
  buildPlayer(msg, _id) {
    return { name: String(msg.name || 'Player').slice(0, 16) };
  }

  handleInput(ws, msg, _meta) {
    const id = ws.__lobbyId;
    if (!id) return;
    if (this.room.phase !== 'countdown' && this.room.phase !== 'ticking') return;
    const player = this.room.players.get(id);
    if (!player || player.ghost) return;
    this.applyInput(player, msg, this.now());
  }

  /** Merges one client's self-reported input into their player record. Override per game. */
  applyInput(_player, _msg, _now) { /* no-op by default */ }

  handleLeaveMessage(ws) {
    try { ws.close(1000, 'left'); } catch { /* already closing */ }
  }

  async onLeave(ws) {
    const id = ws.__lobbyId;
    if (!id) return;
    leaveRoom(this.room, id, this.now());
    if (this.room.phase === 'lobby') this.broadcast(this.formatLobby());
  }

  // ---- outbound formatting (override for a different wire protocol) ------

  /** Strips internal bookkeeping fields before a player record goes out over the wire. */
  publicPlayer(p) {
    const out = {};
    for (const key of Object.keys(p)) {
      if (!INTERNAL_PLAYER_KEYS.has(key)) out[key] = p[key];
    }
    return out;
  }

  formatJoined(player) {
    return { type: 'joined', you: player.id };
  }

  formatLobby() {
    return {
      type: 'lobby',
      racers: [...this.room.players.values()].map((p) => this.publicPlayer(p)),
      startsIn: this.room.lobbyEndsAt != null ? Math.max(0, this.room.lobbyEndsAt - this.now()) : null,
    };
  }

  formatStart() {
    return {
      type: 'start',
      racers: [...this.room.players.values()].map((p) => this.publicPlayer(p)),
      startAt: this.room.startAt,
      serverNow: this.now(),
    };
  }

  formatState() {
    return { type: 'state', racers: [...this.room.players.values()].map((p) => this.publicPlayer(p)) };
  }

  formatFinish() {
    return { type: 'finish', results: this.room.results };
  }
}
