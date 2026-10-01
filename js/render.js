// Everything that draws: the vortex, tiles, player, minimap and HUD.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import { speedFactor } from './world.js';
import { input, getLayout, sliderCancelled, aimVector, pushButton } from './input.js';
import { calmAt } from './pickups.js';

export function formatTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Colour scale: speed factor 0.8 (big, slow) is blue, SPEED_FACTOR_MAX (tiny, fast) is orange.
const MIN_SF = Math.log(0.8), MAX_SF = Math.log(C.SPEED_FACTOR_MAX);

function viewScale(state) {
  return (Math.min(state.view.w, state.view.h) / C.VIEW_SIZE) * state.cam.zoom;
}

function viewOrigin(state) {
  return { x: state.view.w / 2, y: state.view.h * C.PLAYER_SCREEN_Y };
}

// Slow, big tiles are cool blue; fast, small ones glow orange.
function tileHue(t) {
  const k = G.clamp((Math.log(speedFactor(t.area)) - MIN_SF) / (MAX_SF - MIN_SF), 0, 1);
  return 205 - k * 190;
}

function tracePoly(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function drawSpiralArms(ctx, state, px) {
  const arms = 5, b = 0.24;
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = 'rgba(120,110,255,0.10)';
  for (let k = 0; k < arms; k++) {
    const off = (k / arms) * G.TAU + state.time * 0.03;
    ctx.beginPath();
    for (let th = 0; th < 22; th += 0.08) {
      const r = 60 * Math.exp(b * th);
      if (r > C.RIM + 400) break;
      const a = off - th; // arms trail behind the counter-clockwise flow
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      th === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Depth bands: the closer to the core, the more dangerous (and later, the more valuable).
function drawRings(ctx, state, px) {
  ctx.lineWidth = 3 * px;
  ctx.setLineDash([30 * px, 18 * px]);
  C.RINGS.forEach((r, i) => {
    ctx.strokeStyle = `rgba(90,255,170,${0.15 + 0.1 * (C.RINGS.length - i) / C.RINGS.length})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, G.TAU);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.lineWidth = 4 * px;
  ctx.strokeStyle = 'rgba(255,215,100,0.25)';
  ctx.beginPath();
  ctx.arc(0, 0, C.RIM, 0, G.TAU);
  ctx.stroke();
}

function drawTile(ctx, t, px) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle);
  const crack = t.crack;
  const k = crack ? Math.min(1, crack.t / crack.duration) : 0;
  if (k > 0.6) {
    // Tremble just before breaking.
    const j = (k - 0.6) * 6 * px;
    ctx.translate((Math.random() - 0.5) * j, (Math.random() - 0.5) * j);
  }
  const hue = tileHue(t);
  tracePoly(ctx, t.poly);
  if (t.rubble) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = `hsl(${hue},25%,30%)`;
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.fillStyle = `hsl(${hue},55%,${30 + k * 12}%)`;
  ctx.fill();
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = `hsl(${hue},80%,${60 + k * 20}%)`;
  ctx.stroke();

  if (t.solid) {
    // Too small to break: a gem-like inner facet marks it as safe to stand on.
    ctx.beginPath();
    t.poly.forEach((p, i) => {
      const x = p.x * 0.5, y = p.y * 0.5;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }

  if (crack) {
    // The drawn cracks are the real Voronoi cell edges, growing from the impact.
    ctx.save();
    tracePoly(ctx, t.poly);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(crack.ix, crack.iy, crack.reach * (1 - (1 - k) ** 2), 0, G.TAU);
    ctx.clip();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + k * 0.5})`;
    for (const cell of crack.cells) {
      tracePoly(ctx, cell);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

// Glowing orbs: cyan near the rim, magenta deep in the vortex. Bigger when worth more.
function drawPickups(ctx, state, px) {
  const now = performance.now() / 1000;
  for (const k of state.pickups) {
    const deep = calmAt(k.x, k.y) / C.CALM_MAX;
    const hue = 190 + deep * 120;
    const r = 10 + deep * 8;
    const pulse = 1 + 0.15 * Math.sin(now * 5 + k.lx);
    const g = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, r * 3 * pulse);
    g.addColorStop(0, `hsla(${hue},100%,75%,0.9)`);
    g.addColorStop(1, `hsla(${hue},100%,60%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(k.x, k.y, r * 3 * pulse, 0, G.TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(k.x, k.y, r * 0.55, 0, G.TAU);
    ctx.fill();
  }
  for (const q of state.pulses) {
    ctx.lineWidth = (6 - q.t * 5) * px;
    ctx.strokeStyle = `rgba(160,220,255,${0.7 * (1 - q.t)})`;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 20 + q.t * 260, 0, G.TAU);
    ctx.stroke();
  }
}

function worldToScreen(state, x, y) {
  const s = viewScale(state), o = viewOrigin(state), cam = state.cam;
  const p = G.rotate(x - cam.x, y - cam.y, cam.angle);
  return { x: o.x + p.x * s, y: o.y + p.y * s };
}

// Each bot's name and lives, floating upright above it.
function drawBotLabels(ctx, state) {
  if (state.gameMode !== 'battle') return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of state.actors) {
    if (!a.bot || a.out || a.mode === 'falling') continue;
    const p = worldToScreen(state, a.x, a.y);
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = actorColour(a, 75);
    ctx.fillText(a.name, p.x, p.y - 30);
    lifePips(ctx, p.x, p.y - 18, a, 3.5);
  }
}

// Filled dots for lives left, hollow for lives lost.
function lifePips(ctx, cx, cy, a, r) {
  const gap = r * 3;
  for (let i = 0; i < C.BATTLE_LIVES; i++) {
    const x = cx + (i - (C.BATTLE_LIVES - 1) / 2) * gap;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, G.TAU);
    if (i < a.lives) { ctx.fillStyle = actorColour(a, 70); ctx.fill(); }
    else { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke(); }
  }
}

function drawPopups(ctx, state) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 20px system-ui, sans-serif';
  for (const q of state.popups) {
    const p = worldToScreen(state, q.x, q.y);
    ctx.globalAlpha = Math.min(1, (1.4 - q.t) * 2);
    ctx.fillStyle = `hsl(${q.hue},100%,80%)`;
    ctx.fillText(q.text, p.x, p.y - 20 - q.t * 40);
  }
  ctx.globalAlpha = 1;
}

// Arrows at the screen edge pointing to the nearest off-screen pickups.
function drawPickupArrows(ctx, state) {
  if (state.mode !== 'play') return;
  const { w, h } = state.view;
  const o = viewOrigin(state), p = state.player;
  const left = 22, right = w - 22, top = 120, bottom = h - 22;
  const near = [...state.pickups]
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
    .slice(0, 5);
  const marks = near.map((k) => {
    const deep = calmAt(k.x, k.y) / C.CALM_MAX;
    return { x: k.x, y: k.y, size: 7 + deep * 6, colour: `hsla(${190 + deep * 120},100%,72%,0.9)` };
  });
  // In a battle, opponents get arrows too (bigger, in their colour).
  for (const a of state.actors) {
    if (a.bot && !a.out && a.mode !== 'falling') marks.push({ x: a.x, y: a.y, size: 11, colour: actorColour(a) });
  }
  for (const k of marks) {
    const sp = worldToScreen(state, k.x, k.y);
    if (sp.x > left && sp.x < right && sp.y > top && sp.y < bottom) continue; // on screen
    const dx = sp.x - o.x, dy = sp.y - o.y;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (right - o.x) / dx);
    if (dx < 0) t = Math.min(t, (left - o.x) / dx);
    if (dy > 0) t = Math.min(t, (bottom - o.y) / dy);
    if (dy < 0) t = Math.min(t, (top - o.y) / dy);
    const x = o.x + dx * t, y = o.y + dy * t;
    const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const size = k.size;
    ctx.fillStyle = k.colour;
    ctx.beginPath();
    ctx.moveTo(x + ux * size, y + uy * size);
    ctx.lineTo(x - ux * size * 0.6 - uy * size * 0.7, y - uy * size * 0.6 + ux * size * 0.7);
    ctx.lineTo(x - ux * size * 0.6 + uy * size * 0.7, y - uy * size * 0.6 - ux * size * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCore(ctx) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, C.CORE_R * 3);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.33, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(160,80,255,0.55)');
  g.addColorStop(1, 'rgba(60,20,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, C.CORE_R * 3, 0, G.TAU);
  ctx.fill();
}

// Colour for an actor: you are white, bots get their own hue.
function actorColour(a, light = 62) {
  return a.bot ? `hsl(${a.hue},85%,${light}%)` : '#fff';
}

// The 30° push cone in front of `a`, as a wedge path.
function conePath(ctx, a, f) {
  const half = (C.PUSH_CONE / 2) * (Math.PI / 180), ang = Math.atan2(f.y, f.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.arc(a.x, a.y, C.PUSH_RANGE, ang - half, ang + half);
  ctx.closePath();
}

function drawGusts(ctx, state) {
  for (const g of state.gusts) {
    conePath(ctx, g, g.f);
    ctx.fillStyle = `rgba(200,240,255,${0.35 * (1 - g.t / 0.4)})`;
    ctx.fill();
  }
}

function drawActor(ctx, state, px, p) {
  if (p.out) return;
  const you = p === state.player;
  let r = C.PLAYER_R, alpha = 1, lift = 0;
  if (p.mode === 'air') lift = Math.sin(Math.PI * Math.min(1, p.jump.t / p.jump.dur));
  if (p.mode === 'falling') {
    const k = p.fallT / C.FALL_TIME;
    r *= 1 - k;
    alpha = 1 - k;
  }
  if (r <= 0) return;

  // Push wind-up: the cone brightens until it fires.
  if (p.push) {
    conePath(ctx, p, p.face);
    const k = Math.min(1, p.push.t / C.PUSH_WINDUP);
    ctx.fillStyle = `rgba(200,240,255,${0.08 + 0.12 * k})`;
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = `rgba(200,240,255,${0.3 + 0.5 * k})`;
    ctx.stroke();
  }

  if (you && state.aim) {
    // Aiming a jump (double-tap-and-drag or slider): faint max-range ring, dashed line and a marker where you'll land.
    const a = state.aim;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, C.JUMP_RANGE, 0, G.TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([6 * px, 6 * px]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Green when there's a tile under the marker right now (you still have to lead moving tiles).
    ctx.globalAlpha = a.armed ? 1 : 0.45;
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = state.aimOnTile ? '#5affaa' : '#fff';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 9 * px, 0, G.TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (p.mode === 'air') {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (1 - lift * 0.3), 0, G.TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(p.jump.tx, p.jump.ty, 6 * px, 0, G.TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  const s = 1 + lift * 0.7;
  ctx.fillStyle = p.bot ? `hsla(${p.hue},85%,62%,0.25)` : 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * s * 1.8, 0, G.TAU);
  ctx.fill();
  ctx.fillStyle = actorColour(p);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * s, 0, G.TAU);
  ctx.fill();

  // Push immunity after respawning: a pulsing ring.
  if (p.protect > 0) {
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = `rgba(120,220,255,${0.4 + 0.4 * Math.sin(performance.now() / 90)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * s + 10 * px, 0, G.TAU);
    ctx.stroke();
  }

  // Small gold chevron pointing outward, towards the rim (the view no longer keeps outward up).
  if (you && p.mode !== 'falling') {
    const rr = Math.hypot(p.x, p.y) || 1, ox = p.x / rr, oy = p.y / rr;
    const d = r * s + 26 * px, g = 5 * px;
    const cx = p.x + ox * d, cy = p.y + oy * d;
    ctx.fillStyle = 'rgba(255,215,100,0.85)';
    ctx.beginPath();
    ctx.moveTo(cx + ox * g * 1.4, cy + oy * g * 1.4);
    ctx.lineTo(cx - ox * g - oy * g, cy - oy * g + ox * g);
    ctx.lineTo(cx - ox * g * 0.3, cy - oy * g * 0.3);
    ctx.lineTo(cx - ox * g + oy * g, cy - oy * g - ox * g);
    ctx.closePath();
    ctx.fill();
  }

  // Facing arrow
  const f = p.face, tip = r * s + 9 * px, base = r * s + 3 * px, wing = 5 * px;
  ctx.fillStyle = p.bot ? actorColour(p, 80) : '#5affaa';
  ctx.beginPath();
  ctx.moveTo(p.x + f.x * tip, p.y + f.y * tip);
  ctx.lineTo(p.x + f.x * base - f.y * wing, p.y + f.y * base + f.x * wing);
  ctx.lineTo(p.x + f.x * base + f.y * wing, p.y + f.y * base - f.x * wing);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawMinimap(ctx, state) {
  const { w, h } = state.view;
  const R = Math.min(80, Math.min(w, h) * 0.15);
  const cx = w - R - 14, cy = R + 14;
  const s = R / (C.RIM + 250);

  ctx.save();
  ctx.fillStyle = 'rgba(8,10,24,0.8)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, G.TAU);
  ctx.fill();
  ctx.stroke();
  ctx.clip();

  C.RINGS.forEach((r) => {
    ctx.strokeStyle = 'rgba(90,255,170,0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * s, 0, G.TAU);
    ctx.stroke();
  });
  ctx.strokeStyle = 'rgba(255,215,100,0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, C.RIM * s, 0, G.TAU);
  ctx.stroke();

  for (const t of state.tiles) {
    if (t.rubble) continue;
    const d = Math.max(1, t.radius * s * 1.2);
    ctx.fillStyle = `hsla(${tileHue(t)},60%,60%,0.35)`;
    ctx.fillRect(cx + t.x * s - d / 2, cy + t.y * s - d / 2, d, d);
  }

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, C.CORE_R * s * 1.5, 0, G.TAU);
  ctx.fill();

  if (state.trail.length > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    let pen = false;
    for (const q of state.trail) {
      if (!q) { pen = false; continue; }
      const x = cx + q.x * s, y = cy + q.y * s;
      pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }
  for (const k of state.pickups) {
    ctx.fillStyle = `hsl(${190 + (calmAt(k.x, k.y) / C.CALM_MAX) * 120},100%,70%)`;
    ctx.fillRect(cx + k.x * s - 1.5, cy + k.y * s - 1.5, 3, 3);
  }
  for (const a of state.actors) {
    if (!a.bot || a.out) continue;
    ctx.fillStyle = actorColour(a);
    ctx.beginPath();
    ctx.arc(cx + a.x * s, cy + a.y * s, 2.5, 0, G.TAU);
    ctx.fill();
  }
  const p = state.player;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + p.x * s, cy + p.y * s, 3, 0, G.TAU);
  ctx.fill();
  ctx.restore();
}

function drawHud(ctx, state) {
  if (state.mode === 'title') return;
  if (state.gameMode === 'battle') drawBattleHud(ctx, state);
  else drawSoloHud(ctx, state);

  if (state.message) {
    const m = state.message;
    const alpha = Math.min(1, m.t * 4, (2.5 - m.t) * 2);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(m.text, state.view.w / 2, state.view.h * 0.18);
    ctx.globalAlpha = 1;
  }
}

// Battle: one row per player with lives and push charges.
function drawBattleHud(ctx, state) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(formatTime(state.time), 14, 12);
  state.actors.forEach((a, i) => {
    const y = 44 + i * 20;
    ctx.globalAlpha = a.out ? 0.4 : 1;
    ctx.fillStyle = actorColour(a, 70);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.out ? `${a.name} (out)` : a.name, 14, y + 6);
    lifePips(ctx, 96, y + 6, a, 4);
    // Push charges: small cyan wedges.
    ctx.fillStyle = 'rgba(160,230,255,0.9)';
    for (let c = 0; c < a.charges; c++) {
      const x = 124 + c * 12;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + 8, y + 6);
      ctx.lineTo(x, y + 11);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
  ctx.textBaseline = 'top';
}

// Solo: time survived, personal best and the vortex meter.
function drawSoloHud(ctx, state) {
  // Time survived (the score) and personal best
  ctx.fillStyle = '#fff';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(formatTime(state.time), 14, 12);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(220,230,255,0.7)';
  ctx.fillText(state.bestTime > 0 ? `Best ${formatTime(state.bestTime)}` : 'No best yet', 14, 46);

  // Vortex strength meter: blue when calm, red when raging. Full = the run ends.
  // A tick at every whole ×, so you can see how many falls you can afford.
  const bw = Math.min(180, state.view.w * 0.4), bx = 14, by = 72;
  const span = C.STRENGTH_MAX - C.STRENGTH_START;
  const k = G.clamp((state.strength - C.STRENGTH_START) / span, 0, 1);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(220,230,255,0.7)';
  ctx.fillText(`VORTEX ×${Math.min(state.strength, C.STRENGTH_MAX).toFixed(2)} / ${C.STRENGTH_MAX}`, bx, by);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by + 16, bw, 8);
  ctx.fillStyle = `hsl(${200 - k * 200},85%,60%)`;
  ctx.fillRect(bx, by + 16, bw * Math.max(0.02, k), 8);
  ctx.fillStyle = 'rgba(5,6,13,0.9)';
  for (let x = 1; x < span; x++) ctx.fillRect(bx + (bw * x) / span - 1, by + 16, 2, 8);
}

// Joystick: sits at its home spot until a thumb lands.
function drawJoystick(ctx, L) {
  const j = input.joy;
  const home = input.sliderEnabled ? L.joyHomeLeft : L.joyHome;
  const base = j ? { x: j.ox, y: j.oy } : home;
  const knob = j ? { x: j.x, y: j.y } : home;
  ctx.fillStyle = j ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(base.x, base.y, L.joyR, 0, G.TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = j ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.arc(knob.x, knob.y, L.joyR * 0.42, 0, G.TAU);
  ctx.fill();
}

function drawControls(ctx, state) {
  const L = getLayout();
  if (!L || state.mode !== 'play') return;

  // Touch hints hide while you're playing with a controller.
  if (!input.aim && !(input.usingPad && !input.joy)) drawJoystick(ctx, L); // hidden while aiming a jump
  if (input.sliderEnabled && !(input.usingPad && !input.slider)) drawSlider(ctx, L.slider);
  drawAimControl(ctx);
  if (input.pushVisible && !input.usingPad) drawPushButton(ctx, state);
}

// Push battle: the push button shows your charges; dim when empty or cooling down.
function drawPushButton(ctx, state) {
  const b = pushButton(), p = state.player;
  const ready = p.charges > 0 && p.cooldown <= 0 && !p.push && p.mode === 'tile';
  ctx.globalAlpha = ready ? 1 : 0.4;
  ctx.fillStyle = 'rgba(160,230,255,0.22)';
  ctx.strokeStyle = 'rgba(160,230,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, G.TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e6f8ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.fillText('PUSH', b.x, b.y - 6);
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`${p.charges}/${C.PUSH_MAX_CHARGES}`, b.x, b.y + 10);
  ctx.globalAlpha = 1;
}

// Double-tap-and-drag jump: a ring around where the second tap landed, a red
// cancel circle in the middle, and a knob under your thumb.
function drawAimControl(ctx) {
  const a = input.aim;
  if (!a) return;
  const v = aimVector();
  const dx = a.x - a.ox, dy = a.y - a.oy, d = Math.hypot(dx, dy);
  const k = Math.min(1, d / C.AIM_DRAG);
  const kx = a.ox + (d ? (dx / d) * k * C.AIM_DRAG : 0), ky = a.oy + (d ? (dy / d) * k * C.AIM_DRAG : 0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.arc(a.ox, a.oy, C.AIM_DRAG, 0, G.TAU);
  ctx.fill();
  ctx.stroke();
  // Band edges: short | medium | long
  const band = (C.AIM_DRAG - C.AIM_DEADZONE) / 3;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  for (const r of [C.AIM_DEADZONE + band, C.AIM_DEADZONE + band * 2]) {
    ctx.beginPath();
    ctx.arc(a.ox, a.oy, r, 0, G.TAU);
    ctx.stroke();
  }
  ctx.fillStyle = v ? 'rgba(255,90,90,0.18)' : 'rgba(255,90,90,0.5)';
  ctx.beginPath();
  ctx.arc(a.ox, a.oy, C.AIM_DEADZONE, 0, G.TAU);
  ctx.fill();
  const colour = !v ? '#ff6b6b' : v.level === 2 ? '#fff' : '#5affaa';
  if (v) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.ox, a.oy);
    ctx.lineTo(kx, ky);
    ctx.stroke();
  }
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(kx, ky, 18, 0, G.TAU);
  ctx.fill();
  ctx.fillStyle = '#05201a';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(v ? 'SML'[v.level] : '✕', kx, ky);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Stubby vertical jump slider: up = further, the red bottom section cancels.
function drawSlider(ctx, L) {
  const sl = input.slider;
  const x = sl ? sl.x : L.home.x;
  const rest = sl ? sl.restY : L.home.restY;
  const s = sl ? sl.s : 0;
  const top = rest - L.upLen, bottom = rest + L.cancelLen;
  const w = L.w, half = w / 2;
  const cancelled = sl && sliderCancelled(sl);
  const cancelY = rest + L.cancelS * L.upLen;

  // Track
  roundedRect(ctx, x - half, top - half, w, bottom - top + w, half);
  ctx.fillStyle = sl ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cancel zone
  ctx.save();
  roundedRect(ctx, x - half, top - half, w, bottom - top + w, half);
  ctx.clip();
  ctx.fillStyle = cancelled ? 'rgba(255,90,90,0.55)' : 'rgba(255,90,90,0.18)';
  ctx.fillRect(x - half, cancelY, w, bottom + half - cancelY);
  // Distance fill from rest up to the thumb
  if (s > 0) {
    ctx.fillStyle = s >= 1 ? 'rgba(255,255,255,0.5)' : 'rgba(90,255,170,0.45)';
    ctx.fillRect(x - half, rest - s * L.upLen, w, s * L.upLen);
  }
  ctx.restore();

  const cx = (bottom + half + cancelY) / 2, k = half * 0.35;
  ctx.strokeStyle = cancelled ? '#fff' : 'rgba(255,140,140,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - k, cx - k); ctx.lineTo(x + k, cx + k);
  ctx.moveTo(x + k, cx - k); ctx.lineTo(x - k, cx + k);
  ctx.stroke();

  // Rest mark
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(x - half + 4, rest);
  ctx.lineTo(x + half - 4, rest);
  ctx.stroke();

  // Thumb
  const ty = rest - G.clamp(s, -L.cancelLen / L.upLen, 1) * L.upLen;
  ctx.fillStyle = cancelled ? '#ff6b6b' : s >= 1 ? '#ffffff' : sl ? '#5affaa' : 'rgba(90,255,170,0.55)';
  ctx.beginPath();
  ctx.arc(x, ty, half * 1.25, 0, G.TAU);
  ctx.fill();
  ctx.fillStyle = '#05201a';
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cancelled ? '✕' : 'JUMP', x, ty);
}

export function render(canvas, state) {
  const ctx = canvas.getContext('2d');
  const { w, h, dpr } = state.view;
  const s = viewScale(state), px = 1 / s; // px = one screen pixel in world units
  const o = viewOrigin(state), cam = state.cam;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05060d';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  const shake = cam.shake;
  ctx.translate(o.x + (Math.random() - 0.5) * shake, o.y + (Math.random() - 0.5) * shake);
  ctx.scale(s, s);
  ctx.rotate(cam.angle);
  ctx.translate(-cam.x, -cam.y);

  drawSpiralArms(ctx, state, px);
  drawRings(ctx, state, px);

  const viewR = Math.hypot(w, h) / s;
  const visible = state.tiles.filter(
    (t) => Math.hypot(t.x - cam.x, t.y - cam.y) < viewR + t.radius
  );
  visible.sort((a, b) => b.area - a.area); // small tiles on top
  for (const t of visible) drawTile(ctx, t, px);

  for (const q of state.particles) {
    ctx.fillStyle = `${q.color}${(q.life / q.max).toFixed(2)})`;
    ctx.fillRect(q.x - 2 * px, q.y - 2 * px, 4 * px, 4 * px);
  }
  drawPickups(ctx, state, px);
  drawGusts(ctx, state);
  drawCore(ctx);
  for (const a of state.actors) if (a !== state.player) drawActor(ctx, state, px, a);
  drawActor(ctx, state, px, state.player);
  ctx.restore();

  drawBotLabels(ctx, state);
  drawPopups(ctx, state);
  drawPickupArrows(ctx, state);
  drawMinimap(ctx, state);
  drawHud(ctx, state);
  drawControls(ctx, state);
  if (state.paused && state.mode === 'play') drawPaused(ctx, state);
}

function drawPaused(ctx, state) {
  const { w, h } = state.view;
  ctx.fillStyle = 'rgba(5,6,13,0.65)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText('Paused', w / 2, h * 0.42);
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(220,230,255,0.8)';
  ctx.fillText(input.usingPad ? 'Start to resume · Y to restart' : 'Tap to resume', w / 2, h * 0.42 + 40);
}
