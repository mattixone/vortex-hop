// Tiles: how they drift around the vortex, crack, and shatter.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';

let nextId = 1;

function tileFromPoly(x, y, poly, angle) {
  const area = G.polygonArea(poly);
  let radius = 0;
  for (const p of poly) radius = Math.max(radius, Math.hypot(p.x, p.y));
  return {
    id: nextId++,
    x, y, angle, poly, area, radius,
    spin: (Math.random() - 0.5) * 0.3,
    kx: 0, ky: 0,              // shatter kick velocity, decays over time
    crack: null,               // set when someone lands on the tile
    rubble: area < C.MIN_AREA, // too small to stand on; drifts until swallowed
    solid: area >= C.MIN_AREA && area < C.SOLID_AREA, // too small to split: never cracks
    dormant: false,            // a piece you walked onto before its tile broke: waits for you to move
  };
}

export function createTile(x, y, size) {
  return tileFromPoly(x, y, G.makeBlob(size), Math.random() * G.TAU);
}

export function speedFactor(area) {
  return G.clamp(Math.sqrt(C.REF_AREA / area), C.SPEED_FACTOR_MIN, C.SPEED_FACTOR_MAX);
}

// Angular and radial speed for something of `area` at radius `r`.
export function vortexVelocity(r, area) {
  const w = C.BASE_SPIN * speedFactor(area) * Math.pow(C.R_REF / Math.max(r, 60), C.SPIN_FALLOFF);
  return { w, vr: -C.INWARD_PULL * r * w };
}

// Moves a body along the vortex. Integrating in polar coordinates keeps orbits stable.
export function driftPoint(body, area, dt) {
  let r = Math.hypot(body.x, body.y);
  let th = Math.atan2(body.y, body.x);
  const { w, vr } = vortexVelocity(r, area);
  r = Math.max(0, r + vr * dt);
  th += w * dt;
  body.x = Math.cos(th) * r;
  body.y = Math.sin(th) * r;
}

export function updateTile(t, dt) {
  driftPoint(t, t.area, dt);
  t.x += t.kx * dt;
  t.y += t.ky * dt;
  const damp = Math.exp(-C.KICK_DAMPING * dt);
  t.kx *= damp;
  t.ky *= damp;
  t.angle += t.spin * dt;
  if (t.crack) t.crack.t += dt;
}

// Converts a world point into the tile's local frame.
export function toLocal(t, x, y) {
  return G.rotate(x - t.x, y - t.y, -t.angle);
}

export function toWorld(t, lx, ly) {
  const p = G.rotate(lx, ly, t.angle);
  return { x: t.x + p.x, y: t.y + p.y };
}

export function containsPoint(t, x, y) {
  const dx = x - t.x, dy = y - t.y;
  if (dx * dx + dy * dy > t.radius * t.radius) return false;
  const l = toLocal(t, x, y);
  return G.pointInPolygon(l.x, l.y, t.poly);
}

// Landing starts the crack. The fracture pattern is decided right now, so the
// cracks drawn while the timer runs are exactly where the tile will break.
// How many pieces a tile breaks into: more for bigger tiles, and never so many
// that every piece would be rubble.
function pieceCount(t) {
  const n = Math.round(Math.sqrt(t.area) / C.SHARD_SIZE + (Math.random() - 0.5));
  return Math.max(C.SHARDS_MIN, Math.min(n, C.SHARDS_MAX, Math.floor(t.area / (C.MIN_AREA * 1.2))));
}

// Small tiles split evenly: seeds sit around the tile's centre, rotated so a
// break line runs from the centre out past the impact point.
function cleanSplitSeeds(t, n, lx, ly) {
  const offset = Math.atan2(ly, lx) - Math.PI / n + (Math.random() - 0.5) * 0.5;
  const d = t.radius * 0.5;
  const seeds = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * G.TAU;
    seeds.push({ x: Math.cos(a) * d, y: Math.sin(a) * d });
  }
  return seeds;
}

// Bigger tiles shatter: seeds cluster around the impact, so small shards
// there and big chunks far away.
function shatterSeeds(t, n, lx, ly) {
  const seeds = [{ x: lx, y: ly }];
  for (let i = 1; i < n; i++) {
    const a = Math.random() * G.TAU;
    // Keep the nearest seeds a little away so the piece under your feet isn't a crumb.
    const d = 30 + t.radius * 1.1 * Math.pow(Math.random(), 1.5);
    seeds.push({ x: lx + Math.cos(a) * d, y: ly + Math.sin(a) * d });
  }
  return seeds;
}

