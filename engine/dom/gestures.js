// gestures.js — pointer-capture tap-vs-drag, tap-as-drag fallback, and
// two-finger pinch/twist, all Pointer Events only (no HTML5 drag API, per
// house style). tapOrDrag()'s threshold math is k-2outpost's placement.js
// `_downAt` logic; twoFinger()'s dist/angle/mid math is k-2outpost's
// RtsCamera pinch handling, stripped of Three.js/camera specifics down to
// plain deltas any caller can feed into their own zoom/rotate state.
// DOM-only — syntax-checked, not unit-tested (see docs/CONTRACTS.md "Tests").

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

/**
 * Distinguishes a tap from a drag on one element using pointer capture: a
 * pointerdown starts tracking; once movement exceeds `moveThreshold` px, it
 * becomes a drag (onDragStart/onDragMove/onDragEnd fire); otherwise, if
 * released within `timeThreshold` ms, it's a tap (onTap fires). A press held
 * past `timeThreshold` without moving fires neither (matches k-2outpost:
 * a long-press-without-moving is deliberately ignored, not treated as a tap).
 * @param {Element} el
 * @param {{
 *   onTap?: (event: PointerEvent, down: {x:number,y:number,t:number}) => void,
 *   onDragStart?: Function, onDragMove?: Function, onDragEnd?: Function,
 *   moveThreshold?: number, timeThreshold?: number,
 * }} [opts]
 * @returns {() => void} destroy — removes all listeners
 */
export function tapOrDrag(el, { onTap, onDragStart, onDragMove, onDragEnd, moveThreshold = 8, timeThreshold = 400 } = {}) {
  let down = null; // {x, y, t, pointerId}
  let dragging = false;

  function onPointerDown(e) {
    down = { x: e.clientX, y: e.clientY, t: now(), pointerId: e.pointerId };
    dragging = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* not every pointer type supports capture — fine */ }
  }
  function onPointerMove(e) {
    if (!down || down.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (!dragging && dist > moveThreshold) {
      dragging = true;
      if (typeof onDragStart === 'function') onDragStart(e, down);
    }
    if (dragging && typeof onDragMove === 'function') onDragMove(e, down);
  }
  function onPointerUp(e) {
    if (!down || down.pointerId !== e.pointerId) return;
    const elapsed = now() - down.t;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (dragging) {
      if (typeof onDragEnd === 'function') onDragEnd(e, down);
    } else if (elapsed <= timeThreshold && typeof onTap === 'function') {
      onTap(e, down);
    }
    down = null;
    dragging = false;
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  return function destroy() {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
  };
}

/**
 * K-1 fine-motor accommodation: a plain tap/click on `draggable` performs the
 * SAME action as a completed drag (Scoop Troop/Math Arcade convention — every
 * draggable source gets both a real drag and a tap fallback, so a small
 * finger that can't drag precisely still succeeds). Pair this with your own
 * drag implementation (e.g. tapOrDrag or a bespoke one); call
 * `suppressNextClick()` right when your drag genuinely moves, so the
 * pointerup's trailing synthetic click doesn't double-fire onDrop.
 * @param {Element} draggable
 * @param {{onDrop: (event: Event) => void}} opts
 * @returns {{suppressNextClick: (ms?: number) => void}}
 */
export function attachTapFallback(draggable, { onDrop } = {}) {
  let suppressUntil = 0;
  draggable.addEventListener('click', (e) => {
    if (Date.now() < suppressUntil) return; // a real drag just completed — ignore the synthetic click that follows it
    if (typeof onDrop === 'function') onDrop(e);
  });
  return { suppressNextClick(ms = 80) { suppressUntil = Date.now() + ms; } };
}

/**
 * Two-finger pinch (zoom) + twist (rotate) tracking on `el`, framework-
 * agnostic: reports incremental deltas per pointermove, not absolute state,
 * so the caller folds them into whatever zoom/rotation value it already
 * owns (a THREE.Camera, a CSS transform, a Phaser camera zoom...).
 * @param {Element} el
 * @param {(delta: {scale: number, rotateRad: number, dx: number, dy: number, mid: {x:number,y:number}}) => void} cb
 *   `scale` is a multiplier to apply to the current zoom (1 = no change);
 *   `rotateRad` is a radians delta to ADD to the current rotation;
 *   `dx`/`dy` is the two-finger midpoint's on-screen movement, for panning.
 * @returns {() => void} destroy
 */
export function twoFinger(el, cb) {
  const pointers = new Map();
  let last = null; // {dist, angle, mid}

  function snapshot() {
    const pts = [...pointers.values()];
    const [a, b] = pts;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }
  function onDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) last = snapshot();
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size !== 2 || !last) return;
    const cur = snapshot();
    let rotateRad = cur.angle - last.angle;
    if (rotateRad > Math.PI) rotateRad -= Math.PI * 2;
    if (rotateRad < -Math.PI) rotateRad += Math.PI * 2;
    const scale = cur.dist / Math.max(1, last.dist);
    if (typeof cb === 'function') cb({ scale, rotateRad, dx: cur.mid.x - last.mid.x, dy: cur.mid.y - last.mid.y, mid: cur.mid });
    last = cur;
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    last = pointers.size === 2 ? snapshot() : null;
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  return function destroy() {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}
