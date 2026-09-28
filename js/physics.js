// Tile-on-tile collisions: convex polygons, separating axis test, impulses.
// The vortex moves tiles kinematically; collisions act on each tile's kick
// velocity (kx, ky) and spin, which then decay so the current takes over again.
import { CONFIG as C } from './config.js';
import { vortexVelocity } from './world.js';

const CELL = 160;

function worldPoly(t) {
  const c = Math.cos(t.angle), s = Math.sin(t.angle);
  t.wp = t.poly.map((p) => ({ x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c }));
}

function project(poly, nx, ny) {
  let min = Infinity, max = -Infinity;
  for (const p of poly) {
    const d = p.x * nx + p.y * ny;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// Separating axis test. Returns the push-out normal (pointing from a to b) and depth, or null.
function sat(a, b) {
  let depth = Infinity, nx = 0, ny = 0;
  for (const poly of [a.wp, b.wp]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      let ex = q.y - p.y, ey = p.x - q.x;
      const len = Math.hypot(ex, ey);
      if (len < 1e-9) continue;
      ex /= len;
      ey /= len;
      const [amin, amax] = project(a.wp, ex, ey);
      const [bmin, bmax] = project(b.wp, ex, ey);
      const o = Math.min(amax - bmin, bmax - amin);
      if (o <= 0) return null;
      if (o < depth) { depth = o; nx = ex; ny = ey; }
    }
  }
  if ((b.x - a.x) * nx + (b.y - a.y) * ny < 0) { nx = -nx; ny = -ny; }
  return { nx, ny, depth };
}

// Rough contact point: midway between a's deepest vertex along n and b's along -n.
function contactPoint(a, b, nx, ny) {
  let pa = a.wp[0], pb = b.wp[0], da = -Infinity, db = Infinity;
  for (const p of a.wp) { const d = p.x * nx + p.y * ny; if (d > da) { da = d; pa = p; } }
  for (const p of b.wp) { const d = p.x * nx + p.y * ny; if (d < db) { db = d; pb = p; } }
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

function velocity(t) {
  const r = Math.hypot(t.x, t.y) || 1;
  const cos = t.x / r, sin = t.y / r;
  const { w, vr } = vortexVelocity(r, t.area);
  return { x: cos * vr - sin * w * r + t.kx, y: sin * vr + cos * w * r + t.ky };
}

function resolve(a, b, hit, impacts) {
  const { nx, ny, depth } = hit;
  const ma = a.area, mb = b.area;
  const ia = ma * a.radius * a.radius * 0.4, ib = mb * b.radius * b.radius * 0.4;
  const c = contactPoint(a, b, nx, ny);
  const rax = c.x - a.x, ray = c.y - a.y, rbx = c.x - b.x, rby = c.y - b.y;
  const va = velocity(a), vb = velocity(b);
  const vax = va.x - a.spin * ray, vay = va.y + a.spin * rax;
  const vbx = vb.x - b.spin * rby, vby = vb.y + b.spin * rbx;
  const vrel = (vbx - vax) * nx + (vby - vay) * ny;

  if (vrel < 0) {
    const raxn = rax * ny - ray * nx, rbxn = rbx * ny - rby * nx;
    const denom = 1 / ma + 1 / mb + (raxn * raxn) / ia + (rbxn * rbxn) / ib;
    const j = (-(1 + C.COLLIDE_BOUNCE) * vrel) / denom;
    a.kx -= (j * nx) / ma; a.ky -= (j * ny) / ma;
    b.kx += (j * nx) / mb; b.ky += (j * ny) / mb;
    a.spin -= (raxn * j) / ia;
    b.spin += (rbxn * j) / ib;
    if (-vrel > C.IMPACT_SPEED) impacts.push({ x: c.x, y: c.y, speed: -vrel, a, b });
  }

  // Push the pair apart, lighter tile moving more.
  const corr = (Math.max(depth - C.COLLIDE_SLOP, 0) * C.COLLIDE_PUSH) / (1 / ma + 1 / mb);
  a.x -= (nx * corr) / ma; a.y -= (ny * corr) / ma;
  b.x += (nx * corr) / mb; b.y += (ny * corr) / mb;
}

// Resolves all touching pairs once. Returns hard impacts (for effects).
export function collide(tiles) {
  const impacts = [];
  const grid = new Map();
  const active = [];
  for (const t of tiles) {
    // Right at the core the pull wins: tiles overlap and fall in instead of jamming.
    if (Math.hypot(t.x, t.y) < C.CORE_NO_COLLIDE) continue;
    worldPoly(t);
    t.stamp = 0;
    t.gx0 = Math.floor((t.x - t.radius) / CELL); t.gx1 = Math.floor((t.x + t.radius) / CELL);
    t.gy0 = Math.floor((t.y - t.radius) / CELL); t.gy1 = Math.floor((t.y + t.radius) / CELL);
    for (let gx = t.gx0; gx <= t.gx1; gx++) {
      for (let gy = t.gy0; gy <= t.gy1; gy++) {
        const key = gx * 100003 + gy;
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = []));
        cell.push(t);
      }
    }
    active.push(t);
  }
  for (const a of active) {
    for (let gx = a.gx0; gx <= a.gx1; gx++) {
      for (let gy = a.gy0; gy <= a.gy1; gy++) {
        const cell = grid.get(gx * 100003 + gy);
        for (const b of cell) {
          if (b.id <= a.id || b.stamp === a.id) continue;
          b.stamp = a.id;
          const rr = a.radius + b.radius;
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > rr * rr) continue;
          const hit = sat(a, b);
          if (hit) resolve(a, b, hit, impacts);
        }
      }
    }
  }
  return impacts;
}