// Small tiles hold longer than big ones.
export function crackDuration(t) {
  return C.CRACK_BASE + C.CRACK_SMALL / Math.sqrt(t.area);
}

// `slow` stretches the timer (used for the piece left under the player).
export function startCrack(t, lx, ly, slow = 1) {
  if (t.crack || t.rubble || t.solid) return;
  t.dormant = false;
  const n = pieceCount(t);
  const seeds = n <= C.CLEAN_SPLIT_MAX ? cleanSplitSeeds(t, n, lx, ly) : shatterSeeds(t, n, lx, ly);
  let reach = 0;
  for (const p of t.poly) reach = Math.max(reach, Math.hypot(p.x - lx, p.y - ly));
  t.crack = {
    ix: lx, iy: ly,
    cells: G.voronoiCells(t.poly, seeds),
    t: 0,
    duration: crackDuration(t) * slow,
    reach,
  };
}

// The piece left under the player keeps breaking, a bit slower than a fresh tile.
export function startAftershock(t, lx, ly) {
  startCrack(t, lx, ly, C.AFTERSHOCK);
}

// Breaks a cracked tile into fragment tiles. Each fragment keeps `srcCell`
// (its shape in the parent's local frame) so the player can be moved across.
export function shatter(t) {
  const frags = [];
  for (const cell of t.crack.cells) {
    const c = G.polygonCentroid(cell);
    const poly = cell.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    const w = toWorld(t, c.x, c.y);
    const f = tileFromPoly(w.x, w.y, poly, t.angle);
    if (f.area < 1) continue;
    const dx = c.x - t.crack.ix, dy = c.y - t.crack.iy;
    const len = Math.hypot(dx, dy) || 1;
    const kick = G.rotate(dx / len, dy / len, t.angle);
    const strength = C.SHATTER_KICK * (0.6 + Math.random() * 0.8);
    f.kx = t.kx + kick.x * strength;
    f.ky = t.ky + kick.y * strength;
    f.spin = t.spin + (Math.random() - 0.5) * 0.8;
    f.srcCell = cell;
    f.srcCenter = c;
    frags.push(f);
  }
  return frags;
}

// ---- Population ----

export function densityAt(r) {
  return C.DENSITY_AT_REF * Math.pow(Math.max(r, 150) / C.R_REF, -C.DENSITY_FALLOFF);
}

export function expectedCount(r0, r1) {
  const steps = 10, dr = (r1 - r0) / steps;
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const r = r0 + (i + 0.5) * dr;
    n += densityAt(r) * G.TAU * r * dr;
  }
  return n;
}

function randomSize(r) {
  const outward = G.clamp(r / C.RIM, 0, 1);
  const max = G.lerp(C.TILE_MAX_SIZE_CORE, C.TILE_MAX_SIZE, outward);
  return C.TILE_MIN_SIZE * Math.pow(max / C.TILE_MIN_SIZE, Math.random());
}

// Tries a few random angles at radius r; places a tile where it doesn't overlap.
export function tryPlace(tiles, r, size = randomSize(r)) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const th = Math.random() * G.TAU;
    const x = Math.cos(th) * r, y = Math.sin(th) * r;
    let clear = true;
    for (const t of tiles) {
      const min = (size + t.radius) * 0.9;
      if ((t.x - x) ** 2 + (t.y - y) ** 2 < min * min) { clear = false; break; }
    }
    if (clear) {
      const t = createTile(x, y, size);
      tiles.push(t);
      return t;
    }
  }
  return null;
}

export function populate(tiles) {
  for (let r = C.CORE_R * 2; r < C.RIM + 250; r += 100) {
    const n = Math.floor(expectedCount(r, r + 100) + Math.random());
    for (let i = 0; i < n; i++) tryPlace(tiles, r + Math.random() * 100);
  }
}

// Tiles drift inward, so fresh ones are fed in just past the rim.
const FEED_BAND = [C.RIM - 300, C.RIM + 250];
const FEED_TARGET = expectedCount(FEED_BAND[0], FEED_BAND[1]);

export function feedRim(tiles) {
  let n = 0;
  for (const t of tiles) {
    if (t.rubble) continue;
    const r = Math.hypot(t.x, t.y);
    if (r >= FEED_BAND[0] && r <= FEED_BAND[1]) n++;
  }
  if (n < FEED_TARGET) tryPlace(tiles, C.RIM + 100 + Math.random() * 150);
}
