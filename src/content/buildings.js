// ============================================================
// LUNAR OUTPOST — building mesh factory
// createBuildingMesh(defId) -> THREE.Group
//
// Every structure in catalog.js gets a hand-built, flat-shaded
// low-poly mesh. Footprint is centered on the origin:
//   def.size[0]*CELL wide (x) x def.size[1]*CELL deep (z),
//   base resting at y = 0, with ~0.3u margin inside the edges.
// The foundation pad + placement rotation are added by
// structures.js — this module only builds the building itself.
//
// Rules honored here:
//   - MeshLambertMaterial(flatShading) everywhere, except glowing
//     bits (windows / beacons / engine glow) which use
//     MeshBasicMaterial so they read as emissive.
//   - Colors come ONLY from PALETTE.
//   - Materials are shared at module scope (MAT / GLOW / glassMat).
//     Geometries are cheap and created per call.
//   - Low poly: cylinders <= 8 radial segs, domes <= 10x6 spheres,
//     icospheres detail <= 1, <= ~25 meshes per building.
//   - Animated parts hang off group.userData.animate(time, dt).
// ============================================================

import * as THREE from 'three';
import { GRID, PALETTE } from '../core/constants.js';
import { BUILDINGS_BY_ID } from '../core/catalog.js';

const CELL = GRID.CELL;          // 4
const MARGIN = 0.3;              // keep this much inside footprint edges
const HALF_PI = Math.PI / 2;

// ------------------------------------------------------------
// Shared materials — created once, reused across every mesh.
// ------------------------------------------------------------
function lam(color, extra) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

const MAT = {
  hull:       lam(PALETTE.hullWhite),
  hullGrey:   lam(PALETTE.hullGrey),
  hullDark:   lam(PALETTE.hullDark),
  orange:     lam(PALETTE.accentOrange),
  yellow:     lam(PALETTE.accentYellow),
  red:        lam(PALETTE.accentRed),
  teal:       lam(PALETTE.accentTeal),
  blue:       lam(PALETTE.accentBlue),
  purple:     lam(PALETTE.accentPurple),
  solarFrame: lam(PALETTE.solarBlue),
  solarCell:  lam(PALETTE.solarCell),
  gold:       lam(PALETTE.metalGold),
  foliage:    lam(PALETTE.foliage),
  foliageDk:  lam(PALETTE.foliageDark),
  dirt:       lam(PALETTE.dirt),
  pad:        lam(PALETTE.pad),
  padLine:    lam(PALETTE.padLine),
  warn:       lam(PALETTE.warnStripe),
  rock:       lam(PALETTE.rock),
  regolith:   lam(PALETTE.regolith),
  regolithDk: lam(PALETTE.regolithDark),
  crater:     lam(PALETTE.crater),
  earth:      lam(PALETTE.earthBlue),
};

// Emissive-looking bits use MeshBasicMaterial (unlit -> reads as glow).
const GLOW = {
  window:  new THREE.MeshBasicMaterial({ color: PALETTE.glowWindow }),
  warm:    new THREE.MeshBasicMaterial({ color: PALETTE.glassWarm }),
  engine:  new THREE.MeshBasicMaterial({ color: PALETTE.glowEngine }),
  beacon:  new THREE.MeshBasicMaterial({ color: PALETTE.beacon }),
  red:     new THREE.MeshBasicMaterial({ color: PALETTE.accentRed }),
  teal:    new THREE.MeshBasicMaterial({ color: PALETTE.accentTeal }),
  purple:  new THREE.MeshBasicMaterial({ color: PALETTE.accentPurple }),
  blue:    new THREE.MeshBasicMaterial({ color: PALETTE.accentBlue }),
};

// Shared translucent glass used by every dome / greenhouse / tube.
const glassMat = new THREE.MeshLambertMaterial({
  color: PALETTE.glassBlue, flatShading: true,
  transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
});
const glassWarmMat = new THREE.MeshLambertMaterial({
  color: PALETTE.glassWarm, flatShading: true,
  transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
});

// ------------------------------------------------------------
// Geometry helpers — small, DRY builders. All return THREE.Mesh.
// ------------------------------------------------------------
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(rTop, rBot, h, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}
function cone(r, h, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}
// Hemisphere dome (open bottom). phiLength lets us do partial shells.
function dome(r, mat, x = 0, y = 0, z = 0, wSeg = 10, hSeg = 6) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg, 0, Math.PI * 2, 0, HALF_PI);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}
// Low-poly ball.
function ball(r, mat, x = 0, y = 0, z = 0, detail = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat);
  m.position.set(x, y, z);
  return m;
}
function torus(r, tube, mat, x = 0, y = 0, z = 0, rSeg = 8, tSeg = 12) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, rSeg, tSeg), mat);
  m.position.set(x, y, z);
  return m;
}
// Rounded-cap horizontal module: a cylinder lying along X with domed ends.
function capsuleX(len, r, mat, x = 0, y = 0, z = 0, seg = 8) {
  const g = new THREE.Group();
  const body = cyl(r, r, len, mat, 0, 0, 0, seg);
  body.rotation.z = HALF_PI;
  g.add(body);
  const capL = dome(r, mat, -len / 2, 0, 0, seg, 4); capL.rotation.z = HALF_PI; g.add(capL);
  const capR = dome(r, mat, len / 2, 0, 0, seg, 4); capR.rotation.z = -HALF_PI; g.add(capR);
  g.position.set(x, y, z);
  return g;
}
// Rounded-cap vertical module: cylinder along Y with a domed top.
function capsuleY(h, r, mat, x = 0, y = 0, z = 0, seg = 8) {
  const g = new THREE.Group();
  g.add(cyl(r, r, h, mat, 0, h / 2, 0, seg));
  g.add(dome(r, mat, 0, h, 0, seg, 4));
  g.position.set(x, y, z);
  return g;
}
// A thin panel-rim ring that sits at a dome's base (hex-ish collar look).
function domeRim(r, mat, y = 0, seg = 10) {
  const m = cyl(r * 1.02, r * 1.06, 0.5, mat, 0, y + 0.1, 0, seg);
  return m;
}
// A short connecting collar (airlock ring) between modules.
function collar(r, mat, x = 0, y = 0, z = 0) {
  return cyl(r, r, 0.6, mat, x, y, z, 8);
}
// Warning-stripe band wrapped around a cylinder of radius r at height y.
function warnBand(r, h, y, x = 0, z = 0) {
  return cyl(r * 1.01, r * 1.01, h, MAT.warn, x, y, z, 8);
}
// A strip of glowing windows along X on a wall face.
function windowStrip(count, wEach, h, mat, y, zFace, spacing, x0 = 0) {
  const g = new THREE.Group();
  const total = (count - 1) * spacing;
  for (let i = 0; i < count; i++) {
    g.add(box(wEach, h, 0.15, mat, x0 - total / 2 + i * spacing, y, zFace));
  }
  return g;
}
// Antenna mast with a little tip; returns { group, tip } so tip can blink.
function mast(h, mat, tipMat) {
  const g = new THREE.Group();
  g.add(cyl(0.08, 0.12, h, mat, 0, h / 2, 0, 6));
  const tip = ball(0.22, tipMat || GLOW.beacon, 0, h, 0, 0);
  g.add(tip);
  return { group: g, tip };
}
// Simple low-poly tree: cone canopy on a dirt trunk.
function tree(scale = 1, x = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(0.12 * scale, 0.16 * scale, 0.7 * scale, MAT.dirt, 0, 0.35 * scale, 0, 6));
  g.add(ball(0.6 * scale, MAT.foliageDk, 0, 0.95 * scale, 0, 0));
  g.add(cone(0.55 * scale, 0.9 * scale, MAT.foliage, 0, 1.35 * scale, 0, 6));
  g.position.set(x, 0, z);
  return g;
}

// Footprint half-extents (with margin already applied).
function footprint(def) {
  const w = def.size[0] * CELL;
  const d = def.size[1] * CELL;
  return {
    w, d,
    hw: w / 2 - MARGIN,
    hd: d / 2 - MARGIN,
    innerW: w - MARGIN * 2,
    innerD: d - MARGIN * 2,
  };
}

// ============================================================
// BUILDING BUILDERS — one per catalog id.
// Each returns a THREE.Group with its base at y = 0.
// ============================================================

// ---------------- HABITATION ----------------

