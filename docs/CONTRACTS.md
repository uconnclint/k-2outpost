# LUNAR OUTPOST — Module Contracts

Flat-shaded low-poly 3D moon colony builder. Three.js r185, ES modules, Vite.
Target: Chromebooks & iPads — cheap geometry, no textures (vertex colors / solid materials only),
touch-first UI. Import three as `import * as THREE from 'three'`.

## Shared core (already written — read, do not modify)
- `src/core/constants.js` — GRID (CELL=4, SIZE=96), PALETTE (use ONLY these colors), SIM, TIERS, CAMERA.
- `src/core/catalog.js` — BUILDINGS (38 defs), BUILDINGS_BY_ID, CATEGORIES, buildingsForTier(tier).
- `src/core/state.js` — `state` (resources, rates, power, population, housing, jobs, happiness, tier,
  buildings[{uid,id,gx,gy,rot,disabled}], grid Map "gx,gy"->uid, time{ticks,sol,tod,speed,paused},
  missionIndex, stats), `events.on(name,fn)/emit`, place/demolish/canPlace/effectiveCost/buildingAt,
  save/load/hasSave/clearSave, gridKey, cellsFor, inBounds.
- `src/core/sim.js` — emits events; `sunFactor()` 0..1 daylight.
- `src/world/terrain.js` — `terrainHeight(x,z)`.
- `src/world/structures.js` — `cellCenter(gx,gy)->{x,z}`, `buildingCenter(b)->{x,z,w,d}`, Structures class
  (has `meshFor(uid)`).
- `src/world/placement.js` — PlacementTool: `setBuild(defId)`, `setDemolish()`, `clear()`, `rotate()`, `.mode`, `.defId`.
- `src/world/camera.js` — RtsCamera: `focusOn(x,z,dist)`.

## Events emitted by core
`placed`(b), `demolished`(b), `loaded`, `saved`, `new-game`, `tick`, `sol`(n), `tier`(n), `arrival`(count),
`colonist-lost`, `shortage`(res), `power-shortage`(ratio), `statics`, `tool`({mode,defId}),
`select`(b|null), `place-failed`(reason).
Events UI may emit for main: `save-game`, `new-game-request`.

## Grid → world mapping
Cell (gx,gy): center at `((gx+0.5)*GRID.CELL, (gy+0.5)*GRID.CELL)`. gx,gy ∈ [-48, 48).
Building anchored at min corner (gx,gy); rot ∈ 0..3 swaps w/d when odd.

## Style rules (all modules)
- MeshLambertMaterial with `flatShading: true`; colors from PALETTE only. No textures, no shadows.
- Low poly: cylinders ≤ 8 segments, spheres = IcosahedronGeometry detail ≤ 1, domes = SphereGeometry ≤ 10x6.
- Reuse geometries/materials at module scope where possible.
- No external assets, no new npm deps.

## Module assignments
1. `src/content/buildings.js` → `createBuildingMesh(defId) -> THREE.Group`
   - Footprint centered at origin: `def.size[0]*CELL` wide (x) × `def.size[1]*CELL` deep (z), base at y=0.
     Keep ~0.3 margin inside footprint edges. Foundation pad is added by structures.js — don't add one.
   - Optional `group.userData.animate = (time, dt) => {}` for rotating dishes, blinking beacons, etc.
   - Must handle ALL 38 ids in catalog.js + fallback box for unknown ids.
2. `src/world/citizens.js` → `export class Citizens { constructor(scene); update(time, dt) }`
3. `src/world/vehicles.js` → `export class Vehicles { constructor(scene); update(time, dt) }`
4. `src/ui/ui.js` → `export function initUI({placementTool, rtsCam, structures, renderer})`;
   `src/ui/style.css` (linked from index.html; contains #boot-screen styles too).
5. `src/core/audio.js` → `export const audio = { init(), update(dt), setEnabled(on), enabled }` —
   procedural WebAudio only; self-subscribes to events.
6. `src/core/missions.js` → `export function initMissions()` — emits `mission-changed`(mission),
   `mission-complete`(mission); mission = {id, title, desc, check()}; UI renders current mission from these events.
