// ============================================================
// CITIZENS — little flat-shaded astronauts that make the colony
// feel alive. They walk the path network (walkways / transit tubes)
// building-to-building, or meander near the base when no paths exist.
//
//   export class Citizens { constructor(scene); update(time, dt) }
//
// Population-driven: visible walkers = min(state.population, 24).
// The path graph is rebuilt lazily when the building set changes.
// ============================================================

import * as THREE from 'three';
import { PALETTE } from '../core/constants.js';
import { state, events, cellsFor, gridKey } from '../core/state.js';
import { BUILDINGS_BY_ID } from '../core/catalog.js';
import { terrainHeight } from './terrain.js';
import { cellCenter, buildingCenter } from './structures.js';

const MAX_CITIZENS = 24;
const WALK_SPEED = 1.6;      // world units / second
const WANDER_RANGE = 6;      // meander radius near a building

// ---------- shared geometry (module scope, never disposed) ----------
const G = {
  torso:  new THREE.CylinderGeometry(0.16, 0.20, 0.42, 8),
  helmet: new THREE.IcosahedronGeometry(0.15, 0),
  visor:  new THREE.BoxGeometry(0.17, 0.10, 0.09),
  pack:   new THREE.BoxGeometry(0.20, 0.24, 0.12),
  leg:    new THREE.BoxGeometry(0.09, 0.26, 0.09),
  arm:    new THREE.BoxGeometry(0.08, 0.24, 0.08),
};

// ---------- shared materials (module scope) ----------
const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const helmetMat = mat(PALETTE.hullWhite);
const visorMat  = mat(PALETTE.glassBlue);
const packMat   = mat(PALETTE.hullDark);
const SUIT_MATS = [
  mat(PALETTE.accentOrange),
  mat(PALETTE.accentTeal),
  mat(PALETTE.accentBlue),
  mat(PALETTE.accentYellow),
  mat(PALETTE.hullWhite),
];