function landing_pod(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // four splayed legs
  const legR = fp.hw * 0.7;
  const foot = MAT.hullDark;
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * HALF_PI;
    const lx = Math.cos(a) * legR, lz = Math.sin(a) * legR;
    const leg = cyl(0.12, 0.16, 2.6, MAT.hullGrey, lx * 0.55, 1.3, lz * 0.55, 6);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
    g.add(cyl(0.35, 0.35, 0.2, foot, lx, 0.1, lz, 6)); // landing foot pad
  }
  // descent stage (octagon body)
  g.add(cyl(fp.hw * 0.62, fp.hw * 0.72, 1.6, MAT.gold, 0, 2.3, 0, 8));
  g.add(warnBand(fp.hw * 0.62, 0.3, 3.0));
  // ascent capsule + nose
  g.add(cyl(fp.hw * 0.5, fp.hw * 0.6, 1.4, MAT.hull, 0, 3.7, 0, 8));
  g.add(dome(fp.hw * 0.5, MAT.hull, 0, 4.4, 0, 8, 5));
  // porthole + hatch glow
  g.add(box(0.7, 0.9, 0.15, GLOW.window, 0, 3.7, fp.hw * 0.55));
  // ladder down the side
  const ladder = new THREE.Group();
  for (let i = 0; i < 5; i++) ladder.add(box(0.5, 0.06, 0.06, MAT.hullDark, 0, 0.6 + i * 0.55, 0));
  ladder.add(box(0.06, 3, 0.06, MAT.hullDark, -0.22, 1.7, 0));
  ladder.add(box(0.06, 3, 0.06, MAT.hullDark, 0.22, 1.7, 0));
  ladder.position.set(0, 0, fp.hw * 0.62);
  g.add(ladder);
  // blinking nav light on the nose
  const navTip = ball(0.16, GLOW.beacon, 0, 4.9, 0);
  g.add(navTip);
  g.userData.animate = (t) => {
    const b = (Math.sin(t * 4) > 0) ? 1 : 0.15;
    navTip.scale.setScalar(0.7 + b * 0.6);
  };
  return g;
}

function hab_dome(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd);
  // interior floor + a couple of bunk boxes visible through the glass
  g.add(cyl(r * 0.95, r * 0.95, 0.3, MAT.hullGrey, 0, 0.15, 0, 10));
  g.add(box(r * 0.5, 0.5, r * 0.7, MAT.hull, -r * 0.4, 0.4, 0));
  g.add(box(r * 0.5, 0.5, r * 0.7, MAT.orange, r * 0.4, 0.4, 0));
  g.add(box(0.7, 0.35, 0.7, GLOW.warm, 0, 0.5, r * 0.35)); // warm lamp inside
  // panel rim + glass geodesic shell
  g.add(domeRim(r, MAT.hullWhite ? MAT.hull : MAT.hull, 0.2));
  g.add(dome(r, glassMat, 0, 0.3, 0, 10, 6));
  // little airlock porch
  g.add(box(1.2, 1.3, 0.9, MAT.hullGrey, 0, 0.65, r * 0.9));
  g.add(box(0.7, 0.9, 0.12, GLOW.window, 0, 0.65, r * 0.9 + 0.5));
  // rooftop vent
  g.add(cyl(0.25, 0.3, 0.5, MAT.hullDark, 0, r + 0.2, 0, 6));
  return g;
}

function hab_block(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // three stacked capsule modules with lots of windows
  const modLen = fp.innerD * 0.92;
  const r = 1.5;
  const levels = 3;
  for (let i = 0; i < levels; i++) {
    const y = 1.5 + i * 2.6;
    const mod = capsuleX(modLen, r, i === 1 ? MAT.hullGrey : MAT.hull, 0, y, 0, 8);
    mod.rotation.y = HALF_PI; // run along Z (depth)
    g.add(mod);
    // window band on the front face
    const strip = windowStrip(3, 0.5, 0.7, GLOW.window, y, 0, modLen / 3.4);
    strip.rotation.y = HALF_PI;
    strip.position.z = 0; strip.position.x = r * 0.98;
    g.add(strip);
  }
  // vertical connecting spine + entrance collar
  g.add(box(1.0, levels * 2.6, 1.0, MAT.hullDark, -r * 1.1, 1.5 + (levels - 1) * 1.3, 0));
  g.add(box(0.8, 1.2, 0.15, GLOW.window, -r * 1.1, 1.3, fp.hd * 0.8));
  g.add(warnBand(r, 0.25, 0.4, 0, 0));
  // roof antenna
  const m = mast(1.4, MAT.hullGrey, GLOW.beacon);
  m.group.position.set(0, 1.5 + (levels - 1) * 2.6 + r, 0);
  g.add(m.group);
  g.userData.animate = (t) => {
    m.tip.scale.setScalar(Math.sin(t * 3) > 0 ? 1.3 : 0.5);
  };
  return g;
}

function grand_dome(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd);
  // interior plaza floor
  g.add(cyl(r * 0.96, r * 0.96, 0.3, MAT.hullGrey, 0, 0.15, 0, 10));
  // tiny buildings inside (a little village)
  g.add(box(1.4, 1.6, 1.4, MAT.hull, -r * 0.45, 0.8, -r * 0.35));
  g.add(dome(0.9, MAT.orange, r * 0.35, 0.3, -r * 0.4, 8, 5));
  g.add(box(1.0, 2.2, 1.0, MAT.hullGrey, r * 0.4, 1.1, r * 0.4));
  g.add(box(0.5, 0.6, 0.12, GLOW.warm, r * 0.4, 1.3, r * 0.4 + 0.55));
  g.add(box(0.5, 0.6, 0.12, GLOW.warm, -r * 0.45, 0.9, -r * 0.35 + 0.75));
  // a cluster of trees + a reflecting pond
  g.add(tree(1.1, -r * 0.15, r * 0.45));
  g.add(tree(0.9, r * 0.05, r * 0.55));
  g.add(tree(1.0, -r * 0.5, r * 0.15));
  g.add(cyl(r * 0.28, r * 0.28, 0.12, glassMat, r * 0.1, 0.22, -r * 0.15, 10));
  // big central mast light
  g.add(cyl(0.15, 0.2, r * 0.9, MAT.hullDark, 0, r * 0.45, 0, 6));
  g.add(ball(0.4, GLOW.warm, 0, r * 0.9, 0));
  // panel rim + soaring glass dome (the showpiece)
  g.add(domeRim(r, MAT.hull, 0.2, 10));
  // structural ribs
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const rib = torus(r, 0.09, MAT.hull, 0, r * 0.02, 0, 6, 10);
    rib.rotation.y = a; rib.rotation.x = HALF_PI;
    // only need a few — cap the count for poly budget
    if (i < 3) g.add(rib);
  }
  g.add(dome(r, glassMat, 0, 0.3, 0, 10, 6));
  g.add(cyl(r * 0.15, r * 0.2, 0.6, MAT.hull, 0, r + 0.1, 0, 8)); // apex crown
  return g;
}

function penthouse(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const w = fp.innerW * 0.7;
  const h = 9;
  // slim tapered tower
  g.add(box(w, h, w, MAT.hull, 0, h / 2, 0));
  g.add(box(w * 1.1, 0.5, w * 1.1, MAT.hullGrey, 0, 0.4, 0)); // base flare
  // vertical window pilasters
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 2.2;
    g.add(windowStrip(2, 0.5, 1.4, GLOW.window, y, w / 2 + 0.02, w * 0.45));
    const back = windowStrip(2, 0.5, 1.4, GLOW.window, y, -w / 2 - 0.02, w * 0.45);
    g.add(back);
  }
  // glass penthouse top floor
  g.add(box(w * 1.25, 1.8, w * 1.25, glassWarmMat, 0, h + 0.9, 0));
  g.add(box(w * 1.3, 0.3, w * 1.3, MAT.hull, 0, h + 1.9, 0)); // roof slab
  // aircraft warning light
  const tip = ball(0.22, GLOW.beacon, 0, h + 2.4, 0);
  g.add(cyl(0.06, 0.06, 0.6, MAT.hullDark, 0, h + 2.2, 0, 6));
  g.add(tip);
  g.userData.animate = (t) => {
    tip.scale.setScalar(Math.sin(t * 2.5) > 0.3 ? 1.4 : 0.4);
  };
  return g;
}

// ---------------- POWER ----------------

