// ============================================================
// RTS CAMERA — orbit around a ground target with smooth inertia.
// Mouse: left-drag pan (when not building), right/middle-drag
// rotate, wheel zoom. Touch: 1-finger pan, 2-finger pinch zoom
// + twist rotate. Chromebook & iPad are first-class citizens.
// ============================================================

import * as THREE from 'three';
import { CAMERA } from '../core/constants.js';

export class RtsCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 0, 0);
    this.dist = CAMERA.startDist;
    this.yaw = Math.PI * 0.25;
    this.polar = 0.9;
    // smoothed goals
    this.goal = { target: this.target.clone(), dist: this.dist, yaw: this.yaw, polar: this.polar };
    this.enabled = true;
    this.panLocked = false;   // placement drag can lock panning
    this._pointers = new Map();
    this._pinch = null;
    this._bind();
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType });
      if (this._pointers.size === 2) this._startPinch();
    });
    el.addEventListener('pointermove', e => {
      const p = this._pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this._pointers.size === 1) {
        if (p.button === 2 || p.button === 1) this._rotate(dx, dy);
        else if (!this.panLocked) this._pan(dx, dy);
      } else if (this._pointers.size === 2) {
        this._updatePinch();
      }
    });
    const up = e => {
      this._pointers.delete(e.pointerId);
      this._pinch = null;
      if (this._pointers.size === 2) this._startPinch();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (!this.enabled) return;
      const f = Math.exp(e.deltaY * 0.0012);
      this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * f, CAMERA.minDist, CAMERA.maxDist);
    }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());

    // keyboard pan/rotate for Chromebook keyboards
    this._keys = new Set();
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this._keys.add(e.code);
    });
    window.addEventListener('keyup', e => this._keys.delete(e.code));
  }

  _startPinch() {
    const [a, b] = [...this._pointers.values()];
    this._pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  _updatePinch() {
    if (!this._pinch) return;
    const [a, b] = [...this._pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * (this._pinch.dist / Math.max(1, dist)), CAMERA.minDist, CAMERA.maxDist);
    let da = angle - this._pinch.angle;
    if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
    this.goal.yaw += da;
    this._pan(mid.x - this._pinch.mid.x, mid.y - this._pinch.mid.y);
    this._pinch = { dist, angle, mid };
  }

  _pan(dx, dy) {
    const speed = this.goal.dist * 0.0016;
    const fwd = new THREE.Vector3(Math.sin(this.goal.yaw), 0, Math.cos(this.goal.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.goal.target.addScaledVector(right, dx * speed);
    this.goal.target.addScaledVector(fwd, dy * speed);
    const B = CAMERA.panBound;
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -B, B);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, -B, B);
  }

  _rotate(dx, dy) {
    this.goal.yaw -= dx * 0.005;
    this.goal.polar = THREE.MathUtils.clamp(this.goal.polar + dy * 0.004, CAMERA.minPolar, CAMERA.maxPolar);
  }

  focusOn(x, z, dist = 40) {
    this.goal.target.set(x, 0, z);
    this.goal.dist = dist;
  }

  update(dt, heightAt) {
    // keyboard
    const k = this._keys;
    const ps = 340 * dt;
    if (k.has('KeyW') || k.has('ArrowUp')) this._pan(0, ps);
    if (k.has('KeyS') || k.has('ArrowDown')) this._pan(0, -ps);
    if (k.has('KeyA') || k.has('ArrowLeft')) this._pan(ps, 0);
    if (k.has('KeyD') || k.has('ArrowRight')) this._pan(-ps, 0);
    if (k.has('KeyQ')) this.goal.yaw += 1.6 * dt;
    if (k.has('KeyE')) this.goal.yaw -= 1.6 * dt;

    // smooth toward goals
    const s = 1 - Math.pow(0.0001, dt);
    this.target.lerp(this.goal.target, s);
    this.dist += (this.goal.dist - this.dist) * s;
    this.yaw += (this.goal.yaw - this.yaw) * s;
    this.polar += (this.goal.polar - this.polar) * s;

    const groundY = heightAt ? heightAt(this.target.x, this.target.z) : 0;
    const ty = groundY;
    const px = this.target.x + Math.sin(this.yaw) * Math.sin(this.polar) * this.dist;
    const pz = this.target.z + Math.cos(this.yaw) * Math.sin(this.polar) * this.dist;
    let py = ty + Math.cos(this.polar) * this.dist;
    if (heightAt) py = Math.max(py, heightAt(px, pz) + 4);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.target.x, ty + 2, this.target.z);
  }
}
