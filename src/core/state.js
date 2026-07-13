// ============================================================
// SPACE BUILDERS — game state (K-2 free-build edition)
//
// No resources, no power, no tech tiers, no money. Just the set of
// things the kid has placed, a tiny event bus, and a couple of
// derived numbers (space friends) that keep the world feeling alive.
//
// Public API kept identical to what the reused engine modules
// (placement, structures, citizens, vehicles) already import:
//   state, events, gridKey, cellsFor, inBounds,
//   canPlace, place, demolish, buildingAt, recomputeStatics,
//   save, load, hasSave, clearSave
// ============================================================

import { GRID } from './constants.js';
import { BUILDINGS_BY_ID } from './catalog.js';

const SAVE_KEY = 'space-builders-save-v1';

class Emitter {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.map.get(ev).delete(fn);
  }
  emit(ev, data) {
    (this.map.get(ev) || []).forEach(fn => fn(data));
    (this.map.get('*') || []).forEach(fn => fn(ev, data));
  }
}

export const events = new Emitter();

export const state = {
  buildings: [],            // { uid, id, gx, gy, rot }
  grid: new Map(),          // "gx,gy" -> uid
  population: 0,            // eased toward `homes` in the main loop
  homes: 0,                 // total sleeping spots (drives friend count)
  uidCounter: 1,
};

export function gridKey(gx, gy) { return gx + ',' + gy; }

export function cellsFor(def, gx, gy, rot) {
  const [w, d] = (rot % 2 === 1) ? [def.size[1], def.size[0]] : def.size;
  const cells = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < d; y++) cells.push([gx + x, gy + y]);
  return cells;
}

export function inBounds(gx, gy) {
  const half = GRID.SIZE / 2;
  return gx >= -half && gx < half && gy >= -half && gy < half;
}

// The only rules a kid can hit: stay on the moon, and don't stack
// two things on the same square. That's it — no cost, no unlocks.
export function canPlace(defId, gx, gy, rot) {
  const def = BUILDINGS_BY_ID[defId];
  if (!def) return { ok: false, reason: 'unknown' };
  for (const [cx, cy] of cellsFor(def, gx, gy, rot)) {
    if (!inBounds(cx, cy)) return { ok: false, reason: 'Off the edge!' };
    if (state.grid.has(gridKey(cx, cy))) return { ok: false, reason: 'Something is here!' };
  }
  return { ok: true };
}

export function place(defId, gx, gy, rot = 0) {
  const check = canPlace(defId, gx, gy, rot);
  if (!check.ok) return null;
  const def = BUILDINGS_BY_ID[defId];
  const b = { uid: state.uidCounter++, id: defId, gx, gy, rot };
  state.buildings.push(b);
  for (const [cx, cy] of cellsFor(def, gx, gy, rot)) state.grid.set(gridKey(cx, cy), b.uid);
  recomputeStatics();
  events.emit('placed', b);
  return b;
}

export function demolish(uid) {
  const i = state.buildings.findIndex(b => b.uid === uid);
  if (i < 0) return false;
  const b = state.buildings[i];
  const def = BUILDINGS_BY_ID[b.id];
  state.buildings.splice(i, 1);
  for (const [cx, cy] of cellsFor(def, b.gx, b.gy, b.rot)) state.grid.delete(gridKey(cx, cy));
  recomputeStatics();
  events.emit('demolished', b);
  return true;
}

export function clearAll() {
  const removed = state.buildings.slice();
  state.buildings = [];
  state.grid.clear();
  recomputeStatics();
  for (const b of removed) events.emit('demolished', b);
  events.emit('cleared');
}

export function buildingAt(gx, gy) {
  const uid = state.grid.get(gridKey(gx, gy));
  return uid == null ? null : state.buildings.find(b => b.uid === uid) || null;
}

// Total sleeping spots => how many walking astronauts the world wants.
export function recomputeStatics() {
  let homes = 0;
  for (const b of state.buildings) {
    const def = BUILDINGS_BY_ID[b.id];
    if (def) homes += def.homes || 0;
  }
  state.homes = homes;
  events.emit('statics');
}

// ---------------- save / load ----------------

export function save() {
  try {
    const data = {
      v: 1,
      buildings: state.buildings,
      uidCounter: state.uidCounter,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    events.emit('saved');
    return true;
  } catch { return false; }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.buildings = [];
    state.grid.clear();
    state.uidCounter = d.uidCounter || 1;
    for (const b of d.buildings || []) {
      const def = BUILDINGS_BY_ID[b.id];
      if (!def) continue;
      state.buildings.push(b);
      for (const [cx, cy] of cellsFor(def, b.gx, b.gy, b.rot)) state.grid.set(gridKey(cx, cy), b.uid);
    }
    recomputeStatics();
    events.emit('loaded');
    return true;
  } catch { return false; }
}
