// snapshotRelayRoom.js — SnapshotRelayRoom: wonderglade-shape shared-world
// rooms. Wire protocol is kept VERBATIM from wonderglade's worker.js
// (welcome/join/leave/move/state/build/sync-request/sync-state) so an
// already-deployed client migrates with zero protocol changes — see
// wonderglade's `js/multiplayer.js` for the client half of this exact
// exchange and `worker.js` (engine-migration branch) for the server this
// class replaces.
//
// Content safety is this class's DEFAULT behavior, not bolted on after: the
// Phase 0.5 wonderglade patch (server-side sign-text filtering a modified
// client can't bypass, since the client-only `js/typing.js isKind` check
// obviously can be) becomes `sanitizeText`/`textFields` below, applied to
// every 'build' message AND to every item in a persisted world snapshot
// before it's ever stored or relayed to a late joiner.
//
// One deliberate upgrade beyond wonderglade's current literal code: that
// worker uses a plain in-memory `Map` + non-hibernating `server.accept()`
// for its roster. This class instead runs on RoomDO's hibernating default,
// with peer identity riding in `serializeAttachment` — appropriate for a
// persistent shared world that may sit open with sparse activity far longer
// than any single visit (exactly the case hibernation exists for).

import { RoomDO } from './roomDO.js';
import { cleanText } from './moderation.js';

const DEFAULT_TEXT_FIELDS = ['text'];
const SNAPSHOT_KEY = 'snapshot';

export class SnapshotRelayRoom extends RoomDO {
  /**
   * @param {*} ctx
   * @param {*} env
   * @param {object} [options]
   * @param {string[]} [options.allowedActs]  'build' act allowlist (Phase
   *   0.5's `ALLOWED_ACTS`); every act is allowed when omitted
   * @param {string[]} [options.textFields=['text']]  string fields, on a
   *   build message's `data` AND on every persisted snapshot item, run
   *   through `sanitizeText` before they're ever relayed or stored
   * @param {(raw: string) => string} [options.sanitizeText]  defaults to
   *   `moderation.cleanText`
   * @param {number} [options.maxPeers]  no cap by default; a join over the
   *   cap is closed with WebSocket code 1013 ("try again later")
   * @param {number} [options.maxSnapshotItems=4000]  cap on a persisted
   *   snapshot's items array; an over-cap write is rejected whole
   * @param {(item: object) => boolean} [options.validateItem]  per-game item
   *   schema check (kind/coordinates/fields); one failing item rejects the
   *   whole snapshot write — a partial world overwrite is worse than none
   */
  constructor(ctx, env, options = {}) {
    super(ctx, env);
    this.allowedActs = Array.isArray(options.allowedActs) ? new Set(options.allowedActs) : null;
    this.textFields = Array.isArray(options.textFields) && options.textFields.length
      ? options.textFields
      : DEFAULT_TEXT_FIELDS;
    this.sanitizeText = typeof options.sanitizeText === 'function' ? options.sanitizeText : cleanText;
    this.maxPeers = Number.isInteger(options.maxPeers) ? options.maxPeers : null;
    this.maxSnapshotItems = Number.isInteger(options.maxSnapshotItems) ? options.maxSnapshotItems : 4000;
    this.validateItem = typeof options.validateItem === 'function' ? options.validateItem : null;
  }

  async onJoin(ws, _meta, _request) {
    // fetch() has already accepted `ws`, so peerCount() already counts it —
    // '>' (not '>=') is the correct "this join pushed us over the cap" test.
    if (this.maxPeers != null && this.peerCount() > this.maxPeers) {
      try { ws.close(1013, 'room full'); } catch { /* already gone */ }
      return;
    }
    const id = crypto.randomUUID();
    const player = { id, x: 0, y: 0 };
    ws.serializeAttachment(player);
    const saved = await this.ctx.storage.get(SNAPSHOT_KEY);
    this.send(ws, {
      type: 'welcome',
      you: id,
      players: this.peers().map(({ meta }) => meta).filter((m) => m && m.id),
      snapshot: saved?.snapshot || null,
      snapshotUpdatedAt: saved?.updatedAt || 0,
    });
    this.broadcast({ type: 'join', id, x: 0, y: 0 }, ws);
  }

  async onMessage(ws, msg, meta) {
    if (!meta || !meta.id) return; // onJoin hasn't finished / attachment missing
    switch (msg.type) {
      case 'move': {
        // `Number(v) || 0` lets Infinity through (truthy) — finite or nothing.
        const x = Number.isFinite(Number(msg.x)) ? Number(msg.x) : 0;
        const y = Number.isFinite(Number(msg.y)) ? Number(msg.y) : 0;
        ws.serializeAttachment({ ...meta, x, y });
        this.broadcast({ type: 'state', id: meta.id, x, y }, ws);
        return;
      }
      case 'build': {
        if (this.allowedActs && !this.allowedActs.has(msg.act)) return;
        const data = this.sanitizeFields(msg.data);
        this.broadcast({ type: 'build', id: meta.id, act: msg.act, data }, ws);
        return;
      }
      case 'sync-request': {
        const stored = await this.ctx.storage.get(SNAPSHOT_KEY);
        if (stored?.snapshot) {
          this.send(ws, {
            type: 'sync-state',
            id: 'room',
            to: meta.id,
            snapshot: stored.snapshot,
            snapshotUpdatedAt: stored.updatedAt || 0,
          });
        }
        this.broadcast({ type: 'sync-request', id: meta.id }, ws);
        return;
      }
      case 'sync-state': {
        const snapshot = msg.snapshot ? this.sanitizeSnapshot(msg.snapshot) : null;
        if (snapshot) await this.ctx.storage.put(SNAPSHOT_KEY, { snapshot, updatedAt: Date.now() });
        // An invalid snapshot is dropped outright — never persisted, never relayed (a peer
        // answering a sync-request with garbage just goes unanswered, same as having none).
        if (msg.to && snapshot) this.broadcast({ type: 'sync-state', id: meta.id, to: msg.to, snapshot }, ws);
        return;
      }
      default:
        return;
    }
  }

  async onLeave(_ws, meta) {
    if (meta && meta.id) this.broadcast({ type: 'leave', id: meta.id });
  }

  /**
   * Runs every configured `textFields` entry present on `data` through
   * `sanitizeText`. Returns a shallow copy; never mutates the input.
   * @param {object} data
   * @returns {object}
   */
  sanitizeFields(data) {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    for (const field of this.textFields) {
      if (typeof out[field] === 'string') out[field] = this.sanitizeText(out[field]);
    }
    return out;
  }

  /**
   * Validates a snapshot's shape and scrubs every item's `textFields` before it is stored or
   * relayed — a modified client can't plant unfiltered text OR arbitrary junk in the persisted
   * world that every later joiner then receives (the Phase 0.5 wonderglade patch, extended).
   * The shape contract: a plain object with an `items` array of plain objects, at most
   * `maxSnapshotItems` long, every item passing `validateItem` when configured. Anything else
   * answers null — the caller drops the write whole rather than persisting a partial world.
   * Never mutates the input.
   * @param {object} snapshot
   * @returns {object|null} a sanitized copy, or null when rejected
   */
  sanitizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    if (!Array.isArray(snapshot.items)) return null;
    if (snapshot.items.length > this.maxSnapshotItems) return null;
    const items = [];
    for (const item of snapshot.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      if (this.validateItem && !this.validateItem(item)) return null;
      items.push(this.sanitizeFields(item));
    }
    return { ...snapshot, items };
  }
}