// Build one astronaut (~8 meshes, ~1.05 units tall). Faces +z by default.
function buildAstronaut(suitMat) {
  const g = new THREE.Group();

  const torso = new THREE.Mesh(G.torso, suitMat);
  torso.position.y = 0.55;
  g.add(torso);

  const legL = new THREE.Mesh(G.leg, suitMat);
  legL.position.set(-0.08, 0.14, 0);
  const legR = new THREE.Mesh(G.leg, suitMat);
  legR.position.set(0.08, 0.14, 0);
  g.add(legL, legR);

  const armL = new THREE.Mesh(G.arm, suitMat);
  armL.position.set(-0.23, 0.55, 0);
  const armR = new THREE.Mesh(G.arm, suitMat);
  armR.position.set(0.23, 0.55, 0);
  g.add(armL, armR);

  const helmet = new THREE.Mesh(G.helmet, helmetMat);
  helmet.position.y = 0.86;
  g.add(helmet);

  const visor = new THREE.Mesh(G.visor, visorMat);
  visor.position.set(0, 0.86, 0.11);
  g.add(visor);

  const pack = new THREE.Mesh(G.pack, packMat);
  pack.position.set(0, 0.60, -0.15);
  g.add(pack);

  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

// ---------- small math helpers ----------
function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Citizens {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.citizens = [];
    this.spawnTimer = 0;         // gate spawn/remove to one per second

    // path graph
    this.adjacency = new Map();  // key -> [neighborKey,...]
    this.nodeCell = new Map();   // key -> [gx, gy]
    this.nodeKeys = [];
    this.doorKeys = [];
    this.graphDirty = true;
    this.lastBuildCount = -1;

    const mark = () => { this.graphDirty = true; };
    events.on('placed', mark);
    events.on('demolished', mark);
    events.on('loaded', mark);
  }

  // ---------------- graph ----------------
  _addNode(key, gx, gy) {
    if (!this.adjacency.has(key)) {
      this.adjacency.set(key, []);
      this.nodeCell.set(key, [gx, gy]);
    }
  }
  _link(a, b) {
    const la = this.adjacency.get(a);
    if (la && !la.includes(b)) la.push(b);
    const lb = this.adjacency.get(b);
    if (lb && !lb.includes(a)) lb.push(a);
  }

  _buildGraph() {
    this.adjacency.clear();
    this.nodeCell.clear();
    this.doorKeys = [];

    const pathCells = new Set();
    const owner = new Map(); // key -> def

    for (const b of state.buildings) {
      const def = BUILDINGS_BY_ID[b.id];
      if (!def) continue;
      for (const [cx, cy] of cellsFor(def, b.gx, b.gy, b.rot)) {
        const k = gridKey(cx, cy);
        owner.set(k, def);
        if (def.path) pathCells.add(k);
      }
    }

    // path cells become nodes, linked by 4-adjacency
    for (const k of pathCells) {
      const [gx, gy] = k.split(',').map(Number);
      this._addNode(k, gx, gy);
    }
    for (const k of pathCells) {
      const [gx, gy] = this.nodeCell.get(k);
      for (const [dx, dy] of NB) {
        const nk = gridKey(gx + dx, gy + dy);
        if (pathCells.has(nk)) this._link(k, nk);
      }
    }

    // door cells: a non-path building cell 4-adjacent to a path cell
    for (const [k, def] of owner) {
      if (def.path) continue;
      const [gx, gy] = k.split(',').map(Number);
      let isDoor = false;
      for (const [dx, dy] of NB) {
        const nk = gridKey(gx + dx, gy + dy);
        if (pathCells.has(nk)) {
          this._addNode(k, gx, gy);
          this._link(k, nk);
          isDoor = true;
        }
      }
      if (isDoor) this.doorKeys.push(k);
    }

    this.nodeKeys = [...this.adjacency.keys()];
  }

  _bfs(startKey, goalKey) {
    if (startKey === goalKey) return null;
    if (!this.adjacency.has(startKey) || !this.adjacency.has(goalKey)) return null;
    const prev = new Map();
    prev.set(startKey, null);
    const q = [startKey];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === goalKey) break;
      for (const nb of this.adjacency.get(cur)) {
        if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
      }
    }
    if (!prev.has(goalKey)) return null;
    const path = [];
    let n = goalKey;
    while (n !== null) { path.unshift(n); n = prev.get(n); }
    return path;
  }

  _nearestNodeKey(x, z) {
    let best = null, bd = Infinity;
    for (const k of this.nodeKeys) {
      const [gx, gy] = this.nodeCell.get(k);
      const c = cellCenter(gx, gy);
      const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // ---------------- citizen lifecycle ----------------
  _spawn() {
    const suit = SUIT_MATS[(Math.random() * SUIT_MATS.length) | 0];
    const g = buildAstronaut(suit);
    this.group.add(g);

    const c = {
      group: g,
      legL: g.userData.legL,
      legR: g.userData.legR,
      x: 0, z: 0,
      heading: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      seed: Math.random() * 100,
      mode: 'idle',
      timer: Math.random() * 2,
      path: null,
      pathIndex: 0,
      currentKey: null,
      wx: 0, wz: 0,
    };

    // place at a node if we have a graph, else near a random building
    if (this.nodeKeys.length) {
      const k = this.nodeKeys[(Math.random() * this.nodeKeys.length) | 0];
      const [gx, gy] = this.nodeCell.get(k);
      const p = cellCenter(gx, gy);
      c.x = p.x; c.z = p.z; c.currentKey = k;
    } else if (state.buildings.length) {
      const b = state.buildings[(Math.random() * state.buildings.length) | 0];
      const p = buildingCenter(b);
      c.x = p.x + (Math.random() - 0.5) * WANDER_RANGE;
      c.z = p.z + (Math.random() - 0.5) * WANDER_RANGE;
    }
    g.position.set(c.x, terrainHeight(c.x, c.z) + 0.15, c.z);
    this.citizens.push(c);
  }

  _despawn() {
    const c = this.citizens.pop();
    if (c) this.group.remove(c.group);
  }

  _reconcile(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const target = Math.min(state.population | 0, MAX_CITIZENS);
    if (this.citizens.length < target) { this._spawn(); this.spawnTimer = 1; }
    else if (this.citizens.length > target) { this._despawn(); this.spawnTimer = 1; }
  }

  // choose the next thing a citizen does
  _pickJourney(c) {
    if (this.nodeKeys.length > 1) {
      // snap onto the graph if our node vanished
      if (!c.currentKey || !this.adjacency.has(c.currentKey)) {
        c.currentKey = this._nearestNodeKey(c.x, c.z);
      }
      const dests = this.doorKeys.length ? this.doorKeys : this.nodeKeys;
      const destKey = dests[(Math.random() * dests.length) | 0];
      const keys = this._bfs(c.currentKey, destKey);
      if (keys && keys.length > 1) {
        c.path = keys.map((k) => {
          const [gx, gy] = this.nodeCell.get(k);
          return cellCenter(gx, gy);
        });
        c.pathIndex = 1;          // index 0 is where we already stand
        c.destKey = destKey;
        c.mode = 'walk';
        return;
      }
    }
    this._wander(c);
  }

  _wander(c) {
    if (state.buildings.length) {
      const b = state.buildings[(Math.random() * state.buildings.length) | 0];
      const p = buildingCenter(b);
      c.wx = p.x + (Math.random() - 0.5) * 2 * WANDER_RANGE;
      c.wz = p.z + (Math.random() - 0.5) * 2 * WANDER_RANGE;
      c.mode = 'wander';
    } else {
      c.mode = 'idle';
      c.timer = 1 + Math.random() * 2;
    }
  }

  // move a citizen toward (tx,tz); returns true on arrival. Updates heading.
  _moveToward(c, tx, tz, dt) {
    const dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;
    if (dist <= step || dist < 1e-4) { c.x = tx; c.z = tz; return true; }
    c.x += (dx / dist) * step;
    c.z += (dz / dist) * step;
    c.heading = Math.atan2(dx, dz);
    return false;
  }

  _step(c, time, dt) {
    let moving = false;

    if (c.mode === 'walk') {
      moving = true;
      const wp = c.path[c.pathIndex];
      const arrived = this._moveToward(c, wp.x, wp.z, dt);
      c.phase += dt * 9;
      if (arrived) {
        c.pathIndex++;
        if (c.pathIndex >= c.path.length) {
          c.currentKey = c.destKey;
          c.path = null;
          c.mode = 'idle';
          c.timer = 1 + Math.random() * 2;   // pause 1-3s at destination
        }
      }
    } else if (c.mode === 'wander') {
      moving = true;
      const arrived = this._moveToward(c, c.wx, c.wz, dt);
      c.phase += dt * 9;
      if (arrived) { c.mode = 'idle'; c.timer = 1 + Math.random() * 2; }
    } else { // idle
      c.timer -= dt;
      // occasionally "look around"
      c.heading += Math.sin(time * 0.6 + c.seed) * dt * 0.5;
      if (c.timer <= 0) this._pickJourney(c);
    }

    // ---- transform ----
    const groundY = terrainHeight(c.x, c.z) + 0.15;
    const bob = moving ? Math.abs(Math.sin(c.phase)) * 0.08 : 0;
    c.group.position.set(c.x, groundY + bob, c.z);

    c.group.rotation.y = lerpAngle(c.group.rotation.y, c.heading, moving ? 0.18 : 0.06);
    const lean = moving ? 0.12 : 0;
    c.group.rotation.x = THREE.MathUtils.lerp(c.group.rotation.x, lean, 0.12);

    const swing = moving ? Math.sin(c.phase) * 0.5 : 0;
    c.legL.rotation.x = swing;
    c.legR.rotation.x = -swing;
  }

  update(time, dt) {
    if (dt > 0.25) dt = 0.25;   // clamp big frame gaps

    if (this.graphDirty || this.lastBuildCount !== state.buildings.length) {
      this._buildGraph();
      this.lastBuildCount = state.buildings.length;
      this.graphDirty = false;
    }

    this._reconcile(dt);

    for (let i = 0; i < this.citizens.length; i++) {
      this._step(this.citizens[i], time, dt);
    }
  }
}