function solar_panel(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // central mast
  g.add(cyl(0.18, 0.24, 2.2, MAT.hullGrey, 0, 1.1, 0, 6));
  g.add(box(1.2, 0.3, 1.2, MAT.hullDark, 0, 0.15, 0));
  // two tilting wings on a pivot
  const pivot = new THREE.Group();
  pivot.position.y = 2.2;
  const wingW = fp.innerW * 0.46, wingD = fp.innerD * 0.9;
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.add(box(wingW, 0.12, wingD, MAT.solarFrame, 0, 0, 0));
    // cell grid overlay
    for (let i = 0; i < 3; i++) {
      wing.add(box(wingW * 0.9, 0.14, wingD * 0.26, MAT.solarCell, 0, 0.02, (i - 1) * wingD * 0.3));
    }
    wing.position.x = s * (wingW * 0.55 + 0.2);
    wing.rotation.z = -s * 0.5; // angled toward the sky
    pivot.add(wing);
  }
  g.add(pivot);
  g.userData.animate = (t) => {
    // slow sun tracking
    pivot.rotation.y = Math.sin(t * 0.15) * 0.5;
  };
  return g;
}

function solar_tower(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const h = 6.5;
  g.add(box(fp.innerW * 0.4, 0.4, fp.innerD * 0.4, MAT.hullDark, 0, 0.2, 0));
  g.add(cyl(0.22, 0.32, h, MAT.hullGrey, 0, h / 2, 0, 6));
  // glowing receiver at the top
  g.add(ball(0.5, GLOW.warm, 0, h, 0));
  // ring of heliostat mirrors that rotate around the base
  const ring = new THREE.Group();
  const count = 6;
  const rad = Math.min(fp.hw, fp.hd) * 0.78;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const helio = new THREE.Group();
    helio.add(cyl(0.06, 0.06, 1.0, MAT.hullGrey, 0, 0.5, 0, 6));
    const panel = box(1.0, 0.08, 0.8, MAT.solarCell, 0, 1.1, 0);
    panel.rotation.x = -0.6;
    helio.add(panel);
    helio.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    helio.rotation.y = -a;
    ring.add(helio);
  }
  g.add(ring);
  g.userData.animate = (t) => { ring.rotation.y = t * 0.2; };
  return g;
}

function battery(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // a rack of cell blocks with green charge lights
  const cols = 2, rows = 3;
  const cw = fp.innerW / cols * 0.86;
  const cd = fp.innerD / rows * 0.86;
  const lights = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (fp.innerW / cols);
      const z = (r - (rows - 1) / 2) * (fp.innerD / rows);
      g.add(box(cw, 2.0, cd, MAT.hullGrey, x, 1.0, z));
      g.add(box(cw * 0.9, 0.3, cd * 0.9, MAT.hullDark, x, 2.05, z)); // cap
      const led = box(0.3, 0.12, cd * 0.5, GLOW.teal, x, 1.6, z + cd * 0.5 + 0.02);
      g.add(led);
      lights.push(led);
    }
  }
  // warning stripe base
  g.add(box(fp.innerW, 0.4, fp.innerD, MAT.warn, 0, 0.2, 0));
  g.userData.animate = (t) => {
    for (let i = 0; i < lights.length; i++) {
      const phase = (t * 1.2 + i * 0.5) % lights.length;
      lights[i].scale.y = 0.5 + 0.8 * (0.5 + 0.5 * Math.sin(t * 2 + i));
    }
  };
  return g;
}

function reactor(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.6;
  // containment drum
  g.add(cyl(r, r * 1.1, 3.2, MAT.hullGrey, 0, 1.6, 0, 8));
  g.add(dome(r, MAT.hull, 0, 3.2, 0, 8, 5));
  g.add(warnBand(r, 0.4, 0.5));
  // glowing core ring
  const core = torus(r * 0.75, 0.25, GLOW.engine, 0, 2.0, 0, 8, 14);
  core.rotation.x = HALF_PI;
  g.add(core);
  // cooling fins radiating out
  const fins = [];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const fin = box(0.15, 2.4, 1.6, MAT.hullDark, Math.cos(a) * r * 1.2, 1.4, Math.sin(a) * r * 1.2);
    fin.rotation.y = -a;
    g.add(fin);
    fins.push(fin);
  }
  // vent stacks
  g.add(cyl(0.3, 0.35, 1.2, MAT.hullGrey, r * 0.5, 4.0, 0, 6));
  g.userData.animate = (t) => {
    const p = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3));
    core.scale.setScalar(0.94 + p * 0.08);
    core.material = GLOW.engine; // shared, stays glowing
  };
  return g;
}

function fusion(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.62;
  // heavy pedestal
  g.add(cyl(r * 1.1, r * 1.2, 2.0, MAT.hullDark, 0, 1.0, 0, 8));
  g.add(warnBand(r * 1.1, 0.4, 0.4));
  // big toroidal chamber, glowing
  const tor = torus(r * 0.9, r * 0.34, MAT.hullGrey, 0, 3.0, 0, 8, 14);
  tor.rotation.x = HALF_PI;
  g.add(tor);
  const plasma = torus(r * 0.9, r * 0.16, GLOW.purple, 0, 3.0, 0, 8, 14);
  plasma.rotation.x = HALF_PI;
  g.add(plasma);
  // central injector column
  g.add(cyl(0.4, 0.5, 4.0, MAT.hull, 0, 3.0, 0, 8));
  g.add(ball(0.6, GLOW.engine, 0, 3.0, 0));
  // three tall cooling towers around it
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3) + 0.5;
    g.add(cyl(0.35, 0.45, 4.2, MAT.hullGrey, Math.cos(a) * r * 1.3, 2.1, Math.sin(a) * r * 1.3, 6));
  }
  g.userData.animate = (t) => {
    plasma.rotation.z = t * 1.2;
    const p = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 4));
    plasma.scale.set(1, 1, 0.8 + p * 0.5);
  };
  return g;
}

// ---------------- LIFE SUPPORT ----------------

function oxygen_gen(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // vertical processing cylinder with vents
  const r = fp.hw * 0.7;
  g.add(cyl(r, r * 1.1, 3.2, MAT.hull, 0, 1.6, 0, 8));
  g.add(dome(r, MAT.hullGrey, 0, 3.2, 0, 8, 5));
  g.add(box(0.6, 0.9, 0.12, GLOW.teal, 0, 1.4, r + 0.02));
  // stacked vent rings
  for (let i = 0; i < 3; i++) g.add(cyl(r * 1.05, r * 1.05, 0.18, MAT.teal, 0, 0.8 + i * 0.7, 0, 8));
  // side pipe + small O2 buffer tank
  g.add(cyl(0.18, 0.18, 1.4, MAT.hullDark, r + 0.5, 1.0, 0, 6));
  g.add(ball(0.7, MAT.teal, r + 0.5, 2.1, 0));
  return g;
}

function ice_extractor(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // drill head over a pit
  g.add(cyl(fp.hw * 0.35, fp.hw * 0.5, 0.4, MAT.hullDark, -fp.hw * 0.4, 0.2, -fp.hd * 0.4, 8));
  const drillPivot = new THREE.Group();
  drillPivot.position.set(-fp.hw * 0.4, 0, -fp.hd * 0.4);
  drillPivot.add(cyl(0.25, 0.25, 2.6, MAT.hullGrey, 0, 1.5, 0, 6));
  drillPivot.add(cone(0.35, 0.9, MAT.hull, 0, 0.4, 0, 6));
  g.add(drillPivot);
  g.add(box(1.4, 1.8, 1.4, MAT.hull, -fp.hw * 0.4, 1.0, -fp.hd * 0.4)); // drill housing
  // conveyor carrying frost-blue ice blocks
  const conv = box(fp.innerW * 0.9, 0.25, 1.0, MAT.hullDark, fp.hw * 0.1, 0.7, fp.hd * 0.3);
  conv.rotation.z = -0.12;
  g.add(conv);
  const iceBlocks = [];
  for (let i = 0; i < 3; i++) {
    const ice = box(0.7, 0.7, 0.7, glassMat, -fp.hw * 0.4 + i * 1.4, 1.0 - i * 0.15, fp.hd * 0.3);
    g.add(ice);
    iceBlocks.push(ice);
  }
  g.userData.animate = (t, dt) => {
    for (const ice of iceBlocks) {
      ice.position.x += dt * 0.6;
      if (ice.position.x > fp.hw) { ice.position.x = -fp.hw * 0.5; }
    }
  };
  return g;
}

