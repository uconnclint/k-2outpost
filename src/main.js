// ============================================================
// SPACE BUILDERS — bootstrap & main loop (K-2 free-build edition)
//
// Reuses the whole Lunar Outpost renderer (moon, stars, Earth, the
// 39 low-poly buildings, walking astronauts, rovers, trams, pods).
// Everything goal-shaped is gone: no sim, no missions, no economy.
// Kids just build. We keep the world alive with a gentle day/night,
// friends that move in as homes appear, sparkles, and rockets.
// ============================================================

import * as THREE from 'three';
import { GRID, PALETTE, LIGHTING } from './core/constants.js';
import { state, events, place, canPlace, demolish, clearAll, save, load, hasSave, clearSave, recomputeStatics } from './core/state.js';
import { createTerrain, createSky, terrainHeight } from './world/terrain.js';
import { RtsCamera } from './world/camera.js';
import { Structures, buildingCenter } from './world/structures.js';
import { PlacementTool } from './world/placement.js';
import { Citizens } from './world/citizens.js';
import { Vehicles } from './world/vehicles.js';
import { Effects } from './world/effects.js';
import { BUILDINGS_BY_ID } from './core/catalog.js';
import { initUI } from './ui/ui.js';
import { audio } from './core/audio.js';
import { voice } from './core/voice.js';
import bootMoonUrl from './assets/icons/world-moon.png?url';
import bootRocketUrl from './assets/icons/victory-rocket.png?url';

// ---------------- renderer ----------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); // Chromebook/iPad friendly
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.space);
scene.fog = new THREE.Fog(PALETTE.space, GRID.WORLD * 1.1, GRID.WORLD * 2.4);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.5, 4000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- lights ----------------
const sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
sun.position.set(300, 260, 120);
scene.add(sun);
const earthshine = new THREE.DirectionalLight(LIGHTING.earthshineColor, LIGHTING.earthshineIntensity);
earthshine.position.set(-200, 150, -260);
scene.add(earthshine);
const ambient = new THREE.AmbientLight(LIGHTING.ambientColor, LIGHTING.ambientIntensity);
scene.add(ambient);

// ---------------- world ----------------
const terrain = createTerrain();
scene.add(terrain);
const sky = createSky();
scene.add(sky);

const rtsCam = new RtsCamera(camera, canvas);
const structures = new Structures(scene);
const placementTool = new PlacementTool(scene, camera, canvas, rtsCam);
const citizens = new Citizens(scene);
const vehicles = new Vehicles(scene);
const effects = new Effects(scene);

// ---------------- boot / new game / continue ----------------
const bootScreen = document.getElementById('boot-screen');
const bootStart = document.getElementById('boot-start');
const bootContinue = document.getElementById('boot-continue');
const bootProgress = document.getElementById('boot-progress');

// dress the boot screen with the hand-made art
const bootMoon = document.getElementById('boot-moon');
const bootRocket = document.getElementById('boot-rocket');
if (bootMoon) bootMoon.src = bootMoonUrl;
if (bootRocket) bootRocket.src = bootRocketUrl;

function newGame() {
  clearSave();
  // a little rocket home to start next to, right in the middle
  place('landing_pod', -1, -1, 0);
  recomputeStatics();
}

// A friendly opening shot: the little rocket home sits front and center
// with plenty of open moon around it to start building on.
function frameStartView() {
  rtsCam.focusOn(0, 0, 48);
  rtsCam.goal.yaw = Math.PI * 0.25; rtsCam.yaw = Math.PI * 0.25;
  rtsCam.goal.polar = 0.92; rtsCam.polar = 0.92;
}

function startGame(fresh) {
  if (fresh) newGame();
  else if (!load()) newGame();
  frameStartView();
  bootScreen.classList.add('fade-out');
  setTimeout(() => bootScreen.remove(), 900);
  audio.init();
  // Unlocks BOTH the clip <audio> path and ctx.speech's SpeechSynthesis
  // fallback for iOS/Safari, inside this real user gesture (the PLAY/Keep
  // Building tap) — see voice.js's unlock() for why the TTS fallback
  // specifically needs this even though the old clip-only code never did.
  voice.unlock();
  voice.say('welcome');
  running = true;
}

bootProgress.style.width = '100%';
setTimeout(() => {
  bootStart.classList.remove('hidden');
  if (hasSave()) bootContinue.classList.remove('hidden');
}, 500);
bootStart.addEventListener('click', () => startGame(true));
bootContinue.addEventListener('click', () => startGame(false));

