// ============================================================
// SPACE BUILDERS — kid catalog (K-2 free-build edition)
//
// Same 39 hand-built low-poly models as Lunar Outpost, but with
// every goal stripped out: no cost, no tech tier, no unique locks.
// Tap any picture, place as many as you like, anywhere.
//
// Each entry keeps the fields the ENGINE needs:
//   size    [w, d] grid cells   (mesh + placement)
//   path    true                (walkway/tube: no foundation, path graph)
//   dragPlace true              (paint by dragging)
//   tube / rover / monorail     (vehicles hooks)
//   homes   number              (how many space friends move in — drives
//                                the walking astronauts; purely for delight)
//
// Plus kid-facing fields:
//   name   friendly short label
//   emoji  a big picture pre-readers recognize
//   cat    kid category id (see CATEGORIES)
// ============================================================

// Big, friendly buckets. Order = tab order. Each has a bright color.
export const CATEGORIES = [
  { id: 'homes',   name: 'Homes',    emoji: '🏠', color: '#4d96ff' },
  { id: 'power',   name: 'Power',    emoji: '⚡', color: '#ffca3a' },
  { id: 'plants',  name: 'Plants',   emoji: '🌱', color: '#06d6a0' },
  { id: 'space',   name: 'Space',    emoji: '🚀', color: '#4dd6c8' },
  { id: 'fun',     name: 'Fun',      emoji: '🎉', color: '#ef476f' },
  { id: 'work',    name: 'Machines', emoji: '🏭', color: '#ff8c42' },
  { id: 'science', name: 'Science',  emoji: '🔬', color: '#9b5de5' },
  { id: 'roads',   name: 'Roads',    emoji: '🛤️', color: '#8ac6ff' },
];

export const BUILDINGS = [
  // ---------- HOMES ----------
  { id: 'landing_pod', cat: 'homes', name: 'Rocket Home', emoji: '🛸', size: [2, 2], homes: 4 },
  { id: 'hab_dome',    cat: 'homes', name: 'Dome House',  emoji: '🏠', size: [2, 2], homes: 6 },
  { id: 'hab_block',   cat: 'homes', name: 'Apartments',  emoji: '🏢', size: [2, 3], homes: 14 },
  { id: 'grand_dome',  cat: 'homes', name: 'Big Dome',    emoji: '🏟️', size: [4, 4], homes: 40 },
  { id: 'penthouse',   cat: 'homes', name: 'Tall Tower',  emoji: '🗼', size: [2, 2], homes: 30 },

  // ---------- POWER ----------
  { id: 'solar_panel', cat: 'power', name: 'Sun Panel',  emoji: '☀️', size: [2, 1] },
  { id: 'solar_tower', cat: 'power', name: 'Sun Tower',  emoji: '🔆', size: [2, 2] },
  { id: 'battery',     cat: 'power', name: 'Battery',    emoji: '🔋', size: [1, 2] },
  { id: 'reactor',     cat: 'power', name: 'Reactor',    emoji: '⚛️', size: [3, 3] },
  { id: 'fusion',      cat: 'power', name: 'Star Power', emoji: '💫', size: [3, 3] },

  // ---------- PLANTS ----------
  { id: 'greenhouse',    cat: 'plants', name: 'Greenhouse',  emoji: '🌳', size: [3, 3] },
  { id: 'hydroponics',   cat: 'plants', name: 'Veggie Farm', emoji: '🥬', size: [2, 2] },
  { id: 'park',          cat: 'plants', name: 'Flower Park', emoji: '🌷', size: [2, 2] },
  { id: 'oxygen_gen',    cat: 'plants', name: 'Air Maker',   emoji: '💨', size: [1, 2] },
  { id: 'water_tank',    cat: 'plants', name: 'Water Tank',  emoji: '💧', size: [1, 1] },
  { id: 'o2_tank',       cat: 'plants', name: 'Air Tank',    emoji: '🫧', size: [1, 1] },
  { id: 'ice_extractor', cat: 'plants', name: 'Ice Digger',  emoji: '🧊', size: [2, 2] },

  // ---------- SPACE ----------
  { id: 'launch_pad',   cat: 'space', name: 'Rocket Pad',   emoji: '🚀', size: [4, 4] },
  { id: 'rover_garage', cat: 'space', name: 'Rover Garage', emoji: '🚙', size: [2, 2], rover: true },
  { id: 'monorail',     cat: 'space', name: 'Space Train',  emoji: '🚝', size: [2, 2], monorail: true },
  { id: 'track',        cat: 'space', name: 'Train Track',  emoji: '🛤️', size: [1, 1], track: true, dragPlace: true, connectGroup: 'rail' },
  { id: 'beacon',       cat: 'space', name: 'Blinky Light', emoji: '🚨', size: [1, 1] },

  // ---------- FUN ----------
  { id: 'rec_dome',   cat: 'fun', name: 'Sports Dome',  emoji: '🏀', size: [3, 3] },
  { id: 'canteen',    cat: 'fun', name: 'Snack Bar',    emoji: '🍔', size: [2, 2] },
  { id: 'medbay',     cat: 'fun', name: 'Doctor',       emoji: '🏥', size: [2, 2] },
  { id: 'command',    cat: 'fun', name: 'Control Room', emoji: '🎛️', size: [3, 3] },
  { id: 'monument',   cat: 'fun', name: 'Statue',       emoji: '🗽', size: [2, 2] },
  { id: 'flag',       cat: 'fun', name: 'Flag',         emoji: '🚩', size: [1, 1] },
  { id: 'floodlight', cat: 'fun', name: 'Big Light',    emoji: '💡', size: [1, 1] },

  // ---------- MACHINES ----------
  { id: 'mine',         cat: 'work', name: 'Digger',      emoji: '⛏️', size: [2, 2] },
  { id: 'refinery',     cat: 'work', name: 'Metal Maker', emoji: '🏭', size: [3, 2] },
  { id: 'drill_rig',    cat: 'work', name: 'Big Drill',   emoji: '🛢️', size: [2, 2] },
  { id: 'fabricator',   cat: 'work', name: '3D Printer',  emoji: '🖨️', size: [2, 2] },
  { id: 'storage_yard', cat: 'work', name: 'Boxes',       emoji: '📦', size: [2, 2] },
  { id: 'recycler',     cat: 'work', name: 'Recycler',    emoji: '♻️', size: [2, 2] },

  // ---------- SCIENCE ----------
  { id: 'lab',          cat: 'science', name: 'Lab',          emoji: '🔬', size: [2, 2] },
  { id: 'observatory',  cat: 'science', name: 'Star Watcher', emoji: '🔭', size: [2, 2] },
  { id: 'comms',        cat: 'science', name: 'Big Dish',     emoji: '📡', size: [2, 2] },
  { id: 'particle_lab', cat: 'science', name: 'Atom Ring',    emoji: '🌀', size: [3, 3] },

  // ---------- ROADS ----------
  { id: 'walkway', cat: 'roads', name: 'Path', emoji: '🟫', size: [1, 1], path: true, dragPlace: true, connectGroup: 'ground' },
  { id: 'tube',    cat: 'roads', name: 'Tube', emoji: '🚇', size: [1, 1], path: true, tube: true, dragPlace: true, connectGroup: 'ground' },
];

export const BUILDINGS_BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));

// Everything is always available in free-build. Kept so any leftover
// engine call still resolves to the full list.
export function buildingsForTier() {
  return BUILDINGS;
}
