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
  // Spawn around a random player still in the game, so pickups show up near everyone.
  const live = state.actors.filter((a) => !a.out);
  const p = live[Math.floor(Math.random() * live.length)] || state.player;
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

// Moves pickups with their tiles, collects any a player touches, keeps the count up.
// Returns the pickups collected this frame: { actor, x, y, calm }.
export function updatePickups(state, dt, alive) {
  const live = state.actors.filter((a) => !a.out);
  const got = [];
  state.pickups = state.pickups.filter((k) => {
    if (!k.tile || !alive.has(k.tile)) return false;
    const w = W.toWorld(k.tile, k.lx, k.ly);
    k.x = w.x;
    k.y = w.y;
    k.age += dt;
    let near = Infinity;
    for (const a of live) {
      const d = Math.hypot(k.x - a.x, k.y - a.y);
      near = Math.min(near, d);
      if (a.mode !== 'falling' && d < C.PICKUP_RADIUS) {
        got.push({ actor: a, x: k.x, y: k.y, calm: calmAt(k.x, k.y) });
        return false;
      }
    }
    return near <= C.PICKUP_FORGET;
  });
  while (state.pickups.length < state.pickupCount) {
    const before = state.pickups.length;
    spawn(state);
    if (state.pickups.length === before) break;
  }
  return got;
}
