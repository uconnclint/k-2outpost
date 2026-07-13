// ============================================================
// STRUCTURES — keeps the 3D scene in sync with game state.
// Listens for placed/demolished/loaded events, builds meshes via
// the content factory, sits them on the terrain with a foundation
// pad, and drives per-building animations.
//
// CONTRACT with src/content/buildings.js:
//   createBuildingMesh(defId) -> THREE.Group
//     - footprint centered on origin: def.size[0]*CELL wide (x),
//       def.size[1]*CELL deep (z), base resting at y = 0
//     - flat-shaded materials from PALETTE only
//     - optional group.userData.animate = (time, dt) => {}
// ============================================================

import * as THREE from 'three';
import { GRID, PALETTE } from '../core/constants.js';
import { BUILDINGS_BY_ID } from '../core/catalog.js';
import { state, events, buildingAt } from '../core/state.js';
import { terrainHeight } from './terrain.js';
import { createBuildingMesh, isConnectionAware } from '../content/buildings.js';

// Neighbor offsets in the same order as the mesh connection bits
// (0=N/-z, 1=E/+x, 2=S/+z, 3=W/-x).
const NEIGHBORS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Which neighbors share this piece's "connect group" (tubes+paths = ground,
// track = rail). Returns a 4-bit mask the mesh factory uses to grow arms.
function connectMask(b) {
  const def = BUILDINGS_BY_ID[b.id];
  const group = def && def.connectGroup;
  if (!group) return 0;
  let mask = 0;
  for (let i = 0; i < 4; i++) {
    const nb = buildingAt(b.gx + NEIGHBORS[i][0], b.gy + NEIGHBORS[i][1]);
    const ndef = nb && BUILDINGS_BY_ID[nb.id];
    if (ndef && ndef.connectGroup === group) mask |= (1 << i);
  }
  return mask;
}

export function cellCenter(gx, gy) {
  return { x: (gx + 0.5) * GRID.CELL, z: (gy + 0.5) * GRID.CELL };
}

export function buildingCenter(b) {
  const def = BUILDINGS_BY_ID[b.id];
  const [w, d] = (b.rot % 2 === 1) ? [def.size[1], def.size[0]] : def.size;
  return { x: (b.gx + w / 2) * GRID.CELL, z: (b.gy + d / 2) * GRID.CELL, w, d };
}

export function footprintHeight(b) {
  const { x, z, w, d } = buildingCenter(b);
  let h = -Infinity;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
    h = Math.max(h, terrainHeight(x + (i - 1) * w * GRID.CELL * 0.45, z + (j - 1) * d * GRID.CELL * 0.45));
  }
  return h;
}

const padMat = new THREE.MeshLambertMaterial({ color: PALETTE.pad, flatShading: true });

export class Structures {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.byUid = new Map();
    this.animated = [];
    events.on('placed', b => this.onPlaced(b));
    events.on('demolished', b => this.onDemolished(b));
    events.on('loaded', () => this.rebuild());
  }

  rebuild() {
    for (const uid of [...this.byUid.keys()]) this.remove(uid);
    // grid is fully populated on load, so every mask is correct first time
    for (const b of state.buildings) this.add(b);
  }

  onPlaced(b) {
    this.add(b);
    this.refreshNeighbors(b);
  }

  onDemolished(b) {
    this.remove(b.uid);
    this.refreshNeighbors(b);
  }

  // Re-draw any connection-aware pieces next to b so their arms update.
  refreshNeighbors(b) {
    const def = BUILDINGS_BY_ID[b.id];
    if (!def) return;
    const [w, d] = (b.rot % 2 === 1) ? [def.size[1], def.size[0]] : def.size;
    const seen = new Set();
    for (let cx = -1; cx <= w; cx++) {
      for (let cy = -1; cy <= d; cy++) {
        // only the ring around the footprint
        if (cx >= 0 && cx < w && cy >= 0 && cy < d) continue;
        const nb = buildingAt(b.gx + cx, b.gy + cy);
        if (!nb || nb.uid === b.uid || seen.has(nb.uid)) continue;
        seen.add(nb.uid);
        if (isConnectionAware(nb.id)) { this.remove(nb.uid); this.add(nb, false); }
      }
    }
  }

  add(b, animate = true) {
    const def = BUILDINGS_BY_ID[b.id];
    const mask = def.connectGroup ? connectMask(b) : 0;
    const mesh = createBuildingMesh(b.id, mask);
    const { x, z, w, d } = buildingCenter(b);
    const y = footprintHeight(b);

    const holder = new THREE.Group();
    holder.position.set(x, y + 0.12, z);
    // paths & track auto-orient to their neighbors, so they ignore rotation
    if (!isConnectionAware(b.id)) mesh.rotation.y = -b.rot * Math.PI / 2;
    holder.add(mesh);

    // foundation pad (skip for ground paths & elevated track)
    if (!def.path && !def.track) {
      const padW = w * GRID.CELL, padD = d * GRID.CELL;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(padW, 1.6, padD), padMat);
      pad.position.y = -0.75;
      holder.add(pad);
    }

    holder.userData.uid = b.uid;
    holder.userData.defId = b.id;
    this.group.add(holder);
    this.byUid.set(b.uid, holder);
    if (mesh.userData.animate) this.animated.push({ uid: b.uid, fn: mesh.userData.animate });

    if (animate) {
      // spawn "landing" pop animation
      holder.scale.setScalar(0.01);
      holder.userData.spawnT = 0;
    }
  }

  remove(uid) {
    const holder = this.byUid.get(uid);
    if (!holder) return;
    this.group.remove(holder);
    holder.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    this.byUid.delete(uid);
    this.animated = this.animated.filter(a => a.uid !== uid);
  }

  update(time, dt) {
    for (const a of this.animated) a.fn(time, dt);
    for (const holder of this.byUid.values()) {
      if (holder.userData.spawnT !== undefined) {
        holder.userData.spawnT += dt * 2.4;
        const t = Math.min(1, holder.userData.spawnT);
        holder.scale.setScalar(0.01 + 0.99 * Math.sin(t * Math.PI * 0.5));
        if (t >= 1) { holder.scale.setScalar(1); delete holder.userData.spawnT; }
      }
    }
  }

  meshFor(uid) { return this.byUid.get(uid); }
}
