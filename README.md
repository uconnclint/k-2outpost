# 🚀 SPACE BUILDERS

A gentle, goal-free space-city sandbox for **K–2 kids** (ages ~5–8).

Same gorgeous flat-shaded low-poly Moon, buildings, walking astronauts,
rovers and rockets as [Lunar Outpost](../Outpost) — but with **all the
goals, resources, costs, and tech unlocked away**. Kids just tap a
picture and tap the Moon to build. That's the whole game.

## Play

```bash
npm install
npm run dev        # http://localhost:5174
npm run build      # static build in dist/ — host anywhere
```

Runs in any modern browser. Designed for Chromebooks and iPads:
touch-first, big tap targets, capped pixel ratio, zero textures.

## For little builders

- **Tap a picture, then tap the Moon.** Build as many as you want, anywhere.
- **🖐️ Move** to look around · **🔄 Turn** to spin a building · **🧽 Erase** to remove.
- **🚀 BLAST OFF** launches a rocket with a glittery trail.
- **🧹** clears everything (tap twice), **🔊** turns the sound on/off.
- Build **homes** and little astronauts move in and walk around. Build a
  **Rover Garage** for a buggy.
- Drag out **Tubes** and **Train Tracks** to make lines in any shape — they
  bend around corners. Lay **Train Track** and a little train rides it; a big
  loop gets a whole fleet of trains.

## What changed from Lunar Outpost

Kept the whole renderer: terrain, craters, stars, Earth, the 39 low-poly
building models, citizens, vehicles, camera, day/night. Removed the
economy sim, missions, tech tiers, costs, happiness, and the goal-driven
HUD. Added a big kid UI, cheerful procedural sounds, sparkle bursts, and
a blast-off rocket.

No assets — every mesh, sound, and star is procedural. Built with Three.js.