function hydroponics(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // long glass tunnel running along X
  const len = fp.innerW;
  const r = Math.min(fp.hd / 2 - MARGIN, 1.8);
  g.add(box(len, 0.4, fp.innerD, MAT.hullGrey, 0, 0.2, 0)); // base slab
  // rows of green crops inside (two long planter rows)
  for (const row of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = -len / 2 + 1 + i * (len / 4.5);
      g.add(box(0.7, 0.35, 0.5, MAT.dirt, x, 0.55, row * r * 0.55));
      g.add(cone(0.32, 0.6, MAT.foliage, x, 0.9, row * r * 0.55, 6));
    }
  }
  // glass half-tunnel shell
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 8, 1, true, 0, Math.PI),
    glassMat
  );
  shell.rotation.z = HALF_PI;
  shell.rotation.y = HALF_PI;
  shell.position.y = 0.4;
  g.add(shell);
  // grow lights along the ridge
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const l = box(0.6, 0.15, 0.3, GLOW.warm, -len / 3 + i * (len / 3), r + 0.3, 0);
    g.add(l); lights.push(l);
  }
  g.userData.animate = (t) => {
    const glow = 0.7 + 0.3 * Math.sin(t * 2);
    for (const l of lights) l.scale.y = glow;
  };
  return g;
}

function greenhouse(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd);
  // interior garden floor with planters + trees
  g.add(cyl(r * 0.95, r * 0.95, 0.3, MAT.dirt, 0, 0.15, 0, 10));
  g.add(tree(1.2, -r * 0.35, -r * 0.2));
  g.add(tree(1.0, r * 0.3, r * 0.25));
  g.add(tree(0.85, r * 0.1, -r * 0.4));
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3);
    g.add(box(1.4, 0.4, 0.9, MAT.foliageDk, Math.cos(a) * r * 0.5, 0.35, Math.sin(a) * r * 0.5));
  }
  // spinning ventilation fans in the roof rim
  const fans = [];
  for (let i = 0; i < 2; i++) {
    const fx = (i === 0 ? -1 : 1) * r * 0.6;
    const fan = new THREE.Group();
    fan.add(cyl(0.5, 0.5, 0.2, MAT.hullDark, 0, 0, 0, 8));
    for (let b = 0; b < 3; b++) {
      const blade = box(0.7, 0.05, 0.18, MAT.hullGrey, 0, 0.02, 0);
      blade.rotation.y = b * (Math.PI * 2 / 3);
      fan.add(blade);
    }
    fan.position.set(fx, r * 0.55, r * 0.6);
    fan.rotation.x = HALF_PI;
    g.add(fan); fans.push(fan);
  }
  // rim + big glass dome (cathedral of green)
  g.add(domeRim(r, MAT.foliageDk, 0.2, 10));
  g.add(dome(r, glassMat, 0, 0.3, 0, 10, 6));
  g.add(cyl(0.25, 0.3, 0.8, MAT.hullDark, 0, r + 0.1, 0, 6)); // ridge vent
  g.userData.animate = (t, dt) => { for (const f of fans) f.rotation.z += dt * 3; };
  return g;
}

function water_tank(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.85;
  // spherical tank on a short skirt with blue bands
  g.add(cyl(r * 0.7, r * 0.9, 0.8, MAT.hullDark, 0, 0.4, 0, 8));
  g.add(ball(r, MAT.hull, 0, r + 0.7, 0));
  g.add(torus(r * 0.9, 0.14, MAT.blue, 0, r + 0.4, 0, 6, 12));
  g.add(torus(r * 0.7, 0.12, MAT.blue, 0, r + 1.2, 0, 6, 12));
  g.add(box(0.5, 0.6, 0.1, GLOW.window, 0, 0.5, r * 0.75));
  // fill pipe
  g.add(cyl(0.12, 0.12, 1.2, MAT.hullGrey, r * 0.6, r + 1.0, 0, 6));
  return g;
}

function o2_tank(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.55;
  // high-pressure vertical capsule with teal bands
  g.add(box(fp.innerW * 0.8, 0.4, fp.innerD * 0.8, MAT.hullDark, 0, 0.2, 0));
  const cap = capsuleY(2.6, r, MAT.hull, 0, 0.4, 0, 8);
  g.add(cap);
  g.add(torus(r * 1.02, 0.12, MAT.teal, 0, 1.2, 0, 6, 12));
  g.add(torus(r * 1.02, 0.12, MAT.teal, 0, 2.4, 0, 6, 12));
  g.add(cyl(0.14, 0.14, 0.5, MAT.hullGrey, 0, 3.4, 0, 6)); // valve
  g.add(box(0.4, 0.5, 0.1, GLOW.teal, 0, 1.6, r + 0.42));
  return g;
}

function recycler(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.55;
  // main plant cylinder
  g.add(cyl(r, r * 1.1, 2.8, MAT.hullGrey, 0, 1.4, 0, 8));
  g.add(warnBand(r, 0.3, 0.5));
  // spinning scrubber drum on top
  const drum = new THREE.Group();
  drum.add(cyl(r * 0.8, r * 0.8, 1.0, MAT.hull, 0, 0, 0, 8));
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI;
    drum.add(box(0.15, 0.9, r * 1.4, MAT.hullDark, Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1));
    drum.children[drum.children.length - 1].rotation.y = a;
  }
  drum.position.y = 3.4;
  g.add(drum);
  // side pipes looping back in
  g.add(cyl(0.16, 0.16, 2.4, MAT.teal, r + 0.3, 1.6, 0, 6));
  g.add(torus(0.4, 0.14, MAT.teal, r + 0.3, 3.0, 0, 6, 10));
  g.add(box(0.5, 0.7, 0.12, GLOW.teal, 0, 1.6, r + 0.02));
  g.userData.animate = (t, dt) => { drum.rotation.y += dt * 1.6; };
  return g;
}

// ---------------- INDUSTRY ----------------

function mine(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // open pit: stepped crater
  g.add(cyl(fp.hw * 0.9, fp.hw * 0.9, 0.3, MAT.regolithDk, -fp.hw * 0.15, 0.15, 0, 8));
  g.add(cyl(fp.hw * 0.6, fp.hw * 0.75, 0.5, MAT.crater, -fp.hw * 0.15, -0.1, 0, 8));
  // gantry base for the bucket-wheel excavator
  g.add(box(1.2, 1.6, 1.2, MAT.hullGrey, fp.hw * 0.5, 0.8, fp.hd * 0.4));
  g.add(warnBand(0.8, 0.25, 0.4, fp.hw * 0.5, fp.hd * 0.4));
  // boom arm reaching into the pit
  const arm = new THREE.Group();
  arm.position.set(fp.hw * 0.5, 1.6, fp.hd * 0.4);
  const boom = box(4.0, 0.35, 0.35, MAT.warn, -1.6, 0, 0);
  boom.rotation.z = 0.25;
  arm.add(boom);
  // rotating bucket wheel at the far end
  const wheel = new THREE.Group();
  wheel.add(cyl(0.9, 0.9, 0.4, MAT.hullDark, 0, 0, 0, 8));
  for (let i = 0; i < 8; i++) {
    const a = i * HALF_PI / 2;
    wheel.add(box(0.3, 0.3, 0.5, MAT.hullGrey, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0));
  }
  wheel.position.set(-3.4, -0.85, 0);
  wheel.rotation.x = HALF_PI;
  arm.add(wheel);
  g.add(arm);
  g.userData.animate = (t, dt) => { wheel.rotation.z += dt * 2.2; };
  return g;
}

function refinery(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // main smelter block
  g.add(box(fp.innerW * 0.55, 2.6, fp.innerD * 0.85, MAT.hullGrey, -fp.hw * 0.2, 1.3, 0));
  // glowing furnace slot
  const furnace = box(1.4, 0.7, 0.15, GLOW.engine, -fp.hw * 0.2, 1.0, fp.hd * 0.72);
  g.add(furnace);
  g.add(warnBand(0.1, 2.6, 1.3, -fp.hw * 0.55, fp.hd * 0.4));
  // tall smokestack with warning stripes
  g.add(cyl(0.4, 0.5, 4.5, MAT.hull, fp.hw * 0.35, 2.25, -fp.hd * 0.2, 8));
  g.add(warnBand(0.4, 0.4, 3.8, fp.hw * 0.35, -fp.hd * 0.2));
  g.add(cyl(0.5, 0.4, 0.4, MAT.hullDark, fp.hw * 0.35, 4.6, -fp.hd * 0.2, 8));
  // a smaller secondary stack that puffs (scale pulse of glow)
  const puff = ball(0.35, MAT.hullGrey, fp.hw * 0.35, 5.0, -fp.hd * 0.2);
  g.add(puff);
  // pipe manifold
  g.add(cyl(0.16, 0.16, 3.0, MAT.orange, 0, 0.6, fp.hd * 0.55, 6));
  g.children[g.children.length - 1].rotation.x = HALF_PI;
  g.userData.animate = (t) => {
    const p = 0.9 + 0.3 * Math.sin(t * 5);
    furnace.scale.y = p;
    puff.position.y = 5.0 + (Math.sin(t) * 0.5 + 0.5) * 0.8;
    puff.scale.setScalar(0.8 + (Math.sin(t) * 0.5 + 0.5) * 0.5);
  };
  return g;
}

