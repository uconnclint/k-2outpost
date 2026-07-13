// ============================================================
// EFFECTS — the "wow" bits for little builders.
//   • sparkle burst  — pops when you place something
//   • rocket blast    — a rocket roars up off the pad with a
//                       glittery trail when you tap BLAST OFF
//
// All procedural, all flat-shaded / glowing to match the world.
// Effects self-remove when finished; call update(dt) each frame.
// ============================================================

import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

const SPARKLE_COLORS = [0xffd166, 0x06d6a0, 0x4d96ff, 0xef476f, 0xffffff, 0xffca3a];
const sparkGeo = new THREE.OctahedronGeometry(0.32, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.live = [];   // each: { obj, update(dt) -> stillAlive }
  }

  // ---- confetti-ish burst of little glowing gems ----
  sparkle(x, y, z, opts = {}) {
    const count = opts.count || 16;
    const spread = opts.spread || 3.2;
    const burst = new THREE.Group();
    burst.position.set(x, y, z);
    this.group.add(burst);

    const bits = [];
    for (let i = 0; i < count; i++) {
      const color = SPARKLE_COLORS[(Math.random() * SPARKLE_COLORS.length) | 0];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const m = new THREE.Mesh(sparkGeo, mat);
      const s = 0.4 + Math.random() * 0.7;
      m.scale.setScalar(s);
      const ang = Math.random() * Math.PI * 2;
      const up = 2.5 + Math.random() * 4.5;
      const out = (0.6 + Math.random()) * spread;
      bits.push({
        m,
        vx: Math.cos(ang) * out,
        vy: up,
        vz: Math.sin(ang) * out,
        spin: (Math.random() - 0.5) * 12,
        s0: s,
      });
      burst.add(m);
    }

    let t = 0;
    const life = 0.9;
    this.live.push({
      obj: burst,
      update: (dt) => {
        t += dt;
        const k = t / life;
        for (const b of bits) {
          b.vy -= 9 * dt;               // gravity
          b.m.position.x += b.vx * dt;
          b.m.position.y += b.vy * dt;
          b.m.position.z += b.vz * dt;
          b.m.rotation.x += b.spin * dt;
          b.m.rotation.y += b.spin * dt;
          b.m.scale.setScalar(Math.max(0, b.s0 * (1 - k)));
          b.m.material.opacity = Math.max(0, 1 - k);
        }
        if (t >= life) {
          burst.traverse(o => { if (o.material) o.material.dispose(); });
          this.group.remove(burst);
          return false;
        }
        return true;
      },
    });
  }

  // ---- a chunky rocket that blasts off with a sparkle trail ----
  launchRocket(x, z, onDone) {
    const groundY = terrainHeight(x, z);
    const rocket = buildRocket();
    rocket.scale.setScalar(1.5);          // big enough for little eyes
    rocket.position.set(x, groundY, z);
    this.group.add(rocket);
    const flame = rocket.userData.flame;

    // a little countdown pause on the pad, then it climbs
    let t = 0;
    const hold = 0.5;             // sit-and-rumble before liftoff
    const rise = 4.0;             // seconds to sail up out of sight
    const topY = 120;
    let trailTimer = 0;
    this.live.push({
      obj: rocket,
      update: (dt) => {
        t += dt;
        // flame always flickers
        const f = 0.8 + Math.random() * 0.7;
        flame.scale.set(f, 0.9 + Math.random() * 1.0, f);

        if (t < hold) {
          // rumble on the pad
          rocket.position.x = x + (Math.random() - 0.5) * 0.15;
          rocket.position.z = z + (Math.random() - 0.5) * 0.15;
          return true;
        }
        const k = (t - hold) / rise;
        const climb = topY * (k * k * 0.85 + k * 0.15);   // slow off the pad, then GO
        rocket.position.set(x, groundY + climb, z);
        rocket.rotation.y += dt * 1.4;
        // fat glitter trail
        trailTimer -= dt;
        if (trailTimer <= 0 && k < 0.9) {
          trailTimer = 0.04;
          this.sparkle(rocket.position.x, rocket.position.y - 1.2, rocket.position.z, { count: 7, spread: 1.6 });
        }
        if (k >= 1) {
          rocket.traverse(o => { if (o.geometry) o.geometry.dispose(); });
          this.group.remove(rocket);
          if (onDone) onDone();
          return false;
        }
        return true;
      },
    });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (!this.live[i].update(dt)) this.live.splice(i, 1);
    }
  }
}

// A friendly little rocket (~5 units tall). Faces up.
function buildRocket() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe8eaf0, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0xef476f, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a4e5c, flatShading: true });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffca3a });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, flatShading: true });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 3.4, 10), white);
  body.position.y = 2.4;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.4, 10), red);
  nose.position.y = 4.8;
  g.add(nose);

  const window = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), glassMat);
  window.position.set(0, 3.2, 0.72);
  g.add(window);

  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 0.9), red);
    fin.position.set(Math.cos(a) * 0.85, 1.1, Math.sin(a) * 0.85);
    fin.rotation.y = -a;
    g.add(fin);
  }

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 0.5, 10), dark);
  nozzle.position.y = 0.5;
  g.add(nozzle);

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.0, 8), flameMat);
  flame.rotation.x = Math.PI;   // point down
  flame.position.y = -0.6;
  g.add(flame);
  g.userData.flame = flame;

  return g;
}
