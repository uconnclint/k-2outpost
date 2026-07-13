// ============================================================
// MOON TERRAIN — procedural mare surface with craters, ridges,
// instanced boulders, star field and a low-poly Earth overhead.
// Deterministic (seeded) so saves land on the same moon.
// terrainHeight(x, z) is THE height authority — placement and
// every scattered prop samples it.
// ============================================================

import * as THREE from 'three';
import { GRID, PALETTE } from '../core/constants.js';

// ---------- seeded rng + value noise ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20811;
const rng = mulberry32(SEED);

// permutation-based 2D value noise
const perm = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  const r = mulberry32(SEED ^ 0x9e3779b9);
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
function hash2(x, y) { return perm[(perm[x & 255] + y) & 255] / 255; }
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

// ---------- craters (kept clear of the central build zone) ----------
const CRATERS = [];
{
  const half = GRID.WORLD / 2;
  for (let i = 0; i < 26; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = half * (0.75 + rng() * 0.85);
    CRATERS.push({
      x: Math.cos(ang) * dist,
      z: Math.sin(ang) * dist,
      r: 14 + rng() * 46,
      depth: 3 + rng() * 9,
    });
  }
  // a couple of shallow "photogenic" craters just outside the build ring
  for (let i = 0; i < 5; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = half * (0.62 + rng() * 0.1);
    CRATERS.push({ x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, r: 8 + rng() * 10, depth: 1.2 + rng() * 1.5 });
  }
  // faint craterlets peppered through the buildable core — pure set dressing,
  // shallow enough that foundations swallow them
  for (let i = 0; i < 28; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = half * rng() * 0.55;
    CRATERS.push({ x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, r: 2.5 + rng() * 5, depth: 0.25 + rng() * 0.3 });
  }
}

const BUILD_R = GRID.WORLD * 0.5;   // radius of gentle buildable core

export function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  // gentle rolling everywhere
  let h = fbm(x * 0.012 + 100, z * 0.012 + 100, 4) * 6 - 3;
  // flatten the buildable core
  const flat = smooth(Math.min(1, Math.max(0, (d - BUILD_R * 0.55) / (BUILD_R * 0.75))));
  h *= 0.12 + 0.88 * flat;
  // distant rim mountains
  if (d > BUILD_R) {
    const m = (d - BUILD_R) / BUILD_R;
    h += fbm(x * 0.02 + 7, z * 0.02 + 7, 3) * m * m * 55;
  }
  // craters: parabolic bowl + raised rim
  for (const c of CRATERS) {
    const dd = Math.hypot(x - c.x, z - c.z);
    if (dd < c.r) {
      const t = dd / c.r;
      h += -c.depth * (1 - t * t) + c.depth * 0.35 * smooth(t) * t;
    } else if (dd < c.r * 1.25) {
      const t = 1 - (dd - c.r) / (c.r * 0.25);
      h += c.depth * 0.3 * smooth(t);
    }
  }
  return h;
}

// ---------- terrain mesh ----------
export function createTerrain() {
  const group = new THREE.Group();
  const EXTENT = GRID.WORLD * 2.6;
  const SEGS = 190;
  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color(PALETTE.regolith);
  const cDark = new THREE.Color(PALETTE.regolithDark);
  const cLight = new THREE.Color(PALETTE.regolithLight);
  const cCrater = new THREE.Color(PALETTE.crater);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    // color by height + noise mottling
    const mottle = fbm(x * 0.05 + 40, z * 0.05 + 40, 3);
    const maria = fbm(x * 0.008 + 300, z * 0.008 + 300, 3);   // broad dark basalt patches
    tmp.copy(cBase);
    if (h < -0.35) tmp.lerp(cCrater, Math.min(1, -h / 5));
    else if (h > 6) tmp.lerp(cLight, Math.min(1, (h - 6) / 30));
    tmp.lerp(mottle > 0.55 ? cLight : cDark, Math.abs(mottle - 0.5) * 1.5);
    if (maria < 0.46) tmp.lerp(cDark, (0.46 - maria) * 2.2);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);

  group.add(createRocks());
  return group;
}

// ---------- instanced boulders ----------
function createRocks() {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.rock, flatShading: true });

  const COUNT = 520;
  const inst = new THREE.InstancedMesh(geo, mat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let placed = 0;
  let guard = 0;
  while (placed < COUNT && guard++ < COUNT * 20) {
    const ang = rng() * Math.PI * 2;
    const d = GRID.WORLD * (0.18 + Math.pow(rng(), 0.6) * 1.05);
    const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
    // keep the inner build pad mostly clear
    if (d < GRID.WORLD * 0.42 && rng() < 0.8) continue;
    const scale = d < GRID.WORLD * 0.5 ? 0.25 + rng() * 0.5 : 0.5 + rng() * 3.2;
    p.set(x, terrainHeight(x, z) + scale * 0.25, z);
    e.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    q.setFromEuler(e);
    s.set(scale * (0.7 + rng() * 0.7), scale * (0.5 + rng() * 0.6), scale * (0.7 + rng() * 0.7));
    m.compose(p, q, s);
    inst.setMatrixAt(placed++, m);
  }
  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
  return group;
}

// ---------- sky: stars + earth + sun disc ----------
export function createSky() {
  const group = new THREE.Group();

  // stars
  const N = 1400;
  const positions = new Float32Array(N * 3);
  const sizes = [];
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(rng() * 2 - 1, rng() * 0.9 + 0.05, rng() * 2 - 1).normalize().multiplyScalar(1500);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    sizes.push(rng());
  }
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const smat = new THREE.PointsMaterial({ color: PALETTE.star, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.9 });
  group.add(new THREE.Points(sgeo, smat));

  // Earth — low-poly sphere with painted continents via vertex colors
  const egeo = new THREE.IcosahedronGeometry(58, 2);
  const epos = egeo.attributes.position;
  const ecol = new Float32Array(epos.count * 3);
  const ocean = new THREE.Color(PALETTE.earthBlue);
  const land = new THREE.Color(PALETTE.earthGreen);
  const cloud = new THREE.Color(PALETTE.earthCloud);
  const ct = new THREE.Color();
  for (let i = 0; i < epos.count; i++) {
    const x = epos.getX(i), y = epos.getY(i), z = epos.getZ(i);
    const n = fbm(x * 0.04 + 9, (y + z) * 0.04 + 9, 3);
    ct.copy(n > 0.56 ? land : ocean);
    if (fbm(x * 0.06 + 77, y * 0.06 - 31, 2) > 0.62) ct.lerp(cloud, 0.85);
    ecol[i * 3] = ct.r; ecol[i * 3 + 1] = ct.g; ecol[i * 3 + 2] = ct.b;
  }
  egeo.setAttribute('color', new THREE.BufferAttribute(ecol, 3));
  const emat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x223a66, emissiveIntensity: 0.55 });
  const earth = new THREE.Mesh(egeo, emat);
  earth.position.set(-620, 480, -900);
  group.add(earth);
  group.userData.earth = earth;

  // sun disc (billboard-ish glow)
  const sunGeo = new THREE.CircleGeometry(34, 24);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff8e0 });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(900, 700, 300);
  sun.lookAt(0, 0, 0);
  group.add(sun);
  group.userData.sun = sun;

  return group;
}
