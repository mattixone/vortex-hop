// Pickups ride on tiles. Collecting one pushes the vortex strength back down,
// by more the deeper (closer to the core) it is when you grab it.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import * as W from './world.js';

// 0 at the rim, 1 at the core.
export function depthOf(x, y) {
  return G.clamp(1 - Math.hypot(x, y) / C.RIM, 0, 1);
}

// How much vortex strength a pickup at (x, y) takes away.
export function calmAt(x, y) {
  return G.lerp(C.CALM_MIN, C.CALM_MAX, Math.pow(depthOf(x, y), C.CALM_CURVE));
}

function randomPointOn(tile) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * G.TAU, d = Math.random() * tile.radius * 0.5;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (G.pointInPolygon(x, y, tile.poly)) return { x, y };
  }
  return { x: 0, y: 0 }; // tiles are centred on their centroid
}

function spawn(state) {
  const p = state.player;
  const taken = new Set(state.pickups.map((k) => k.tile));
  const options = state.tiles.filter((t) => {
    if (t.rubble || t === p.tile || taken.has(t)) return false;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    return d > C.PICKUP_SPAWN_MIN && d < C.PICKUP_SPAWN_MAX && Math.hypot(t.x, t.y) > C.CORE_NO_COLLIDE;
  });
  if (!options.length) return;
  const tile = options[Math.floor(Math.random() * options.length)];
  const l = randomPointOn(tile);
  const w = W.toWorld(tile, l.x, l.y);
  state.pickups.push({ tile, lx: l.x, ly: l.y, x: w.x, y: w.y, age: 0 });
}

// When a tile breaks, its pickups move to whichever piece they were on.
export function rehome(state, parent, frags) {
  for (const k of state.pickups) {
    if (k.tile !== parent) continue;
    const f = frags.find((q) => G.pointInPolygon(k.lx, k.ly, q.srcCell));
    if (f && !f.rubble) {
      k.tile = f;
      k.lx -= f.srcCenter.x;
      k.ly -= f.srcCenter.y;
    } else {
      k.tile = null; // lost with a crumb
    }
  }
}

// Moves pickups with their tiles, collects any the player touches, keeps the count up.
// Returns the pickups collected this frame (with the calm they gave).
export function updatePickups(state, dt, alive) {
  const p = state.player;
  const got = [];
  state.pickups = state.pickups.filter((k) => {
    if (!k.tile || !alive.has(k.tile)) return false;
    const w = W.toWorld(k.tile, k.lx, k.ly);
    k.x = w.x;
    k.y = w.y;
    k.age += dt;
    if (Math.hypot(k.x - p.x, k.y - p.y) > C.PICKUP_FORGET) return false;
    if (p.mode !== 'falling' && Math.hypot(k.x - p.x, k.y - p.y) < C.PICKUP_RADIUS) {
      got.push({ x: k.x, y: k.y, calm: calmAt(k.x, k.y) });
      return false;
    }
    return true;
  });
  while (state.pickups.length < C.PICKUP_COUNT) {
    const before = state.pickups.length;
    spawn(state);
    if (state.pickups.length === before) break;
  }
  return got;
}
