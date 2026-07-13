// ============================================================
// VEHICLES — three systems that animate the colony:
//   1. ROVERS    — one per rover_garage (cap 6). Drive the path
//                  network if present, else circle their garage.
//   2. MONORAIL  — >=2 monorail stations link into an elevated
//                  maglev chain with a tram shuttling back and forth.
//   3. SUPPLY POD— on 'arrival', a landing pod descends near the
//                  colony center, sits, then launches away.
//
//   export class Vehicles { constructor(scene); update(time, dt) }
// ============================================================

import * as THREE from 'three';
import { PALETTE } from '../core/constants.js';
import { state, events, cellsFor, gridKey } from '../core/state.js';
import { BUILDINGS_BY_ID } from '../core/catalog.js';
import { terrainHeight } from './terrain.js';
import { cellCenter, buildingCenter } from './structures.js';

const ROVER_CAP = 6;
const ROVER_SPEED = 4;
const TRAM_SPEED = 9;
const TRACK_Y = 3.5;
const PYLON_SPACING = 10;
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- shared materials ----------
const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
const hullGreyMat  = mat(PALETTE.hullGrey);
const hullWhiteMat = mat(PALETTE.hullWhite);
const hullDarkMat  = mat(PALETTE.hullDark);
const orangeMat    = mat(PALETTE.accentOrange);
const blueMat      = mat(PALETTE.accentBlue);
const glowEngineMat = glow(PALETTE.glowEngine);
const beaconMat     = glow(PALETTE.beacon);

// ---------- shared geometry ----------
const RG = {
  body:  new THREE.BoxGeometry(1.3, 0.5, 2.3),
  wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.22, 8),
  mast:  new THREE.BoxGeometry(0.1, 0.9, 0.1),
  cam:   new THREE.BoxGeometry(0.34, 0.2, 0.22),
  bar:   new THREE.BoxGeometry(1.4, 0.14, 0.5),
};
const TG = {
  hull:   new THREE.CapsuleGeometry(0.7, 3.0, 3, 8),
  band:   new THREE.BoxGeometry(1.45, 0.3, 2.4),
  light:  new THREE.IcosahedronGeometry(0.22, 0),
};
const PG = {
  cone:   new THREE.ConeGeometry(0.9, 1.7, 8),
  leg:    new THREE.BoxGeometry(0.1, 0.9, 0.1),
  disc:   new THREE.CylinderGeometry(0.62, 0.62, 0.06, 10),
};

// ------------------------------------------------------------
// Rover model: 6-wheel low-poly buggy. Faces +z. y-origin at wheel axle.
// ------------------------------------------------------------
function buildRover() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(RG.body, hullGreyMat);
  body.position.y = 0.5;
  g.add(body);

  const bar = new THREE.Mesh(RG.bar, orangeMat);
  bar.position.set(0, 0.5, 0.7);
  g.add(bar);

  const wheels = [];
  const zs = [0.8, 0, -0.8];
  for (const z of zs) {
    for (const sx of [-0.72, 0.72]) {
      const w = new THREE.Mesh(RG.wheel, hullDarkMat);
      w.rotation.z = Math.PI / 2;   // axle along x
      w.position.set(sx, 0.34, z);
      g.add(w);
      wheels.push(w);
    }
  }

  const mast = new THREE.Mesh(RG.mast, hullDarkMat);
  mast.position.set(0, 1.1, -0.7);
  g.add(mast);
  const cam = new THREE.Mesh(RG.cam, orangeMat);
  cam.position.set(0, 1.55, -0.7);
  g.add(cam);

  g.userData.wheels = wheels;
  return g;
}

// ------------------------------------------------------------
// Tram model: sleek capsule + window band + front light. Faces +z.
// ------------------------------------------------------------
function buildTram() {
  const g = new THREE.Group();

  const hull = new THREE.Mesh(TG.hull, hullWhiteMat);
  hull.rotation.x = Math.PI / 2;   // lie the capsule along z
  g.add(hull);

  const band = new THREE.Mesh(TG.band, blueMat);
  band.position.y = 0.18;
  g.add(band);

  const light = new THREE.Mesh(TG.light, glowEngineMat);
  light.position.set(0, 0, 1.7);
  g.add(light);

  return g;
}

