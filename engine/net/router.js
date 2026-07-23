// router.js — tiny fetch-router helpers shared by every net/ worker entry
// point: the WebSocket-upgrade guard, the "look up this DO by name and
// forward the request" one-liner, and a path-param matcher, each hand-rolled
// slightly differently in every audited worker.js (voxel type, KeyQuest,
// poison candy, wonderglade, Ink Rush, WWA). None of this is net/-specific
// plumbing — it's just enough to keep a game's own worker.js entry point
// (see templates/race-worker/worker.js for a worked example) a short,
// readable dispatch table instead of another hand-rolled URL-matching maze.

/**
 * @param {Request} request
 * @returns {boolean}
 */
export function isWebSocketUpgrade(request) {
  return request.headers.get('Upgrade') === 'websocket';
}

/**
 * The standard 426 response for a WebSocket-only route hit without an
 * upgrade header (every audited worker returns exactly this).
 * @param {string} [message]
 * @returns {Response}
 */
export function expectUpgrade(message = 'Expected a WebSocket upgrade') {
  return new Response(message, { status: 426 });
}

/**
 * Forward `request` to the Durable Object instance named `name` within
 * `namespace` — the one-line `.idFromName(name)` -> `.get(id)` -> `.fetch()`
 * chain every audited worker repeats for each route.
 * @param {DurableObjectNamespace} namespace
 * @param {string} name
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export function dispatchToRoom(namespace, name, request) {
  const id = namespace.idFromName(name);
  return namespace.get(id).fetch(request);
}

/**
 * Extract the single capture group from a path pattern, or null if it
 * doesn't match — e.g. `routeParam(/^\/race\/([A-Za-z0-9]{3,8})$/, url.pathname)`.
 * @param {RegExp} pattern  must contain exactly one capture group
 * @param {string} pathname
 * @returns {string|null}
 */
export function routeParam(pattern, pathname) {
  const m = pathname.match(pattern);
  return m ? m[1] : null;
}

/**
 * The `GET /health -> {ok:true}` connectivity probe every audited worker
 * exposes — the first thing to open on a device that can't reach the server
 * at all, per poison candy's worker/src/index.js comment on the same route.
 * @returns {Response}
 */
export function healthCheck() {
  return Response.json({ ok: true });
}