// ---------------- fire a rocket off the pad (or the middle) ----------------
function launchRocket() {
  // Launch from the rocket pad if there is one (rocket sits right on it),
  // otherwise from open ground beside the base so it's never hidden.
  const pad = state.buildings.find(b => b.id === 'launch_pad');
  if (pad) {
    const c = buildingCenter(pad);
    effects.launchRocket(c.x, c.z);
  } else {
    const anchor = state.buildings.find(b => b.id === 'landing_pod')
      || state.buildings[state.buildings.length - 1];
    const c = anchor ? buildingCenter(anchor) : { x: 0, z: 0 };
    effects.launchRocket(c.x + 6, c.z + 6);
  }
  audio.rocket();
  voice.say('blastoff');
}

// ---------------- UI ----------------
initUI({ placementTool, rtsCam, structures, renderer, launchRocket, clearAll });

events.on('save-game', () => save());
events.on('new-game-request', () => { clearSave(); location.reload(); });

// ---------------- delight: sparkles, sounds, friends moving in ----------------
let lastArrival = 0;
events.on('placed', (b) => {
  const def = BUILDINGS_BY_ID[b.id];
  const c = buildingCenter(b);
  const y = terrainHeight(c.x, c.z) + 1.2;
  effects.sparkle(c.x, y, c.z);
  audio.place();
  voice.cheer();
  // when a home appears, welcome some friends with a supply pod
  if (def && def.homes) {
    const now = performance.now();
    if (now - lastArrival > 600) {
      lastArrival = now;
      events.emit('arrival', Math.min(4, Math.ceil(def.homes / 6)));
    }
  }
});
events.on('demolished', (b) => {
  const c = buildingCenter(b);
  const y = terrainHeight(c.x, c.z) + 1.0;
  effects.sparkle(c.x, y, c.z, { count: 8, spread: 1.6 });
  audio.erase();
  voice.bye();
});
// clearing everything says "all clean!" (it cuts off the bye-byes above)
events.on('cleared', () => voice.say('allclean'));

// keep the walking-astronaut count in step with how many homes exist
function syncFriends() {
  const target = Math.min(24, state.homes);
  state.population = target;
}
events.on('statics', syncFriends);
events.on('loaded', syncFriends);

// autosave
setInterval(() => { if (running) save(); }, 20000);
window.addEventListener('beforeunload', () => { if (running) save(); });

// ---------------- gentle day/night ----------------
// A slow, friendly cycle that never goes fully dark — twilight at most,
// so the moon is always easy to see. Windows glow, stars stay out.
const nightAmbient = new THREE.Color(0x24304f);
const dayAmbient = new THREE.Color(LIGHTING.ambientColor);
const DAY_SPEED = (Math.PI * 2) / 240;   // full cycle ~4 minutes
function updateLighting(time) {
  const day = 0.5 + 0.5 * Math.sin(time * DAY_SPEED);   // 0 (twilight) .. 1 (noon)
  sun.intensity = LIGHTING.sunIntensity * (0.6 + 0.5 * day);
  ambient.intensity = LIGHTING.ambientIntensity * (0.8 + 0.3 * day);
  ambient.color.copy(nightAmbient).lerp(dayAmbient, day);
  earthshine.intensity = LIGHTING.earthshineIntensity * (1.4 - 0.5 * day);
  if (sky.userData.sun) sky.userData.sun.visible = day > 0.12;
  if (sky.userData.earth) sky.userData.earth.rotation.y += 0.0003;
}

// ---------------- main loop ----------------
let running = false;
let last = performance.now();
let time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running) { renderer.render(scene, camera); return; }
  time += dt;

  try {
    updateLighting(time);
    rtsCam.update(dt, terrainHeight);
    structures.update(time, dt);
    citizens.update(time, dt);
    vehicles.update(time, dt);
    effects.update(dt);
    audio.update(dt);
  } catch (err) {
    console.error('[frame]', err);
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// dev hook
window.__SB__ = {
  state, events, place, canPlace, demolish, clearAll, launchRocket, scene, vehicles, voice,
  // manually advance the world (used to verify motion in headless testing)
  step(n = 1, dt = 0.05) {
    for (let i = 0; i < n; i++) {
      time += dt;
      structures.update(time, dt);
      citizens.update(time, dt);
      vehicles.update(time, dt);
      effects.update(dt);
    }
    updateLighting(time);
    renderer.render(scene, camera);
  },
};
