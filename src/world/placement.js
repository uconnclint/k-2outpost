// ============================================================
// PLACEMENT TOOL — ghost preview, grid snap, drag-painting for
// paths, demolish mode, tap-to-select. Works with mouse & touch.
// ============================================================

import * as THREE from 'three';
import { GRID, PALETTE } from '../core/constants.js';
import { BUILDINGS_BY_ID } from '../core/catalog.js';
import { state, canPlace, place, demolish, buildingAt, events } from '../core/state.js';
import { terrainHeight } from './terrain.js';
import { createBuildingMesh } from '../content/buildings.js';

const ghostOk = new THREE.MeshLambertMaterial({ color: PALETTE.accentTeal, transparent: true, opacity: 0.55, flatShading: true, depthWrite: false });
const ghostBad = new THREE.MeshLambertMaterial({ color: PALETTE.accentRed, transparent: true, opacity: 0.55, flatShading: true, depthWrite: false });

export class PlacementTool {
  constructor(scene, camera, dom, rtsCam) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.rtsCam = rtsCam;
    this.mode = 'idle';       // idle | build | demolish
    this.defId = null;
    this.rot = 0;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ghost = null;
    this.gridPos = null;      // {gx, gy}
    this.valid = false;
    this.dragging = false;
    this.dragPlaced = new Set();
    this._downAt = null;

    this.cursor = this._makeCursor();
    scene.add(this.cursor);
    this.cursor.visible = false;

    this._bind();
    events.on('demolished', () => this._refreshGhost());
  }

  _makeCursor() {
    // glowing grid square that follows the pointer in build mode
    const g = new THREE.Group();
    return g;
  }

  setBuild(defId) {
    this.clear();
    this.mode = 'build';
    this.defId = defId;
    this.rot = 0;
    this._makeGhost();
    events.emit('tool', { mode: 'build', defId });
  }

  setDemolish() {
    this.clear();
    this.mode = 'demolish';
    events.emit('tool', { mode: 'demolish' });
  }

  clear() {
    this.mode = 'idle';
    this.defId = null;
    this.dragging = false;
    this.rtsCam.panLocked = false;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    events.emit('tool', { mode: 'idle' });
  }

  rotate() {
    if (this.mode !== 'build') return;
    this.rot = (this.rot + 1) % 4;
    if (this.ghost) this.ghost.rotation.y = -this.rot * Math.PI / 2;
    this._refreshGhost();
  }

  _makeGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    const mesh = createBuildingMesh(this.defId);
    mesh.traverse(o => { if (o.isMesh) { o.material = ghostOk; } });
    this.ghost = mesh;
    this.ghost.rotation.y = -this.rot * Math.PI / 2;
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', e => {
      this._downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.mode === 'build' && this.defId) {
        // validate the spot under this very first press so a drag that
        // starts without any prior pointer-move (e.g. a touch) still paints
        this._updatePointer(e);
        const def = BUILDINGS_BY_ID[this.defId];
        if (def.dragPlace && e.button === 0 && this.valid) {
          this.dragging = true;
          this.dragPlaced.clear();
          this.rtsCam.panLocked = true;
          this._tryPlaceAtPointer(e);
        }
      }
    });
    el.addEventListener('pointermove', e => {
      this._updatePointer(e);
      if (this.dragging) this._tryPlaceAtPointer(e);
    });
    el.addEventListener('pointerup', e => {
      const wasDrag = this._downAt && (Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y) > 8 ||
        performance.now() - this._downAt.t > 400);
      if (this.dragging) {
        this.dragging = false;
        this.rtsCam.panLocked = false;
        this._downAt = null;
        return;
      }
      if (e.button !== 0 || wasDrag) { this._downAt = null; return; }
      this._downAt = null;
      this._onTap(e);
    });
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyR') this.rotate();
      if (e.code === 'Escape') { this.clear(); events.emit('select', null); }
      if (e.code === 'Delete' || e.code === 'KeyX') this.setDemolish();
    });
  }

  _pickGrid(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, pt)) return null;
    return pt;
  }

  _updatePointer(e) {
    if (this.mode !== 'build' || !this.ghost) return;
    const pt = this._pickGrid(e);
    if (!pt) { this.ghost.visible = false; return; }
    const def = BUILDINGS_BY_ID[this.defId];
    const [w, d] = (this.rot % 2 === 1) ? [def.size[1], def.size[0]] : def.size;
    const gx = Math.round(pt.x / GRID.CELL - w / 2);
    const gy = Math.round(pt.z / GRID.CELL - d / 2);
    this.gridPos = { gx, gy };
    this._refreshGhost();
  }

  _refreshGhost() {
    if (this.mode !== 'build' || !this.ghost || !this.gridPos) return;
    const def = BUILDINGS_BY_ID[this.defId];
    const { gx, gy } = this.gridPos;
    const [w, d] = (this.rot % 2 === 1) ? [def.size[1], def.size[0]] : def.size;
    const cx = (gx + w / 2) * GRID.CELL;
    const cz = (gy + d / 2) * GRID.CELL;
    const y = terrainHeight(cx, cz);
    this.ghost.position.set(cx, y + 0.2, cz);
    this.ghost.visible = true;
    const check = canPlace(this.defId, gx, gy, this.rot);
    this.valid = check.ok;
    this.reason = check.reason;
    const mat = check.ok ? ghostOk : ghostBad;
    this.ghost.traverse(o => { if (o.isMesh) o.material = mat; });
  }

  _tryPlaceAtPointer(e) {
    this._updatePointer(e);
    if (!this.gridPos || !this.valid) return;
    const key = this.gridPos.gx + ',' + this.gridPos.gy;
    if (this.dragPlaced.has(key)) return;
    const b = place(this.defId, this.gridPos.gx, this.gridPos.gy, this.rot);
    if (b) {
      this.dragPlaced.add(key);
      this._refreshGhost();
    }
  }

  _onTap(e) {
    if (this.mode === 'build' && this.defId) {
      this._updatePointer(e);
      if (this.valid && this.gridPos) {
        place(this.defId, this.gridPos.gx, this.gridPos.gy, this.rot);
        this._refreshGhost();
        // Kids stay in build mode so they can tap-tap-tap and place lots.
        // They leave build mode with the Move button, tapping the card
        // again, or Escape.
      } else if (this.reason) {
        events.emit('place-failed', this.reason);
      }
      return;
    }
    // select / demolish
    const pt = this._pickGrid(e);
    if (!pt) return;
    const gx = Math.floor(pt.x / GRID.CELL);
    const gy = Math.floor(pt.z / GRID.CELL);
    const b = buildingAt(gx, gy);
    if (this.mode === 'demolish') {
      if (b) demolish(b.uid);
      return;
    }
    events.emit('select', b);
  }
}
