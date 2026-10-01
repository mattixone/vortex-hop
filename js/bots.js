// Computer opponents for the push battle. They play by your rules: walk, jump
// with the same three snapped lengths, collect pickups for push charges, push.
// Each bot re-thinks a few times a second, in priority order:
//   escape a breaking or deep tile → push a nearby opponent → grab a pickup → hunt.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import * as W from './world.js';

const DEG = Math.PI / 180;
const powerFor = (d) => (d - C.JUMP_MIN) / (C.JUMP_RANGE - C.JUMP_MIN);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function newBrain() {
  return { next: Math.random() * C.BOT_THINK, goal: null, target: null, aimErr: 0, pushIn: null, jumpWait: 0.5 };
}

// Where a tile will be after `secs` (drift plus a share of any knock).
function predict(t, secs) {
  const q = { x: t.x, y: t.y };
  for (let i = 0; i < 4; i++) W.driftPoint(q, t.area, secs / 4);
  return { x: q.x + t.kx * secs * 0.6, y: q.y + t.ky * secs * 0.6, angle: t.angle + t.spin * secs };
}

function landsOn(t, f, x, y) {
  if (Math.hypot(x - f.x, y - f.y) > t.radius * 0.75) return false; // keep away from the rim
  const l = G.rotate(x - f.x, y - f.y, -f.angle);
  return G.pointInPolygon(l.x, l.y, t.poly);
}

// How good a tile is to stand on: big, not breaking, not too deep.
function safety(t, x, y) {
  const left = t.crack ? t.crack.duration - t.crack.t : 9;
  return Math.sqrt(t.area) * 0.6 + Math.min(Math.hypot(x, y), 2500) * 0.08 + Math.min(left, 4) * 15;
}

// Best jump by `score(tile, x, y)`, trying the three jump lengths at each nearby tile.
function findJump(bot, state, score) {
  let best = null;
  for (const t of state.tiles) {
    if (t === bot.tile || t.rubble) continue;
    if ((t.x - bot.x) ** 2 + (t.y - bot.y) ** 2 > (C.JUMP_RANGE + t.radius) ** 2) continue;
    if (t.crack && t.crack.duration - t.crack.t < C.AIR_TIME + 0.8) continue;
    const f = predict(t, C.AIR_TIME);
    const dx = f.x - bot.x, dy = f.y - bot.y, dc = Math.hypot(dx, dy) || 1;
    for (const d of C.JUMP_SNAPS) {
      const x = bot.x + (dx / dc) * d, y = bot.y + (dy / dc) * d;
      if (!landsOn(t, f, x, y)) continue;
      const s = score(t, x, y);
      if (!best || s > best.s) best = { s, x, y, dir: { x: dx / dc, y: dy / dc }, power: powerFor(d) };
    }
  }
  return best;
}

function jumpWith(bot, j, out) {
  const e = (Math.random() * 2 - 1) * C.BOT_JUMP_ERROR * DEG;
  out.jump = { dir: G.rotate(j.dir.x, j.dir.y, e), power: j.power };
  bot.brain.goal = null;
  bot.brain.jumpWait = 0.7 + Math.random() * 0.5;
}

function decide(bot, state, out) {
  const b = bot.brain, t = bot.tile;
  const left = t.crack ? t.crack.duration - t.crack.t : Infinity;
  const deep = Math.hypot(bot.x, bot.y) < C.CORE_NO_COLLIDE + 250;
  const foes = state.actors
    .filter((a) => a !== bot && !a.out && a.mode !== 'falling')
    .sort((p, q) => dist(bot, p) - dist(bot, q));
  const foe = foes[0];

  // 1. Escape a tile that's about to break or is too close to the core.
  if (left < 1.3 || deep) {
    const j = findJump(bot, state, safety);
    if (j) return jumpWith(bot, j, out);
  }

  // 2. Push an opponent in range (after a short reaction delay, with some aim error).
  if (bot.charges > 0 && !bot.push && bot.cooldown <= 0 && b.pushIn === null) {
    const f = foes.find((a) => a.mode === 'tile' && a.protect <= 0 && dist(bot, a) < C.PUSH_RANGE * 0.85);
    if (f) {
      b.target = f;
      b.aimErr = (Math.random() * 2 - 1) * C.BOT_AIM_ERROR * DEG;
      b.pushIn = C.BOT_REACTION * (0.6 + Math.random() * 0.8);
      b.goal = null;
      return;
    }
  }

  // 3. Head for the nearest pickup.
  const k = state.pickups.filter((q) => dist(bot, q) < 500).sort((p, q) => dist(bot, p) - dist(bot, q))[0];
  if (k && bot.charges < C.PUSH_MAX_CHARGES) {
    if (k.tile === t) { b.goal = { x: k.x, y: k.y }; return; }
    if (b.jumpWait <= 0) {
      const j = findJump(bot, state, (tt, x, y) => -Math.hypot(x - k.x, y - k.y) + safety(tt, x, y) * 0.2);
      if (j && Math.hypot(j.x - k.x, j.y - k.y) < dist(bot, k) - 40) return jumpWith(bot, j, out);
    }
  }

  // 4. Hunt the nearest opponent: get within push range.
  if (foe) {
    const d = dist(bot, foe);
    if (foe.tile === t || d < 200) {
      const keep = C.PUSH_RANGE * 0.6;
      b.goal = d > keep ? { x: foe.x - ((foe.x - bot.x) / d) * keep, y: foe.y - ((foe.y - bot.y) / d) * keep } : null;
      return;
    }
    if (b.jumpWait <= 0) {
      const j = findJump(bot, state, (tt, x, y) => -Math.hypot(x - foe.x, y - foe.y) + safety(tt, x, y) * 0.3);
      if (j && Math.hypot(j.x - foe.x, j.y - foe.y) < d - 60) return jumpWith(bot, j, out);
    }
    b.goal = { x: foe.x, y: foe.y }; // walk that way (slides along the edge)
    return;
  }
  b.goal = { x: t.x, y: t.y };
}

// This frame's intents for a bot: { move: {x, y, mag} | null (world), jump, push }.
export function botControl(bot, state, dt) {
  const out = { move: null, jump: null, push: false };
  if (bot.out || bot.mode !== 'tile') return out;
  const b = bot.brain;
  b.next -= dt;
  b.jumpWait -= dt;
  if (b.pushIn !== null) {
    // Turn to face the target during the reaction delay, then push.
    const f = b.target;
    if (f && !f.out) {
      const d = dist(bot, f) || 1;
      bot.face = G.rotate((f.x - bot.x) / d, (f.y - bot.y) / d, b.aimErr);
    }
    b.pushIn -= dt;
    if (b.pushIn <= 0) { b.pushIn = null; out.push = true; }
    return out;
  }
  if (b.next <= 0) {
    b.next = C.BOT_THINK * (0.7 + Math.random() * 0.6);
    decide(bot, state, out);
    if (out.jump) return out;
  }
  if (b.goal) {
    const dx = b.goal.x - bot.x, dy = b.goal.y - bot.y, d = Math.hypot(dx, dy);
    if (d < 8) b.goal = null;
    else out.move = { x: dx / d, y: dy / d, mag: d > 40 ? 0.85 : 0.5 };
  }
  return out;
}