function drill_rig(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const h = 6.0;
  // derrick tower — four splayed legs + cross bracing
  const legR = Math.min(fp.hw, fp.hd) * 0.6;
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * HALF_PI;
    const lx = Math.cos(a) * legR, lz = Math.sin(a) * legR;
    const leg = cyl(0.1, 0.16, h, MAT.warn, lx * 0.5, h / 2, lz * 0.5, 6);
    // tilt legs inward toward the apex
    leg.rotation.z = -Math.cos(a) * 0.14;
    leg.rotation.x = Math.sin(a) * 0.14;
    g.add(leg);
  }
  // cross braces
  for (let j = 1; j <= 2; j++) {
    g.add(box(legR * 1.3, 0.08, 0.08, MAT.hullDark, 0, j * 1.8, legR * 0.4 * (2 - j)));
    g.add(box(0.08, 0.08, legR * 1.3, MAT.hullDark, legR * 0.4 * (2 - j), j * 1.8, 0));
  }
  // crown block
  g.add(box(legR * 0.9, 0.5, legR * 0.9, MAT.hullGrey, 0, h, 0));
  // animated drill piston moving up/down
  const piston = cyl(0.22, 0.22, 3.0, MAT.hullGrey, 0, 3.0, 0, 6);
  g.add(piston);
  const bit = cone(0.3, 0.7, MAT.hullDark, 0, 1.2, 0, 6);
  g.add(bit);
  g.add(cyl(fp.hw * 0.4, fp.hw * 0.5, 0.3, MAT.regolithDk, 0, 0.15, 0, 8)); // spoil pile
  g.userData.animate = (t) => {
    const off = Math.sin(t * 2) * 0.9;
    piston.position.y = 3.0 + off;
    bit.position.y = 1.2 + off;
  };
  return g;
}

function fabricator(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // main enclosure
  g.add(box(fp.innerW, 2.4, fp.innerD * 0.7, MAT.hull, 0, 1.2, -fp.hd * 0.1));
  g.add(box(fp.innerW * 1.02, 0.3, fp.innerD * 0.72, MAT.orange, 0, 2.4, -fp.hd * 0.1));
  g.add(windowStrip(3, 0.7, 0.9, GLOW.window, 1.3, -fp.hd * 0.1 - fp.innerD * 0.35 - 0.02, fp.innerW * 0.3));
  // gantry rails
  const railY = 2.9;
  g.add(box(fp.innerW, 0.2, 0.2, MAT.hullDark, 0, railY, fp.hd * 0.35));
  g.add(box(fp.innerW, 0.2, 0.2, MAT.hullDark, 0, railY, fp.hd * 0.1));
  // sliding robotic arm on the gantry
  const arm = new THREE.Group();
  arm.add(box(0.3, 0.8, 0.9, MAT.hullGrey, 0, -0.4, fp.hd * 0.22));
  arm.add(box(0.2, 0.2, 0.7, MAT.warn, 0, -0.8, fp.hd * 0.22));
  const printHead = box(0.4, 0.3, 0.4, GLOW.engine, 0, -1.0, fp.hd * 0.22);
  arm.add(printHead);
  arm.position.y = railY;
  g.add(arm);
  // half-printed part on the bed
  g.add(box(1.2, 0.6, 1.0, MAT.hullGrey, 0, 0.9, fp.hd * 0.22));
  g.userData.animate = (t) => {
    arm.position.x = Math.sin(t * 1.1) * fp.hw * 0.55;
  };
  return g;
}

function storage_yard(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // canopy on four posts
  const postR = Math.min(fp.hw, fp.hd) * 0.85;
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * HALF_PI;
    g.add(cyl(0.14, 0.14, 3.2, MAT.hullGrey, Math.cos(a) * postR * 0.7, 1.6, Math.sin(a) * postR * 0.7, 6));
  }
  g.add(box(fp.innerW, 0.3, fp.innerD, MAT.warn, 0, 3.3, 0)); // bright canopy
  // stacked colored alloy crates
  const crateMats = [MAT.orange, MAT.blue, MAT.teal, MAT.yellow, MAT.hullGrey];
  const positions = [
    [-fp.hw * 0.4, 0.7, -fp.hd * 0.4, 1.4], [fp.hw * 0.35, 0.7, -fp.hd * 0.35, 1.4],
    [-fp.hw * 0.35, 0.7, fp.hd * 0.4, 1.4], [fp.hw * 0.4, 0.7, fp.hd * 0.35, 1.4],
    [-fp.hw * 0.4, 2.0, -fp.hd * 0.4, 1.2], [fp.hw * 0.35, 2.0, fp.hd * 0.35, 1.2],
  ];
  positions.forEach((p, i) => {
    g.add(box(p[3], 1.3, p[3], crateMats[i % crateMats.length], p[0], p[1], p[2]));
  });
  return g;
}

// ---------------- SCIENCE ----------------

function lab(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // white modules + a small side dish
  g.add(capsuleX(fp.innerW * 0.9, 1.6, MAT.hull, 0, 1.6, -fp.hd * 0.15, 8));
  g.add(box(1.6, 2.0, 1.6, MAT.hullGrey, -fp.hw * 0.3, 1.0, fp.hd * 0.3));
  g.add(windowStrip(3, 0.6, 0.7, GLOW.window, 1.7, 0, fp.innerW * 0.28));
  g.children[g.children.length - 1].position.z = -fp.hd * 0.15 + 1.6;
  // rooftop sensor dish
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.5, 8, 1, true), MAT.hullWhite ? MAT.hull : MAT.hull);
  dish.rotation.x = -0.5;
  dish.position.set(fp.hw * 0.3, 3.2, fp.hd * 0.1);
  g.add(dish);
  g.add(cyl(0.08, 0.08, 0.6, MAT.hullDark, fp.hw * 0.3, 2.9, fp.hd * 0.1, 6));
  g.add(box(0.4, 0.5, 0.1, GLOW.teal, -fp.hw * 0.3, 1.4, fp.hd * 0.3 + 0.82));
  return g;
}

function observatory(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.85;
  // drum base
  g.add(cyl(r, r * 1.05, 1.6, MAT.hull, 0, 0.8, 0, 10));
  g.add(box(0.6, 1.0, 0.12, GLOW.window, 0, 0.8, r + 0.02));
  // rotating dome with an open slot + telescope tube
  const rot = new THREE.Group();
  rot.position.y = 1.6;
  rot.add(dome(r * 0.95, MAT.hullGrey, 0, 0, 0, 10, 6));
  // slot (dark box cut visually)
  rot.add(box(0.6, r, 0.3, MAT.hullDark, 0, r * 0.5, r * 0.75));
  // telescope tube poking out of the slot
  const tube = cyl(0.35, 0.4, 2.4, MAT.hullDark, 0, r * 0.5, r * 0.4, 8);
  tube.rotation.x = -0.7;
  rot.add(tube);
  rot.add(ball(0.4, GLOW.engine, 0, r * 0.5 + 1.0, r * 0.9));
  g.add(rot);
  g.userData.animate = (t) => { rot.rotation.y = t * 0.25; };
  return g;
}

