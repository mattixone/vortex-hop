// Everything that draws: the vortex, tiles, player, minimap and HUD.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import { speedFactor } from './world.js';
import { input, getLayout, sliderCancelled } from './input.js';
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
  for (const k of near) {
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
    const deep = calmAt(k.x, k.y) / C.CALM_MAX;
    const size = 7 + deep * 6;
    ctx.fillStyle = `hsla(${190 + deep * 120},100%,72%,0.9)`;
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

function drawPlayer(ctx, state, px) {
  const p = state.player;
  let r = C.PLAYER_R, alpha = 1, lift = 0;
  if (p.mode === 'air') lift = Math.sin(Math.PI * Math.min(1, p.jump.t / C.AIR_TIME));
  if (p.mode === 'falling') {
    const k = p.fallT / C.FALL_TIME;
    r *= 1 - k;
    alpha = 1 - k;
  }
  if (r <= 0) return;

  if (state.aim) {
    // Charging: faint max-range ring, dashed line and a marker where you'll land.
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
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 9 * px, 0, G.TAU);
    ctx.stroke();
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
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * s * 1.8, 0, G.TAU);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * s, 0, G.TAU);
  ctx.fill();

  // Small gold chevron pointing outward, towards the rim (the view no longer keeps outward up).
  if (p.mode !== 'falling') {
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
  const f = state.face, tip = r * s + 9 * px, base = r * s + 3 * px, wing = 5 * px;
  ctx.fillStyle = '#5affaa';
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
  const p = state.player;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + p.x * s, cy + p.y * s, 3, 0, G.TAU);
  ctx.fill();
  ctx.restore();
}

function drawHud(ctx, state) {
  if (state.mode === 'title') return;

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

  if (state.message) {
    const m = state.message;
    const alpha = Math.min(1, m.t * 4, (2.5 - m.t) * 2);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = 'center';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(m.text, state.view.w / 2, state.view.h * 0.18);
    ctx.globalAlpha = 1;
  }
}

function drawControls(ctx, state) {
  const L = getLayout();
  if (!L || state.mode !== 'play') return;

  // Joystick: sits at its home spot until a thumb lands on the left half.
  const j = input.joy;
  const base = j ? { x: j.ox, y: j.oy } : L.joyHome;
  const knob = j ? { x: j.x, y: j.y } : L.joyHome;
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

  drawSlider(ctx, L.slider);
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
  drawCore(ctx);
  drawPlayer(ctx, state, px);
  ctx.restore();

  drawPopups(ctx, state);
  drawPickupArrows(ctx, state);
  drawMinimap(ctx, state);
  drawHud(ctx, state);
  drawControls(ctx, state);
}
