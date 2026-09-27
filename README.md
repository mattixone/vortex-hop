# Vortex Hop

A small browser game: hop between tiles drifting around a vortex and escape to the rim. Tiles break into Voronoi fragments where you land, and smaller fragments spin faster towards the centre.

No build step and no dependencies: just `index.html` and the files in `js/`.

## Controls

| | Touch | Keyboard |
|---|---|---|
| Walk | Joystick: put your left thumb anywhere on the left half | Arrows or WASD |
| Jump | Slider appears under your right thumb. Slide up = further, down into the red = cancel, let go = jump. | Hold Space (fills the slider), Esc cancels |
| Restart | | R |

Directions are relative to the screen: up always points outward, towards the rim. Walking off your tile's edge steps you onto any tile that overlaps it (or nearly touches it); otherwise you slide along the edge.

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
| `js/input.js` | On-screen joystick and jump slider, keyboard. |
| `js/main.js` | Game state, walking, jumping, main loop. |
| `js/render.js` | Drawing: vortex, tiles, player, minimap, HUD, controls. |

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, then pick this repo.
2. Production branch: `main`. Framework preset: **None**. Build command: leave empty. Build output directory: `/` (repo root).
3. Save and deploy. Every push redeploys, and other branches get preview URLs.

## Roadmap

- [x] Spiral motion, size-based speed, jumping, Voronoi cracking and shattering
- [x] Checkpoint rings, follow camera (outward is up), minimap
- [x] Joystick + jump slider, walking between overlapping tiles
- [x] Size-based fracturing: small tiles split in 2–3 and hold longer, the piece you landed on keeps breaking, a piece you walked onto waits until you move, tiny gem tiles never break
- [ ] Asteroids: steady orbit, clear a gap around them, fling you off after a few seconds
- [ ] Collectables: long-jump charge, slingshot stones
- [ ] Slingshot: shatter a far tile so its fragments come to you
- [ ] Zone palettes and tuning, sound, leaderboard (Worker + D1)