function comms(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const dishWhite = new THREE.MeshLambertMaterial({ color: PALETTE.hullWhite, flatShading: true, side: THREE.DoubleSide });

  // small equipment hut tucked in a back corner
  g.add(box(1.5, 1.2, 1.5, MAT.hullGrey, -fp.hw * 0.55, 0.6, -fp.hd * 0.55));
  g.add(box(0.5, 0.6, 0.1, GLOW.window, -fp.hw * 0.55, 0.65, -fp.hd * 0.55 + 0.78));

  // stout pedestal + fork mount in the middle
  g.add(cyl(0.5, 0.7, 1.5, MAT.hullDark, 0, 0.75, 0, 10));
  g.add(box(1.5, 0.4, 0.5, MAT.hullGrey, 0, 1.6, 0));

  // the DISH itself — a big shallow bowl on a tilting mount
  const yaw = new THREE.Group();
  yaw.position.set(0, 1.9, 0);
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.8;                     // aim up at the sky
  yaw.add(tilt);

  const dishR = Math.min(fp.hw, fp.hd) * 0.92;  // fills most of the footprint
  // wide mouth, narrow base = a proper concave dish (open cylinder)
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(dishR, dishR * 0.2, dishR * 0.5, 18, 1, true),
    dishWhite,
  );
  bowl.position.y = dishR * 0.25;
  tilt.add(bowl);
  // bright rim ring around the mouth
  const rim = torus(dishR, 0.1, MAT.hullGrey, 0, dishR * 0.5, 0, 8, 22);
  rim.rotation.x = HALF_PI;
  tilt.add(rim);
  // solid back so it reads as a dish from behind too
  tilt.add(cone(dishR * 0.55, 0.5, MAT.hullGrey, 0, -0.1, 0, 18));

  // prime-focus feed on a mast rising from the dish center
  const focus = dishR * 0.85;
  tilt.add(cyl(0.07, 0.07, focus, MAT.hullDark, 0, focus / 2, 0, 6));
  tilt.add(box(0.45, 0.45, 0.45, MAT.hullGrey, 0, focus, 0));
  const tip = ball(0.2, GLOW.beacon, 0, focus + 0.35, 0);
  tilt.add(tip);

  g.add(yaw);
  g.userData.animate = (t) => {
    yaw.rotation.y = Math.sin(t * 0.15) * 0.7;   // slow scan of the sky
    tip.scale.setScalar(Math.sin(t * 4) > 0 ? 1.3 : 0.4);
  };
  return g;
}

function particle_lab(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd) * 0.85;
  // partially buried accelerator ring
  const ring = torus(r, 0.5, MAT.hullGrey, 0, 0.2, 0, 8, 16);
  ring.rotation.x = HALF_PI;
  g.add(ring);
  const glowRing = torus(r, 0.22, GLOW.purple, 0, 0.3, 0, 8, 16);
  glowRing.rotation.x = HALF_PI;
  g.add(glowRing);
  // central control block with dishes
  g.add(box(fp.innerW * 0.4, 2.4, fp.innerD * 0.4, MAT.hull, 0, 1.2, 0));
  g.add(box(fp.innerW * 0.42, 0.3, fp.innerD * 0.42, MAT.purple, 0, 2.4, 0));
  g.add(windowStrip(3, 0.6, 0.8, GLOW.purple, 1.3, fp.innerW * 0.2 + 0.02, fp.innerW * 0.22));
  // detector nodes around the ring
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI + 0.4;
    g.add(box(0.9, 1.0, 0.9, MAT.hullDark, Math.cos(a) * r, 0.6, Math.sin(a) * r));
  }
  g.userData.animate = (t) => {
    glowRing.rotation.z = t * 3;
    const p = 0.7 + 0.3 * Math.sin(t * 6);
    glowRing.scale.set(p, p, 1);
  };
  return g;
}

function launch_pad(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // flat pad with painted lines
  g.add(cyl(fp.hw * 0.95, fp.hw * 0.95, 0.3, MAT.pad, 0, 0.15, 0, 10));
  g.add(torus(fp.hw * 0.7, 0.12, MAT.padLine, 0, 0.32, 0, 6, 16));
  // flame trench
  g.add(box(fp.innerW * 0.5, 0.35, 1.0, MAT.hullDark, 0, 0.18, 0));
  // gantry / service tower
  const towerX = fp.hw * 0.6;
  for (let i = 0; i < 4; i++) {
    const dx = (i % 2 ? 1 : -1) * 0.6, dz = (i < 2 ? 1 : -1) * 0.6;
    g.add(cyl(0.1, 0.12, 8.0, MAT.warn, towerX + dx, 4.0, dz, 6));
  }
  g.add(box(1.6, 0.2, 1.6, MAT.hullDark, towerX, 8.0, 0));
  g.add(box(1.6, 0.2, 1.6, MAT.hullDark, towerX, 4.0, 0));
  // sleek rocket standing on the pad
  const rocket = new THREE.Group();
  const rr = fp.hw * 0.22;
  rocket.add(cyl(rr, rr, 7.0, MAT.hull, 0, 3.7, 0, 8));
  rocket.add(cone(rr, 1.8, MAT.orange, 0, 8.1, 0, 8));
  rocket.add(warnBand(rr, 0.4, 5.5));
  // fins
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3);
    const fin = box(0.12, 1.4, 1.0, MAT.orange, Math.cos(a) * rr, 0.9, Math.sin(a) * rr);
    fin.rotation.y = -a;
    rocket.add(fin);
  }
  // engine glow
  const flame = cone(rr * 0.9, 0.8, GLOW.engine, 0, 0.1, 0, 8);
  flame.rotation.x = Math.PI;
  rocket.add(flame);
  g.add(rocket);
  // blinking pad lights around the rim
  const lights = [];
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI + 0.4;
    const l = ball(0.2, GLOW.beacon, Math.cos(a) * fp.hw * 0.85, 0.4, Math.sin(a) * fp.hw * 0.85);
    g.add(l); lights.push(l);
  }
  g.userData.animate = (t) => {
    const on = Math.sin(t * 3) > 0;
    for (const l of lights) l.scale.setScalar(on ? 1.4 : 0.4);
    flame.scale.setScalar(0.9 + 0.3 * Math.sin(t * 20));
  };
  return g;
}

// ---------------- CIVIC ----------------

function command(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // tiered mission-control building (wedding cake of windows)
  const tiers = [
    [fp.innerW, 2.0, fp.innerD],
    [fp.innerW * 0.72, 1.8, fp.innerD * 0.72],
    [fp.innerW * 0.46, 1.6, fp.innerD * 0.46],
  ];
  let y = 0;
  tiers.forEach((tt, i) => {
    g.add(box(tt[0], tt[1], tt[2], i === 1 ? MAT.hullGrey : MAT.hull, 0, y + tt[1] / 2, 0));
    // wraparound window band (front + back faces)
    g.add(windowStrip(3, 0.6, 0.8, GLOW.window, y + tt[1] / 2, tt[2] / 2 + 0.02, tt[0] / 4));
    if (i < 2) g.add(windowStrip(3, 0.6, 0.8, GLOW.window, y + tt[1] / 2, -tt[2] / 2 - 0.02, tt[0] / 4));
    y += tt[1];
  });
  // rooftop antenna farm
  const tips = [];
  const positions = [[-0.8, 0], [0.8, 0.6]];
  positions.forEach((p, i) => {
    const m = mast(1.4 + i * 0.4, MAT.hullGrey, GLOW.beacon);
    m.group.position.set(p[0], y, p[1]);
    g.add(m.group); tips.push(m.tip);
  });
  // a small satellite dish on the roof
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.5, 8, 1, true), MAT.hull);
  dish.rotation.x = -0.7; dish.position.set(1.0, y + 0.5, -1.0);
  g.add(dish);
  g.userData.animate = (t) => {
    tips.forEach((tip, i) => tip.scale.setScalar(Math.sin(t * 2 + i * 1.3) > 0 ? 1.3 : 0.5));
  };
  return g;
}

function medbay(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // clean white module
  g.add(box(fp.innerW, 2.4, fp.innerD * 0.8, MAT.hull, 0, 1.2, 0));
  g.add(dome(Math.min(fp.hw, fp.hd) * 0.5, MAT.hull, 0, 2.4, 0, 8, 5));
  g.add(windowStrip(3, 0.7, 0.9, GLOW.window, 1.2, fp.innerD * 0.4 + 0.02, fp.innerW * 0.28));
  // big red cross made of two boxes
  const crossZ = fp.innerD * 0.4 + 0.06;
  g.add(box(0.5, 1.6, 0.2, MAT.red, 0, 1.4, crossZ));
  g.add(box(1.6, 0.5, 0.2, MAT.red, 0, 1.4, crossZ));
  // side airlock
  g.add(cyl(0.7, 0.7, 1.4, MAT.hullGrey, -fp.hw * 0.7, 0.7, 0, 8));
  return g;
}

