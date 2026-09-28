# Vortex Hop

A small browser game: survive on tiles drifting around a vortex for as long as you can. The vortex keeps getting stronger, every fall makes it 1× stronger, and the run ends when it reaches 5×. Tiles break into Voronoi fragments where you land, and smaller fragments spin faster towards the centre.

No build step and no dependencies: just `index.html` and the files in `js/`.

## Controls

| | Touch | Keyboard |
|---|---|---|
| Walk | Joystick: put your left thumb anywhere on the left half | Arrows or WASD |
| Jump | Slider appears under your right thumb. Slide up = further, down into the red = cancel, let go = jump. | Hold Space (fills the slider), Esc cancels |
| Restart | | R |

Directions are relative to the screen. When you stop walking, the view swings round so you're facing up the screen, and a small gold arrow next to you always points to the rim. The camera zooms in when you're on smaller tiles. Walking off your tile's edge steps you onto any tile that overlaps it (or nearly touches it); otherwise you slide along the edge.

## Run it locally

ES modules don't load from `file://`, so serve the folder:

```sh
npx serve .        # or: python3 -m http.server
```

## Files

| File | What's in it |
|---|---|
| `js/config.js` | Every tunable number (speeds, sizes, jump range, rings). Start here. |
| `js/geometry.js` | Polygon helpers and the Voronoi clipping. |
| `js/world.js` | Tile motion, cracking, shattering, keeping the vortex stocked. |
| `js/physics.js` | Tile-on-tile collisions (convex polygons, impulses, spin). |
| `js/pickups.js` | Pickups: spawning on tiles, riding along, collecting, depth-based value. |
| `js/input.js` | On-screen joystick and jump slider, keyboard. |
| `js/main.js` | Game state, walking, jumping, main loop. |
| `js/render.js` | Drawing: vortex, tiles, player, minimap, HUD, controls. |

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, then pick this repo.
2. Production branch: `main`. Framework preset: **None**. Build command: leave empty. Build output directory: `/` (repo root).
3. Save and deploy. Every push redeploys, and other branches get preview URLs.

## Roadmap

- [x] Spiral motion, size-based speed, jumping, Voronoi cracking and shattering
- [x] Checkpoint rings, follow camera, minimap
- [x] Joystick + jump slider, walking between overlapping tiles
- [x] Camera turns to your facing direction when you stop; zoom follows tile size
- [x] Tiles collide and bump each other instead of overlapping
- [x] Survival run: the vortex strengthens over time, a fall adds +1× and respawns you, the run ends at 5×, best time saved on the device
- [x] Pickups on tiles calm the vortex; the deeper they are, the more time they buy
- [x] Edge-of-screen arrows point to the nearest off-screen pickups
- [ ] Tuning: map size, starting zone, strength curve, pickup count and values
- [x] Size-based fracturing: small tiles split in 2–3, every crack takes 3.5s, the piece you're left on waits until you move, tiny gem tiles never break
- [ ] Asteroids: steady orbit, clear a gap around them, fling you off after a few seconds
- [ ] Collectables: long-jump charge, slingshot stones
- [ ] Slingshot: shatter a far tile so its fragments come to you
- [ ] Zone palettes and tuning, sound, leaderboard (Worker + D1)
