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
   */
  constructor(ctx, env, options = {}) {
    super(ctx, env);
    this.allowedActs = Array.isArray(options.allowedActs) ? new Set(options.allowedActs) : null;
    this.textFields = Array.isArray(options.textFields) && options.textFields.length
      ? options.textFields
      : DEFAULT_TEXT_FIELDS;
    this.sanitizeText = typeof options.sanitizeText === 'function' ? options.sanitizeText : cleanText;
    this.maxPeers = Number.isInteger(options.maxPeers) ? options.maxPeers : null;
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
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
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
        if (msg.to) this.broadcast({ type: 'sync-state', id: meta.id, to: msg.to, snapshot }, ws);
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
   * Scrubs every item's `textFields` before a snapshot is stored or relayed
   * — a modified client can't plant unfiltered text in the persisted world
   * that every later joiner then receives (the Phase 0.5 wonderglade patch).
   * @param {object} snapshot
   * @returns {object}
   */
  sanitizeSnapshot(snapshot) {
    if (snapshot && Array.isArray(snapshot.items)) {
      snapshot.items = snapshot.items.map((item) => this.sanitizeFields(item));
    }
    return snapshot;
  }
}
