// roomClient.js — createRoomClient(): ONE browser WebSocket client to
// replace the three bespoke ones this portfolio grew independently
// (wonderglade `js/multiplayer.js`, voxel type `public/js/race-share.js`
// RaceClient, and KeyQuest/WWA's inline connect logic in their own
// `net.js`/`main.js`). Every one of those reinvented exponential-backoff
// reconnect and message dispatch slightly differently; this file picks one
// behavior and every future MP game gets it for free.
//
// Runs in the browser, but nothing here touches `window`/DOM directly —
// only the `WebSocket` global, which is why `createSocket` (CONTRACTS.md
// rule 3: injectable environment) exists: tests drive this file with a fake
// WebSocket class instead of a real network connection.

/** 1s -> 2s -> 4s -> 8s -> 10s cap — the schedule every audited client shares. */
export const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];

/**
 * Pure lookup: the delay before reconnect attempt N (0-indexed), clamped to
 * the last entry once the schedule runs out. Exported separately so backoff
 * math is testable without spinning up any sockets or timers at all.
 * @param {number} attempt
 * @param {number[]} [schedule]
 * @returns {number}
 */
export function nextBackoffDelay(attempt, schedule = DEFAULT_BACKOFF_MS) {
  const list = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_BACKOFF_MS;
  const i = Math.min(Math.max(0, attempt | 0), list.length - 1);
  return list[i];
}

const OPEN = 1; // WebSocket.OPEN — a literal so this file never depends on a global WebSocket existing

/**
 * @param {object} options
 * @param {string} [options.url]  ws(s):// URL to connect to (ignored if `createSocket` is given)
 * @param {object} [options.join]  payload merged with `{[typeKey]: 'join'}` and
 *   sent right after every open (first connect AND every reconnect) — pass
 *   the SAME values across reconnects for seat-reclaim (WWA's pattern).
 *   Omit if your protocol establishes identity from the URL/upgrade instead.
 * @param {boolean} [options.reconnect=true]
 * @param {number[]} [options.backoffMs]  see `nextBackoffDelay`
 * @param {number} [options.throttleHz=20]  default rate for `throttled()`
 * @param {string} [options.typeKey='type']  message field the dispatcher switches on ('type' or 't')
 * @param {string} [options.identityField='you']  field carrying "your id" on
 *   any incoming message; watched to detect honest re-identification on reconnect
 * @param {() => WebSocket} [options.createSocket]  test seam; defaults to `() => new WebSocket(url)`
 * @param {() => number} [options.now]  test seam; defaults to Date.now
 * @param {(fn: Function, ms: number) => *} [options.setTimeoutFn]  test seam
 * @param {(id: *) => void} [options.clearTimeoutFn]  test seam
 * @param {object} [options.events]  lifecycle: `onOpen()`, `onClose()`,
 *   `onError()`, `onRejoined({sameSeat, you})`; PLUS any message-type key
 *   (e.g. `lobby(msg)`, `finish(msg)`) dispatched by `msg[typeKey]`, and a
 *   catch-all `onMessage(msg)` that always fires alongside the typed one.
 * @returns {{send: Function, throttled: Function, you: *, connected: boolean, close: Function}}
 */
export function createRoomClient(options = {}) {
  const {
    url,
    join = null,
    reconnect: shouldReconnect = true,
    backoffMs = DEFAULT_BACKOFF_MS,
    throttleHz = 20,
    typeKey = 'type',
    identityField = 'you',
    createSocket = () => new WebSocket(url),
    now = () => Date.now(),
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
    events = {},
  } = options;

  let ws = null;
  let closed = false; // caller called close() — stop reconnecting for good
  let attempt = 0;
  let everIdentified = false;
  let you = null;
  let reconnectTimer = null;
  const lastSentAt = new Map();

  function send(msg) {
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }

  /**
   * @param {string} type  value written to `msg[typeKey]`
   * @param {number} [hz]  overrides options.throttleHz for this call site
   * @returns {(payload: object) => void}
   */
  function throttled(type, hz) {
    return (payload = {}) => {
      const t = now();
      const last = lastSentAt.get(type);
      // `last === undefined` means "never sent yet" — always let the FIRST
      // call through. Comparing against a 0 default would wrongly throttle
      // it whenever `now()` itself starts at/near 0 (every fake-clock test).
      if (last !== undefined && t - last < 1000 / (hz || throttleHz)) return;
      lastSentAt.set(type, t);
      send({ [typeKey]: type, ...payload });
    };
  }

  function scheduleReconnect() {
    // Sole gate for the retry loop: every socket-loss path (close event,
    // createSocket() throwing synchronously) funnels through here, so
    // `reconnect: false` and close() hold no matter which path fired.
    if (closed || !shouldReconnect) return;
    const delay = nextBackoffDelay(attempt, backoffMs);
    attempt++;
    reconnectTimer = setTimeoutFn(connect, delay);
  }

  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (identityField in msg) {
      const incoming = msg[identityField];
      // Honest identity handling: only a RECONNECT (not the first-ever
      // identification) can possibly be a different seat, so only fire
      // onRejoined once we've already been identified before.
      if (everIdentified) {
        events.onRejoined?.({ sameSeat: incoming === you, you: incoming });
      }
      you = incoming;
      everIdentified = true;
    }

    const kind = msg[typeKey];
    if (kind != null && typeof events[kind] === 'function') events[kind](msg);
    events.onMessage?.(msg);
  }

  function connect() {
    if (closed) return;
    let socket;
    try {
      socket = createSocket();
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    ws.addEventListener('open', () => {
      attempt = 0;
      if (join) send({ [typeKey]: 'join', ...join });
      events.onOpen?.();
    });

    ws.addEventListener('message', (event) => handleMessage(event.data));

    ws.addEventListener('close', () => {
      ws = null;
      events.onClose?.();
      scheduleReconnect();
    });

    ws.addEventListener('error', () => { events.onError?.(); });
  }

  connect();

  return {
    send,
    throttled,
    get you() { return you; },
    get connected() { return !!ws && ws.readyState === OPEN; },
    /** Stops reconnecting for good and closes the live socket, if any. */
    close() {
      closed = true;
      if (reconnectTimer != null) clearTimeoutFn(reconnectTimer);
      try { ws?.close(); } catch { /* already gone */ }
      ws = null;
    },
  };
}
