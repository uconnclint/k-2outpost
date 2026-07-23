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
import { CE, PRIMARY_SAVE_KEY, LEGACY_SAVE_KEY } from '../engine-bridge.js';

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
// A thin facade over ctx.save (CE.save, see ../engine-bridge.js) that
// keeps the ORIGINAL four functions' exact signatures and true/false
// return contract — main.js's `else if (!load()) newGame();` and
// `if (hasSave()) bootContinue...` still work unmodified.
//
// ctx.save itself already did the hard part at module-eval time (before
// any of these functions are ever called): its own construction-time
// loadFor() checked the primary key, then — only if that was empty —
// space-builders-save-v1 (this file's old raw localStorage key, now the
// LEGACY key, adopted via engine-bridge.js's migrateLegacySave and left
// byte-for-byte untouched in storage, exactly as core/save.js's contract
// promises). CE.save.get() below always returns SOMETHING (real adopted/
// loaded data, or fresh {v:1, buildings:[], uidCounter:1} defaults if
// neither key existed) — it can't by itself distinguish "there really was
// a save" from "these are just the defaults", which is the one thing the
// original raw-localStorage version of these four functions COULD tell
// apart (a present-vs-absent key). hasSave() below is what still answers
// that question, by checking storage directly — same as the original —
// and load()/save() are written to agree with it, not with CE.save.get()'s
// content.
//
// save()/load() are the ONLY place `state` (this module's own plain
// object, `export const` — mutated in place, never reassigned, per every
// other module's live-reference expectations) and ctx.save's live object
// ever exchange data; nothing aliases the two together, so ctx.save's
// own reset()/useSlot() reassigning ITS internal object never orphans
// anything on our side.

export function save() {
  try {
    // patch() + flush() (not just save(), which only SCHEDULES a
    // debounced write) to preserve the original's fully synchronous
    // localStorage.setItem — every caller (the 20s autosave interval,
    // beforeunload, the save-game event) keeps its original "definitely
    // landed before this call returns" guarantee. ctx.save's own
    // pagehide/visibilitychange auto-flush (wired inside core/save.js)
    // becomes a harmless no-op backup on top of this, not a replacement
    // for it — belt and suspenders, per the migration brief.
    CE.save.patch({ v: 1, buildings: state.buildings, uidCounter: state.uidCounter });
    CE.save.flush();
    events.emit('saved');
    return true;
  } catch { return false; }
}

// Checks BOTH storage locations a real prior session could have written
// to — the engine's primary key (where construction-time adoption AND
// every future save() lands) and the pre-engine legacy key (still
// checked so this answers correctly even in the eval-order-agnostic case
// where something asks before ctx.save's own construction-time adoption
// has run). Matches the original's semantics exactly: a raw key-presence
// check, never a content inspection — an empty-but-present save (e.g. a
// kid who broomed away every building right before a session ended)
// still counts as "yes, Keep Building exists", same as before.
export function hasSave() {
  try { return !!(localStorage.getItem(PRIMARY_SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY)); } catch { return false; }
}

// reset() first (clears ctx.save's own live object + any pending timer,
// writing fresh defaults immediately — see core/save.js), THEN
// removeItem() (undoes that immediate write) — order matters: reset()
// itself always writes synchronously, so undoing it has to come second,
// or the key would still exist afterward. Net effect on storage matches
// the original exactly: the primary key goes back to genuinely absent,
// not just present-with-empty-data, so hasSave() reports false again
// until the next real save() — same as a fresh install. The legacy key
// is never touched here (or anywhere) — untouched forever, by design.
export function clearSave() {
  try { CE.save.reset(); } catch { /* ignore */ }
  try { localStorage.removeItem(PRIMARY_SAVE_KEY); } catch { /* ignore */ }
}

export function load() {
  if (!hasSave()) return false; // mirrors the original's `if (!raw) return false;`
  try {
    const d = CE.save.get(); // already adopted-or-loaded by ctx.save's own construction-time logic
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
