// roomDO.js — RoomDO: the base Durable Object every net/ room class extends.
// Generalizes the plumbing every audited backend hand-rolled (voxel type,
// wonderglade, poison candy, KeyQuest, Ink Rush, Word Wizard Arena): a peer
// roster, safe broadcast (one dead socket never throws for the room), safe
// message parsing (oversized/malformed frames are dropped, not crashes),
// and an opt-in idle self-destruct alarm.
//
// Hibernation API by default (Ink Rush's turf-room.js + WWA's worker/
// room.mjs): `ctx.acceptWebSocket()` lets the runtime evict this DO between
// messages and revive it on the next one, with peer identity riding along
// in `serializeAttachment`/`deserializeAttachment` instead of living only in
// memory. A subclass with an in-memory tick loop sets `static HIBERNATION =
// false` and gets the classic `server.accept()` + event-listener API
// instead — poison candy's deliberate rationale: an active match wants this
// DO PINNED in memory for its duration; hibernation would let the runtime
// evict it (and the live board/score state) between any two messages.
//
// `import { DurableObject } from 'cloudflare:workers'` only resolves inside
// the Workers runtime — a bare top-level import of it would make this
// entire file (and everything that subclasses RoomDO) impossible to import
// from plain `node:test` (CONTRACTS.md rule 3: "import must never throw in
// node"). So the real base class is resolved lazily, the same dynamic-
// import-with-fallback shape context.js already uses for audio/speech/
// feedback: in the Workers runtime `RoomDO` really extends `DurableObject`;
// under plain node (or any environment without that module) it extends a
// harmless empty class instead. Either way, `RoomDO`'s own logic below
// never depends on anything `DurableObject` actually provides beyond the
// `(ctx, env)` constructor shape every subclass already receives from the
// runtime.

/** Resolves the real `DurableObject` class inside Workers, or a harmless stand-in elsewhere. */
export async function resolveDurableObjectBase() {
  try {
    const mod = await import('cloudflare:workers');
    if (mod && mod.DurableObject) return mod.DurableObject;
  } catch {
    // Not running in a Workers runtime (plain node, node:test) — fall through.
  }
  return class {};
}

const DurableObjectBase = await resolveDurableObjectBase();

/** Default cap for one incoming message; oversized frames are dropped silently. */
export const MAX_MSG_BYTES = 64 * 1024;

/**
 * Parse a raw WebSocket message as JSON, defensively. Returns `undefined`
 * (never throws) for anything oversized, non-string, or unparsable — every
 * audited backend treats a bad message as silently ignorable, not a reason
 * to kill the connection or crash the room.
 * @param {*} raw
 * @param {number} [maxBytes]
 * @returns {object|undefined}
 */
export function safeParse(raw, maxBytes = MAX_MSG_BYTES) {
  if (typeof raw !== 'string' || raw.length > maxBytes) return undefined;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

// A peer's metadata rides in its WebSocket attachment under the Hibernation
// API; a non-hibernating room never calls serializeAttachment, so this
// always degrades to `{}` rather than throwing.
function readAttachment(ws) {
  try {
    return (typeof ws.deserializeAttachment === 'function' ? ws.deserializeAttachment() : null) || {};
  } catch {
    return {};
  }
}

export class RoomDO extends DurableObjectBase {
  static HIBERNATION = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    // Only populated (and only meaningful) in non-hibernating mode; a
    // hibernating room uses ctx.getWebSockets() as the sole source of truth.
    this._sockets = new Set();
  }

  // ---- roster ------------------------------------------------------------

  /** @returns {WebSocket[]} every live socket in this room, either mode. */
  sockets() {
    return this.constructor.HIBERNATION ? this.ctx.getWebSockets() : [...this._sockets];
  }

  /** @returns {Array<{ws: WebSocket, meta: object}>} live sockets + their attached metadata. */
  peers() {
    return this.sockets().map((ws) => ({ ws, meta: readAttachment(ws) }));
  }

  /** @returns {number} */
  peerCount() {
    return this.sockets().length;
  }

  // ---- messaging -----------------------------------------------------------

  /**
   * JSON-stringify once, send to every peer except `exceptWs`. One dead
   * socket's send() throwing never takes down the room (the universal
   * audited pattern — every source backend does this per-socket try/catch).
   * @param {object} msg
   * @param {WebSocket} [exceptWs]
   */
  broadcast(msg, exceptWs) {
    const raw = JSON.stringify(msg);
    for (const ws of this.sockets()) {
      if (ws === exceptWs) continue;
      try { ws.send(raw); } catch { /* that peer is gone; everyone else still gets it */ }
    }
  }

  /** Send to exactly one socket; swallows a dead-socket throw same as broadcast(). */
  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* gone */ }
  }

  // ---- upgrade handshake ---------------------------------------------------

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (this.constructor.HIBERNATION) {
      this.ctx.acceptWebSocket(server);
    } else {
      server.accept();
      this._sockets.add(server);
      server.addEventListener('message', (event) => { this._onRawMessage(server, event.data); });
      server.addEventListener('close', () => { this._onRawClose(server, false); });
      server.addEventListener('error', () => { this._onRawClose(server, true); });
    }

    await this.onJoin?.(server, readAttachment(server), request);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation API entry points — the Workers runtime calls these directly
  // on a revived DO instance; they never go through fetch()'s addEventListener
  // path (that path only exists for the non-hibernating branch above).
  async webSocketMessage(ws, raw) { await this._onRawMessage(ws, raw); }
  async webSocketClose(ws, _code, _reason, wasClean) { await this._onRawClose(ws, !wasClean); }
  async webSocketError(ws) { await this._onRawClose(ws, true); }

  async _onRawMessage(ws, raw) {
    const msg = safeParse(raw, this.maxMsgBytes ?? MAX_MSG_BYTES);
    if (msg === undefined) return; // oversized or malformed — silently dropped
    await this.onMessage?.(ws, msg, readAttachment(ws));
  }

  async _onRawClose(ws, wasError) {
    if (!this.constructor.HIBERNATION) this._sockets.delete(ws);
    await this.onLeave?.(ws, readAttachment(ws), wasError);
  }

  // ---- idle self-destruct (opt-in; KeyQuest's TandemRoom recycle pattern) --

  /** Arms (or re-arms) the alarm `ms` from now. Call again on any activity to push it back. */
  async armIdleAlarm(ms) {
    await this.ctx.storage.setAlarm(Date.now() + ms);
  }

  /**
   * Closes every socket and wipes all storage — call this from a subclass's
   * `alarm()` once it's decided the room really is idle. Not wired up
   * automatically: a subclass with its OWN alarm-driven game timers must
   * decide when "idle" applies instead of every alarm meaning "destroy".
   * @param {string} [reason]
   */
  async closeIdleRoom(reason = 'idle') {
    for (const ws of this.sockets()) {
      try { ws.close(1001, reason); } catch { /* already gone */ }
    }
    await this.ctx.storage.deleteAll();
  }
}