// ------------------------------------------------------------
// Supply pod: cone body, legs, engine glow disc.
// ------------------------------------------------------------
function buildPod() {
  const g = new THREE.Group();

  const cone = new THREE.Mesh(PG.cone, hullWhiteMat);
  cone.position.y = 1.1;
  g.add(cone);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(PG.leg, hullDarkMat);
    leg.position.set(Math.cos(a) * 0.55, 0.3, Math.sin(a) * 0.55);
    leg.rotation.z = Math.cos(a) * 0.4;
    leg.rotation.x = -Math.sin(a) * 0.4;
    g.add(leg);
  }

  const disc = new THREE.Mesh(PG.disc, glowEngineMat);
  disc.position.y = 0.02;
  g.add(disc);
  g.userData.disc = disc;
  return g;
}

// ---------- math helpers ----------
function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
function smoothstep(t) { return t * t * (3 - 2 * t); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeIn(t) { return t * t * t; }

export class Vehicles {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // ---- rovers + shared path graph ----
    this.rovers = [];
    this.adjacency = new Map();
    this.nodeCell = new Map();
    this.nodeKeys = [];
    this.graphDirty = true;
    this.lastBuildCount = -1;
    this.roversDirty = true;

    // ---- monorail / train ----
    this.railGroup = new THREE.Group();
    this.group.add(this.railGroup);
    this.tram = null;
    this.chain = [];            // [{x,z}] station platform centers
    this.railDirty = true;
    this.railSig = '';
    this.railMode = 'stations'; // 'track' when the kid has laid their own line
    // kid-built track graph
    this.trackAdj = new Map();
    this.trackNodeCell = new Map();
    this.trackNodeKeys = [];
    this.trains = [];

    // ---- supply pod ----
    this.podQueue = 0;
    this.pod = null;
    this.podState = null;       // 'descend' | 'sit' | 'launch'
    this.podT = 0;
    this.podSpot = { x: 0, z: 0, groundY: 0 };

    const structuralMark = () => { this.graphDirty = true; this.roversDirty = true; this.railDirty = true; };
    events.on('placed', structuralMark);
    events.on('demolished', structuralMark);
    events.on('loaded', structuralMark);
    events.on('arrival', () => { if (this.podQueue < 3) this.podQueue++; });
  }

  // ================= path graph (rovers) =================
  _buildGraph() {
    this.adjacency.clear();
    this.nodeCell.clear();

    const pathCells = new Set();
    const owner = new Map();
    for (const b of state.buildings) {
      const def = BUILDINGS_BY_ID[b.id];
      if (!def) continue;
      for (const [cx, cy] of cellsFor(def, b.gx, b.gy, b.rot)) {
        const k = gridKey(cx, cy);
        owner.set(k, def);
        if (def.path) pathCells.add(k);
      }
    }
    const add = (k, gx, gy) => {
      if (!this.adjacency.has(k)) { this.adjacency.set(k, []); this.nodeCell.set(k, [gx, gy]); }
    };
    const link = (a, b) => {
      const la = this.adjacency.get(a); if (la && !la.includes(b)) la.push(b);
      const lb = this.adjacency.get(b); if (lb && !lb.includes(a)) lb.push(a);
    };

    for (const k of pathCells) { const [gx, gy] = k.split(',').map(Number); add(k, gx, gy); }
    for (const k of pathCells) {
      const [gx, gy] = this.nodeCell.get(k);
      for (const [dx, dy] of NB) { const nk = gridKey(gx + dx, gy + dy); if (pathCells.has(nk)) link(k, nk); }
    }
    for (const [k, def] of owner) {
      if (def.path) continue;
      const [gx, gy] = k.split(',').map(Number);
      for (const [dx, dy] of NB) {
        const nk = gridKey(gx + dx, gy + dy);
        if (pathCells.has(nk)) { add(k, gx, gy); link(k, nk); }
      }
    }
    this.nodeKeys = [...this.adjacency.keys()];
  }

  _bfs(startKey, goalKey) {
    if (startKey === goalKey) return null;
    if (!this.adjacency.has(startKey) || !this.adjacency.has(goalKey)) return null;
    const prev = new Map(); prev.set(startKey, null);
    const q = [startKey]; let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === goalKey) break;
      for (const nb of this.adjacency.get(cur)) if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
    if (!prev.has(goalKey)) return null;
    const path = []; let n = goalKey;
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

  // ================= rovers =================
  _reconcileRovers() {
    const garages = state.buildings.filter((b) => BUILDINGS_BY_ID[b.id] && BUILDINGS_BY_ID[b.id].rover);
    const active = new Set();

    for (const b of garages) {
      if (this.rovers.length >= ROVER_CAP && !this.rovers.some((r) => r.garageUid === b.uid)) break;
      active.add(b.uid);
      let r = this.rovers.find((rr) => rr.garageUid === b.uid);
      if (!r) {
        if (this.rovers.length >= ROVER_CAP) continue;
        const g = buildRover();
        this.group.add(g);
        const p = buildingCenter(b);
        r = {
          group: g, wheels: g.userData.wheels, garageUid: b.uid,
          gx: p.x, gz: p.z,
          x: p.x, z: p.z, heading: Math.random() * Math.PI * 2,
          mode: 'circle', angle: Math.random() * Math.PI * 2,
          path: null, pathIndex: 0, currentKey: null, timer: Math.random() * 2, destKey: null,
        };
        g.position.set(r.x, terrainHeight(r.x, r.z) + 0.3, r.z);
        this.rovers.push(r);
      } else {
        const p = buildingCenter(b);
        r.gx = p.x; r.gz = p.z;
      }
    }

    // drop rovers whose garage is gone or beyond cap
    for (let i = this.rovers.length - 1; i >= 0; i--) {
      if (!active.has(this.rovers[i].garageUid)) {
        this.group.remove(this.rovers[i].group);
        this.rovers.splice(i, 1);
      }
    }
  }

  _pickRoverJourney(r) {
    if (this.nodeKeys.length > 1) {
      if (!r.currentKey || !this.adjacency.has(r.currentKey)) r.currentKey = this._nearestNodeKey(r.x, r.z);
      const destKey = this.nodeKeys[(Math.random() * this.nodeKeys.length) | 0];
      const keys = this._bfs(r.currentKey, destKey);
      if (keys && keys.length > 1) {
        r.path = keys.map((k) => { const [gx, gy] = this.nodeCell.get(k); return cellCenter(gx, gy); });
        r.pathIndex = 1;
        r.destKey = destKey;
        r.mode = 'drive';
        return;
      }
    }
    r.mode = 'circle';
  }

  _stepRover(r, dt) {
    let speedTravelled = 0;
    let turning = 0;

    if (r.mode === 'drive') {
      const wp = r.path[r.pathIndex];
      const dx = wp.x - r.x, dz = wp.z - r.z;
      const dist = Math.hypot(dx, dz);
      const step = ROVER_SPEED * dt;
      if (dist <= step || dist < 1e-4) {
        r.x = wp.x; r.z = wp.z;
        r.pathIndex++;
        if (r.pathIndex >= r.path.length) {
          r.currentKey = r.destKey; r.path = null; r.mode = 'idle'; r.timer = 0.5 + Math.random() * 1.5;
        }
        speedTravelled = dist;
      } else {
        r.x += (dx / dist) * step;
        r.z += (dz / dist) * step;
        const targetHeading = Math.atan2(dx, dz);
        turning = lerpAngle(r.heading, targetHeading, 1) - r.heading;
        r.heading = lerpAngle(r.heading, targetHeading, 0.2);
        speedTravelled = step;
      }
    } else if (r.mode === 'circle') {
      const radius = 5;
      r.angle += (ROVER_SPEED / radius) * dt;
      r.x = r.gx + Math.cos(r.angle) * radius;
      r.z = r.gz + Math.sin(r.angle) * radius;
      r.heading = r.angle + Math.PI / 2;
      speedTravelled = ROVER_SPEED * dt;
      turning = 0.15;
      // if a network appears, switch back to driving after a lap point
      if (this.nodeKeys.length > 1 && Math.random() < dt * 0.3) { r.currentKey = null; this._pickRoverJourney(r); }
    } else { // idle
      r.timer -= dt;
      if (r.timer <= 0) this._pickRoverJourney(r);
    }

    // transform
    const y = terrainHeight(r.x, r.z) + 0.3;
    r.group.position.set(r.x, y, r.z);
    r.group.rotation.y = r.heading;
    // slight body tilt on turns
    r.group.rotation.z = THREE.MathUtils.lerp(r.group.rotation.z, -turning * 1.5, 0.15);
    // spin wheels proportional to distance travelled
    const spin = (speedTravelled / 0.34);
    for (let i = 0; i < r.wheels.length; i++) r.wheels[i].rotation.x += spin;
  }

  // ================= monorail =================
  _rebuildMonorail() {
    const stations = state.buildings.filter((b) => BUILDINGS_BY_ID[b.id] && BUILDINGS_BY_ID[b.id].monorail);
    const sig = stations.map((b) => b.uid).join(',');
    if (sig === this.railSig) return;
    this.railSig = sig;

    // clear old track meshes
    while (this.railGroup.children.length) {
      const c = this.railGroup.children.pop();
      c.traverse((o) => { if (o.geometry && o.geometry !== TG.hull && o.geometry !== TG.band && o.geometry !== TG.light) o.geometry.dispose(); });
      this.railGroup.remove(c);
    }

    this.chain = stations.map((b) => { const p = buildingCenter(b); return { x: p.x, z: p.z }; });

    if (this.chain.length < 2) {
      if (this.tram) { this.tram.visible = false; }
      return;
    }

    for (let i = 0; i < this.chain.length - 1; i++) {
      this._buildSegment(this.chain[i], this.chain[i + 1]);
    }

    if (!this.tram) { this.tram = buildTram(); this.group.add(this.tram); }
    this.tram.visible = true;
    // reset tram to first station
    this.tramIdx = 0;
    this.tramDir = 1;
    this.tramFrom = 0;
    this.tramTo = 1;
    this.tramP = 0;
    this.tramPause = 0;
    this.tramDur = this._segDur(0, 1);
  }

  _buildSegment(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;

    // beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, len), hullGreyMat);
    beam.position.set(mx, TRACK_Y, mz);
    beam.rotation.y = ang;
    this.railGroup.add(beam);

    // pylons every ~PYLON_SPACING units
    const count = Math.max(1, Math.round(len / PYLON_SPACING));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const px = a.x + dx * t, pz = a.z + dz * t;
      const base = terrainHeight(px, pz);
      const h = TRACK_Y - base;
      if (h <= 0.2) continue;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.28, h, 0.28), hullDarkMat);
      pylon.position.set(px, base + h / 2, pz);
      this.railGroup.add(pylon);
    }
  }

  _segDur(i, j) {
    const a = this.chain[i], b = this.chain[j];
    return Math.max(0.4, Math.hypot(b.x - a.x, b.z - a.z) / TRAM_SPEED);
  }

  _stepTram(dt) {
    if (!this.tram || this.chain.length < 2) return;

    if (this.tramPause > 0) {
      this.tramPause -= dt;
      const s = this.chain[this.tramIdx];
      this.tram.position.set(s.x, TRACK_Y + 0.55, s.z);
      return;
    }

    this.tramP += dt / this.tramDur;
    if (this.tramP >= 1) {
      this.tramP = 0;
      this.tramIdx = this.tramTo;
      this.tramPause = 2;             // dwell 2s at station
      // pick the next station, bouncing at the ends
      let next = this.tramIdx + this.tramDir;
      if (next < 0 || next >= this.chain.length) { this.tramDir *= -1; next = this.tramIdx + this.tramDir; }
      this.tramFrom = this.tramIdx;
      this.tramTo = next;
      this.tramDur = this._segDur(this.tramFrom, this.tramTo);
      const s = this.chain[this.tramIdx];
      this.tram.position.set(s.x, TRACK_Y + 0.55, s.z);
      return;
    }

    const a = this.chain[this.tramFrom], b = this.chain[this.tramTo];
    const e = smoothstep(this.tramP);          // ease in and out of stops
    const x = a.x + (b.x - a.x) * e;
    const z = a.z + (b.z - a.z) * e;
    this.tram.position.set(x, TRACK_Y + 0.55, z);
    this.tram.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  // ================= kid-built train tracks =================
  // Decide each rebuild whether the train rides the kid's own laid track,
  // or falls back to auto-linking a pair of stations.
  _rebuildRail() {
    this._buildTrackGraph();
    if (this.trackNodeKeys.length >= 2) {
      this.railMode = 'track';
      this._clearRailBeams();     // kid's track pieces are their own visuals
      this.railSig = '';          // force a station rebuild if they switch back
      this._reconcileTrains();
    } else {
      this.railMode = 'stations';
      this._removeTrackTrains();
      this._rebuildMonorail();
    }
  }

  _clearRailBeams() {
    while (this.railGroup.children.length) {
      const c = this.railGroup.children.pop();
      c.traverse((o) => {
        if (o.geometry && o.geometry !== TG.hull && o.geometry !== TG.band && o.geometry !== TG.light) o.geometry.dispose();
      });
      this.railGroup.remove(c);
    }
  }

  // Nodes = every laid track cell, plus station cells that touch track so
  // the train pulls right into the platform.
  _buildTrackGraph() {
    this.trackAdj = new Map();
    this.trackNodeCell = new Map();
    const trackCells = new Set();
    const stationCells = new Set();
    for (const b of state.buildings) {
      const def = BUILDINGS_BY_ID[b.id];
      if (!def) continue;
      if (def.track) for (const [cx, cy] of cellsFor(def, b.gx, b.gy, b.rot)) trackCells.add(gridKey(cx, cy));
      else if (def.monorail) for (const [cx, cy] of cellsFor(def, b.gx, b.gy, b.rot)) stationCells.add(gridKey(cx, cy));
    }
    const add = (k, gx, gy) => {
      if (!this.trackAdj.has(k)) { this.trackAdj.set(k, []); this.trackNodeCell.set(k, [gx, gy]); }
    };
    for (const k of trackCells) { const [gx, gy] = k.split(',').map(Number); add(k, gx, gy); }
    for (const k of stationCells) {
      const [gx, gy] = k.split(',').map(Number);
      if (NB.some(([dx, dy]) => trackCells.has(gridKey(gx + dx, gy + dy)))) add(k, gx, gy);
    }
    const link = (a, b) => {
      const la = this.trackAdj.get(a); if (la && !la.includes(b)) la.push(b);
      const lb = this.trackAdj.get(b); if (lb && !lb.includes(a)) lb.push(a);
    };
    for (const k of this.trackAdj.keys()) {
      const [gx, gy] = this.trackNodeCell.get(k);
      for (const [dx, dy] of NB) { const nk = gridKey(gx + dx, gy + dy); if (this.trackAdj.has(nk)) link(k, nk); }
    }
    this.trackNodeKeys = [...this.trackAdj.keys()];
  }

  // A lone line gets one train; a big sprawling network gets a little fleet.
  _trainCountFor(nodes) {
    return Math.max(1, Math.min(4, 1 + Math.floor((nodes - 2) / 8)));
  }

  _reconcileTrains() {
    if (this.tram) this.tram.visible = false;   // park the station-mode tram
    const want = this._trainCountFor(this.trackNodeKeys.length);

    while (this.trains.length > want) this.group.remove(this.trains.pop().mesh);
    while (this.trains.length < want) {
      const mesh = buildTram();
      this.group.add(mesh);
      // start each train at a different spot around the network
      const idx = Math.floor((this.trains.length / want) * this.trackNodeKeys.length);
      const key = this.trackNodeKeys[idx % this.trackNodeKeys.length];
      const [gx, gy] = this.trackNodeCell.get(key);
      const c = cellCenter(gx, gy);
      this.trains.push({ mesh, currentKey: key, prevKey: null, targetKey: null, x: c.x, z: c.z, heading: 0 });
    }
    // re-seat any train whose track was erased out from under it
    for (const t of this.trains) {
      t.mesh.visible = true;
      if (!this.trackAdj.has(t.currentKey)) {
        const key = this.trackNodeKeys[(Math.random() * this.trackNodeKeys.length) | 0];
        const [gx, gy] = this.trackNodeCell.get(key);
        const c = cellCenter(gx, gy);
        Object.assign(t, { currentKey: key, prevKey: null, targetKey: null, x: c.x, z: c.z });
      }
    }
  }

  _removeTrackTrains() {
    for (const t of this.trains) this.group.remove(t.mesh);
    this.trains = [];
  }

  // Pick the next cell: prefer somewhere free and not an immediate U-turn.
  _pickTrainStep(t, occupied) {
    const neighbors = this.trackAdj.get(t.currentKey) || [];
    if (!neighbors.length) { t.targetKey = null; return; }
    const free = neighbors.filter((k) => !occupied.has(k));
    const notBack = (arr) => arr.filter((k) => k !== t.prevKey);
    let opts = notBack(free);
    if (!opts.length) opts = free;
    if (!opts.length) opts = notBack(neighbors);
    if (!opts.length) opts = neighbors;
    t.targetKey = opts[(Math.random() * opts.length) | 0];
  }

  _stepTrackTrains(dt) {
    if (!this.trains.length) return;
    const occupied = new Set(this.trains.map((t) => t.currentKey));
    for (const t of this.trains) {
      if (!this.trackAdj.has(t.currentKey)) { this._placeTrain(t); continue; }
      const blocked = (k) => k && occupied.has(k) && k !== t.currentKey;
      if (!t.targetKey || !this.trackAdj.has(t.targetKey) || blocked(t.targetKey)) {
        this._pickTrainStep(t, occupied);       // re-route around a train ahead
      }
      if (!t.targetKey || blocked(t.targetKey)) { this._placeTrain(t); continue; } // boxed in → idle
      const [gx, gy] = this.trackNodeCell.get(t.targetKey);
      const c = cellCenter(gx, gy);
      const dx = c.x - t.x, dz = c.z - t.z;
      const dist = Math.hypot(dx, dz);
      const step = TRAM_SPEED * dt;
      if (dist <= step || dist < 1e-4) {
        t.x = c.x; t.z = c.z;
        t.prevKey = t.currentKey;
        occupied.delete(t.currentKey);
        t.currentKey = t.targetKey;
        occupied.add(t.currentKey);
        this._pickTrainStep(t, occupied);
      } else {
        t.x += (dx / dist) * step;
        t.z += (dz / dist) * step;
        t.heading = lerpAngle(t.heading, Math.atan2(dx, dz), 0.25);
      }
      this._placeTrain(t);
    }
  }

  _placeTrain(t) {
    const y = terrainHeight(t.x, t.z) + 3.9;
    t.mesh.position.set(t.x, y, t.z);
    t.mesh.rotation.y = t.heading;
  }

  // ================= supply pod =================
  _findLandingSpot() {
    let target = state.buildings.find((b) => b.id === 'landing_pod')
      || state.buildings.find((b) => b.id === 'command')
      || state.buildings[0];
    let x = 0, z = 0;
    if (target) { const p = buildingCenter(target); x = p.x + 8; z = p.z + 8; }
    this.podSpot.x = x;
    this.podSpot.z = z;
    this.podSpot.groundY = terrainHeight(x, z) + 0.3;
  }

  _stepPod(dt) {
    // launch a queued pod when the pad is clear
    if (!this.pod && this.podQueue > 0) {
      this.podQueue--;
      this._findLandingSpot();
      this.pod = buildPod();
      this.group.add(this.pod);
      this.pod.position.set(this.podSpot.x, 120, this.podSpot.z);
      this.podState = 'descend';
      this.podT = 0;
    }
    if (!this.pod) return;

    const START_Y = 120, LAUNCH_Y = 150;
    if (this.podState === 'descend') {
      this.podT += dt / 4.5;                 // ~4.5s descent
      const t = Math.min(1, this.podT);
      const y = START_Y + (this.podSpot.groundY - START_Y) * easeOut(t);
      this.pod.position.y = y;
      this.pod.userData.disc.material = glowEngineMat;
      this.pod.userData.disc.scale.setScalar(1 + (1 - t) * 1.5);
      if (t >= 1) { this.podState = 'sit'; this.podT = 0; this.pod.userData.disc.scale.setScalar(0.4); }
    } else if (this.podState === 'sit') {
      this.podT += dt;
      if (this.podT >= 4) { this.podState = 'launch'; this.podT = 0; }
    } else if (this.podState === 'launch') {
      this.podT += dt / 3.5;
      const t = Math.min(1, this.podT);
      this.pod.position.y = this.podSpot.groundY + (LAUNCH_Y - this.podSpot.groundY) * easeIn(t);
      this.pod.userData.disc.scale.setScalar(1 + t * 2);
      if (t >= 1) {
        this.group.remove(this.pod);
        this.pod.traverse((o) => { if (o.geometry === PG.cone || o.geometry === PG.leg || o.geometry === PG.disc) { /* shared, keep */ } });
        this.pod = null;
        this.podState = null;
      }
    }
  }

  // ================= main update =================
  update(time, dt) {
    if (dt > 0.25) dt = 0.25;

    if (this.graphDirty || this.lastBuildCount !== state.buildings.length) {
      this._buildGraph();
      this.lastBuildCount = state.buildings.length;
      this.graphDirty = false;
    }
    if (this.roversDirty) { this._reconcileRovers(); this.roversDirty = false; }
    if (this.railDirty) { this._rebuildRail(); this.railDirty = false; }

    for (let i = 0; i < this.rovers.length; i++) this._stepRover(this.rovers[i], dt);
    if (this.railMode === 'track') this._stepTrackTrains(dt);
    else this._stepTram(dt);
    this._stepPod(dt);
  }
}
