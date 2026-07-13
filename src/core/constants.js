// ============================================================
// LUNAR OUTPOST — global constants & palette
// Flat-shaded low-poly aesthetic. All colors live here so the
// whole game reads as one palette.
// ============================================================

export const GRID = {
  CELL: 4,            // world units per grid cell
  SIZE: 96,           // grid cells per side (world is GRID.SIZE * CELL across)
  get WORLD() { return this.CELL * this.SIZE; },
};

export const PALETTE = {
  // Moon surface
  regolith:      0x8a8f9c,
  regolithDark:  0x6e7380,
  regolithLight: 0xa8adba,
  crater:        0x5c6170,
  rock:          0x757a88,

  // Sky
  space:         0x05060e,
  earthBlue:     0x3d7dd8,
  earthGreen:    0x4caf6d,
  earthCloud:    0xf2f5fa,
  star:          0xffffff,

  // Structures
  hullWhite:     0xe8eaf0,
  hullGrey:      0xb8bcc8,
  hullDark:      0x4a4e5c,
  accentOrange:  0xff8c42,
  accentYellow:  0xffd166,
  accentRed:     0xef476f,
  accentTeal:    0x06d6a0,
  accentBlue:    0x4d96ff,
  accentPurple:  0x9b5de5,
  glassBlue:     0x9fd8ff,
  glassWarm:     0xffe8b0,
  solarBlue:     0x1d3a8f,
  solarCell:     0x2b52c7,
  metalGold:     0xd4a94e,
  foliage:       0x53c26b,
  foliageDark:   0x2e8b4a,
  dirt:          0x7a5c43,
  pad:           0x9599a6,
  padLine:       0xffd166,
  tubeGlass:     0xbfe3ff,
  warnStripe:    0xffb703,

  // UI-ish glows
  glowWindow:    0xfff3c4,
  glowEngine:    0x7fd8ff,
  beacon:        0xff5c5c,
};

// Sun/light — long lunar day, warm key light + blue earthshine fill
export const LIGHTING = {
  sunColor: 0xfff4e0,
  sunIntensity: 2.4,
  earthshineColor: 0x6d8fd8,
  earthshineIntensity: 0.45,
  ambientColor: 0x2a2e42,
  ambientIntensity: 1.1,
};

export const SIM = {
  TICK_SECONDS: 1.0,        // one economy tick per real second (at 1x speed)
  DAY_LENGTH: 240,          // seconds of real time per lunar "sol" (game day)
  START_RESOURCES: { metal: 320, oxygen: 150, water: 120, food: 120, science: 0 },
  STORAGE_BASE: { metal: 500, oxygen: 250, water: 250, food: 250 },
  POP_FOOD_USE: 0.03,       // per colonist per tick
  POP_WATER_USE: 0.025,
  POP_O2_USE: 0.04,
  GROWTH_INTERVAL: 25,      // ticks between arrivals when happiness/housing allow
  COST_SCALE: 0.7,          // student-friendly difficulty: all builds ~30% cheaper
};

export const TIERS = [
  { id: 0, name: 'Touchdown',     science: 0 },
  { id: 1, name: 'Foothold',      science: 40 },
  { id: 2, name: 'Expansion',     science: 150 },
  { id: 3, name: 'Frontier City', science: 420 },
];

export const CAMERA = {
  minDist: 14,
  maxDist: 220,
  startDist: 90,
  minPolar: 0.22,   // radians from vertical
  maxPolar: 1.35,
  panBound: GRID.WORLD * 0.55,
};