function canteen(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // module with warm glowing windows
  g.add(box(fp.innerW * 0.9, 2.2, fp.innerD * 0.7, MAT.hull, 0, 1.1, -fp.hd * 0.1));
  g.add(windowStrip(3, 0.9, 1.0, GLOW.warm, 1.1, -fp.hd * 0.1 + fp.innerD * 0.35 + 0.02, fp.innerW * 0.28));
  // awning over an entrance
  const awning = box(fp.innerW * 0.7, 0.15, 1.4, MAT.orange, 0, 2.2, fp.hd * 0.5);
  awning.rotation.x = 0.18;
  g.add(awning);
  for (const s of [-1, 1]) g.add(cyl(0.08, 0.08, 2.1, MAT.hullDark, s * fp.innerW * 0.3, 1.05, fp.hd * 0.75, 6));
  // tiny tables + stools outside (inside footprint)
  for (const s of [-1, 1]) {
    g.add(cyl(0.35, 0.3, 0.6, MAT.hullGrey, s * fp.innerW * 0.28, 0.3, fp.hd * 0.5, 6));
    g.add(cyl(0.14, 0.14, 0.35, MAT.hullDark, s * fp.innerW * 0.28 + 0.5, 0.18, fp.hd * 0.5, 6));
  }
  // chimney vent with a little steam
  g.add(cyl(0.2, 0.25, 0.8, MAT.hullDark, fp.hw * 0.3, 2.6, -fp.hd * 0.3, 6));
  return g;
}

function rec_dome(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd);
  // court floor
  g.add(cyl(r * 0.95, r * 0.95, 0.3, MAT.orange, 0, 0.15, 0, 10));
  g.add(torus(r * 0.45, 0.06, MAT.hull, 0, 0.32, 0, 4, 16)); // center circle
  // two basketball hoops
  for (const s of [-1, 1]) {
    g.add(cyl(0.1, 0.12, 2.4, MAT.hullDark, s * r * 0.7, 1.2, 0, 6));
    g.add(box(0.9, 0.6, 0.1, MAT.hull, s * r * 0.6, 2.4, 0));
    g.add(torus(0.28, 0.05, MAT.red, s * r * 0.5, 2.1, 0, 4, 10));
  }
  // some low seating around the rim
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI + 0.4;
    g.add(box(1.4, 0.4, 0.5, MAT.blue, Math.cos(a) * r * 0.75, 0.4, Math.sin(a) * r * 0.75));
  }
  // rim + glass dome
  g.add(domeRim(r, MAT.orange, 0.2, 10));
  g.add(dome(r, glassMat, 0, 0.3, 0, 10, 6));
  return g;
}

function park(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const r = Math.min(fp.hw, fp.hd);
  // grassy garden floor
  g.add(cyl(r * 0.95, r * 0.95, 0.3, MAT.foliageDk, 0, 0.15, 0, 10));
  g.add(tree(1.1, -r * 0.3, -r * 0.2));
  g.add(tree(0.9, r * 0.3, r * 0.15));
  g.add(tree(0.7, r * 0.1, -r * 0.35));
  // winding path + a bench
  g.add(cyl(r * 0.3, r * 0.3, 0.06, MAT.pad, 0, 0.2, r * 0.1, 8));
  g.add(box(1.2, 0.3, 0.4, MAT.dirt, r * 0.35, 0.35, -r * 0.35));
  // small glass dome over it
  g.add(domeRim(r, MAT.foliageDk, 0.2, 10));
  g.add(dome(r, glassMat, 0, 0.3, 0, 10, 6));
  return g;
}

function monument(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // tiered plinth
  g.add(box(fp.innerW * 0.8, 0.6, fp.innerD * 0.8, MAT.hullGrey, 0, 0.3, 0));
  g.add(box(fp.innerW * 0.55, 0.8, fp.innerD * 0.55, MAT.hull, 0, 1.0, 0));
  g.add(box(fp.innerW * 0.4, 0.15, fp.innerD * 0.4, MAT.gold, 0, 1.45, 0)); // plaque cap
  // golden astronaut statue built from primitives
  const a = new THREE.Group();
  a.position.y = 1.5;
  a.add(cyl(0.35, 0.4, 1.0, MAT.gold, 0, 0.5, 0, 8));       // torso/pack
  a.add(ball(0.34, MAT.gold, 0, 1.25, 0));                   // helmet
  a.add(box(0.28, 0.12, 0.02, GLOW.window, 0, 1.28, 0.3));   // visor glint
  // legs
  a.add(cyl(0.12, 0.14, 0.7, MAT.gold, -0.15, -0.15, 0, 6));
  a.add(cyl(0.12, 0.14, 0.7, MAT.gold, 0.15, -0.15, 0, 6));
  // one arm raised (planting/saluting)
  const arm = cyl(0.1, 0.1, 0.8, MAT.gold, 0.35, 0.7, 0, 6);
  arm.rotation.z = -0.9;
  a.add(arm);
  a.add(cyl(0.1, 0.1, 0.7, MAT.gold, -0.32, 0.35, 0, 6));
  g.add(a);
  // little flag in the raised hand
  g.add(cyl(0.04, 0.04, 1.2, MAT.hullGrey, 0.85, 2.6, 0, 6));
  g.add(box(0.5, 0.35, 0.03, MAT.red, 1.1, 3.0, 0));
  return g;
}

function flag(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  g.add(cyl(0.3, 0.4, 0.25, MAT.hullDark, 0, 0.12, 0, 8)); // base
  g.add(cyl(0.07, 0.08, 4.0, MAT.hullGrey, 0, 2.0, 0, 6)); // pole
  g.add(ball(0.14, MAT.gold, 0, 4.05, 0));                 // finial
  // stiff flag (wire keeps it out)
  const flagMesh = new THREE.Group();
  flagMesh.add(box(1.6, 1.0, 0.06, MAT.red, 0.85, 0, 0));
  flagMesh.add(box(1.6, 0.2, 0.07, MAT.hull, 0.85, 0.35, 0.01)); // stripe
  flagMesh.position.set(0.03, 3.4, 0);
  g.add(flagMesh);
  g.userData.animate = (t) => {
    flagMesh.rotation.z = Math.sin(t * 2) * 0.06;
    flagMesh.rotation.y = Math.sin(t * 1.3) * 0.12;
  };
  return g;
}

function floodlight(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  g.add(box(1.0, 0.4, 1.0, MAT.hullDark, 0, 0.2, 0));
  g.add(cyl(0.12, 0.16, 4.2, MAT.hullGrey, 0, 2.1, 0, 6));
  // lamp head cluster
  const head = new THREE.Group();
  head.position.set(0, 4.2, 0);
  for (const s of [-1, 1]) {
    const lamp = box(0.7, 0.5, 0.3, MAT.hullDark, s * 0.45, 0, 0.2);
    head.add(lamp);
    head.add(box(0.55, 0.38, 0.12, GLOW.window, s * 0.45, 0, 0.36));
  }
  head.rotation.x = 0.3;
  g.add(head);
  return g;
}

// ---------------- TRANSPORT ----------------

function walkway(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // low path slab spanning the whole cell (so segments abut)
  g.add(box(fp.w, 0.15, fp.w, MAT.regolithDk, 0, 0.075, 0));
  g.add(box(fp.w * 0.7, 0.16, fp.w * 0.7, MAT.pad, 0, 0.085, 0));
  // edge guide studs (tiny glowing lights)
  for (const s of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      g.add(box(0.16, 0.1, 0.16, GLOW.window, s * fp.w * 0.42, 0.16, i * fp.w * 0.3));
    }
  }
  return g;
}

// Connection mask bits, and the Y-rotation that aims a +X-built arm at
// each grid neighbor (local mesh space: +x = east, +z = south).
//   bit 0 = North (-z), 1 = East (+x), 2 = South (+z), 3 = West (-x)
const CONNECT = { N: 1, E: 2, S: 4, W: 8 };
const DIR_ROT_Y = [HALF_PI, 0, -HALF_PI, Math.PI]; // N, E, S, W
const MASK_STRAIGHT_EW = CONNECT.E | CONNECT.W;    // 10
const MASK_STRAIGHT_NS = CONNECT.N | CONNECT.S;    // 5

// A pressurized glass tube that grows an arm toward every neighbor it
// touches, so straight runs, corners, T-joints and crossings all connect.
function tube(def, mask = 0) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const w = fp.w;
  const r = w * 0.28;
  const half = w / 2;
  if (!mask) mask = MASK_STRAIGHT_EW;            // a lone tube is a little corridor
  const straight = (mask === MASK_STRAIGHT_EW) || (mask === MASK_STRAIGHT_NS);

  // center floor pad
  g.add(box(w * 0.55, 0.16, w * 0.55, MAT.hullGrey, 0, 0.08, 0));

  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    const arm = new THREE.Group();
    // base strip from center to the cell edge
    arm.add(box(half + 0.1, 0.16, w * 0.5, MAT.hullGrey, half / 2, 0.08, 0));
    // glass half-tube from center to edge
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, half + 0.06, 8, 1, true, 0, Math.PI),
      glassMat,
    );
    shell.rotation.z = HALF_PI;
    shell.position.set(half / 2, 0.2, 0);
    arm.add(shell);
    // a rib near the outer end
    const rib = torus(r, 0.06, MAT.hullGrey, half * 0.82, 0.2, 0, 6, 12);
    rib.rotation.y = HALF_PI;
    arm.add(rib);
    arm.rotation.y = DIR_ROT_Y[d];
    g.add(arm);
  }
  // a glass dome caps corners, T-joints and crossings (not clean straights)
  if (!straight) g.add(dome(r, glassMat, 0, 0.2, 0, 8, 5));
  return g;
}

// Elevated maglev track — the same connect-by-arms idea, up on pylons, so
// kids can lay their own train lines in any shape.
function track(def, mask = 0) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const w = fp.w;
  const half = w / 2;
  const railY = 3.2;
  if (!mask) mask = MASK_STRAIGHT_EW;
  const straight = (mask === MASK_STRAIGHT_EW) || (mask === MASK_STRAIGHT_NS);

  // support pylon down to the ground
  g.add(cyl(0.22, 0.3, railY, MAT.hullDark, 0, railY / 2, 0, 6));
  // center deck plate
  g.add(box(w * 0.5, 0.22, w * 0.5, MAT.hullGrey, 0, railY, 0));

  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    const arm = new THREE.Group();
    // beam from center to edge
    arm.add(box(half + 0.1, 0.28, 0.7, MAT.hullGrey, half / 2, railY, 0));
    // two bright rails on top
    for (const s of [-1, 1]) {
      arm.add(box(half + 0.1, 0.12, 0.14, MAT.warn, half / 2, railY + 0.2, s * 0.28));
    }
    arm.rotation.y = DIR_ROT_Y[d];
    g.add(arm);
  }
  if (!straight) g.add(box(w * 0.55, 0.16, w * 0.55, MAT.warn, 0, railY + 0.22, 0));
  return g;
}

function rover_garage(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // hangar with a rounded roof
  g.add(box(fp.innerW, 2.0, fp.innerD * 0.9, MAT.hull, 0, 1.0, 0));
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(fp.hw * 0.9, fp.hw * 0.9, fp.innerD * 0.9, 8, 1, false, 0, Math.PI),
    MAT.hullGrey
  );
  roof.rotation.x = HALF_PI;
  roof.position.y = 2.0;
  g.add(roof);
  g.add(warnBand(0.1, 2.0, 1.0, -fp.hw + 0.3, 0));
  // open door — dark recess + raised ramp
  g.add(box(fp.innerW * 0.7, 1.6, 0.2, MAT.hullDark, 0, 0.9, fp.hd * 0.45));
  const ramp = box(fp.innerW * 0.6, 0.15, 1.6, MAT.hullGrey, 0, 0.15, fp.hd * 0.75);
  g.add(ramp);
  // side glowing sign
  g.add(box(0.8, 0.5, 0.1, GLOW.window, -fp.hw * 0.5, 1.6, fp.hd * 0.46));
  return g;
}

function monorail(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  const deck = 3.5;
  // four support pylons
  for (let i = 0; i < 4; i++) {
    const dx = (i % 2 ? 1 : -1) * fp.hw * 0.7;
    const dz = (i < 2 ? 1 : -1) * fp.hd * 0.6;
    g.add(cyl(0.22, 0.3, deck, MAT.hullDark, dx, deck / 2, dz, 6));
  }
  // elevated platform deck
  g.add(box(fp.innerW, 0.3, fp.innerD * 0.9, MAT.hullGrey, 0, deck, 0));
  g.add(box(fp.innerW * 0.9, 0.4, fp.innerD * 0.8, MAT.hull, 0, deck + 0.3, 0));
  // maglev rail running through along X (links stations)
  g.add(box(fp.w, 0.25, 0.5, MAT.warn, 0, deck + 0.1, fp.hd * 0.55));
  // canopy on posts
  for (const s of [-1, 1]) g.add(cyl(0.1, 0.1, 1.8, MAT.hullGrey, s * fp.innerW * 0.4, deck + 1.2, 0, 6));
  const canopy = box(fp.innerW * 1.05, 0.2, fp.innerD * 0.7, MAT.blue, 0, deck + 2.1, 0);
  g.add(canopy);
  // platform lights + a waiting bench
  g.add(box(fp.innerW * 0.8, 0.15, 0.2, GLOW.window, 0, deck + 0.55, -fp.hd * 0.3));
  g.add(box(1.4, 0.35, 0.4, MAT.orange, 0, deck + 0.65, -fp.hd * 0.15));
  return g;
}

function beacon(def) {
  const g = new THREE.Group();
  const fp = footprint(def);
  // tripod mast
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3);
    const leg = cyl(0.06, 0.08, 3.4, MAT.hullGrey, Math.cos(a) * 0.5, 1.6, Math.sin(a) * 0.5, 6);
    leg.rotation.z = -Math.cos(a) * 0.28;
    leg.rotation.x = Math.sin(a) * 0.28;
    g.add(leg);
  }
  g.add(cyl(0.1, 0.1, 1.2, MAT.hullDark, 0, 3.2, 0, 6));
  // rotating beacon housing with a directional lamp
  const rot = new THREE.Group();
  rot.position.y = 3.9;
  rot.add(cyl(0.4, 0.45, 0.7, MAT.hullGrey, 0, 0, 0, 8));
  const lamp = box(0.5, 0.4, 0.35, GLOW.beacon, 0, 0, 0.35);
  rot.add(lamp);
  rot.add(dome(0.4, glassMat, 0, 0.35, 0, 8, 4));
  g.add(rot);
  g.userData.animate = (t) => {
    rot.rotation.y = t * 2.4;
    lamp.scale.z = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(t * 8));
  };
  return g;
}

// ============================================================
// FACTORY MAP + PUBLIC API
// ============================================================
const FACTORY = {
  landing_pod, hab_dome, hab_block, grand_dome, penthouse,
  solar_panel, solar_tower, battery, reactor, fusion,
  oxygen_gen, ice_extractor, hydroponics, greenhouse, water_tank, o2_tank, recycler,
  mine, refinery, drill_rig, fabricator, storage_yard,
  lab, observatory, comms, particle_lab, launch_pad,
  command, medbay, canteen, rec_dome, park, monument, flag, floodlight,
  walkway, tube, track, rover_garage, monorail, beacon,
};

// Builders that render differently depending on which neighbors they touch.
const CONNECTION_AWARE = new Set(['tube', 'track']);
export function isConnectionAware(defId) { return CONNECTION_AWARE.has(defId); }

// Fallback: a simple grey box sized to the footprint (or 1 cell if unknown).
function fallbackMesh(def) {
  const g = new THREE.Group();
  const w = def ? def.size[0] * CELL - MARGIN * 2 : CELL - MARGIN * 2;
  const d = def ? def.size[1] * CELL - MARGIN * 2 : CELL - MARGIN * 2;
  g.add(box(w, 2.0, d, MAT.hullGrey, 0, 1.0, 0));
  g.add(box(w * 0.5, 0.5, d * 0.5, MAT.hullDark, 0, 2.1, 0));
  return g;
}

/**
 * Build a THREE.Group mesh for the given catalog building id.
 * Base rests at y=0, footprint centered on origin. Unknown ids get a
 * neutral grey placeholder box so the scene never breaks.
 */
export function createBuildingMesh(defId, mask = 0) {
  const def = BUILDINGS_BY_ID[defId];
  const builder = FACTORY[defId];
  const group = builder ? builder(def, mask) : fallbackMesh(def);
  group.userData.defId = defId;
  return group;
}

// Internal self-check used by tests — the ids this factory implements.
export function _allIds() {
  return Object.keys(FACTORY);
}
