// Everything that draws: the vortex, tiles, player, minimap and HUD.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import { speedFactor } from './world.js';
import { input, getLayout } from './input.js';

// Colour scale: speed factor 0.8 (big, slow) is blue, SPEED_FACTOR_MAX (tiny, fast) is orange.
const MIN_SF = Math.log(0.8), MAX_SF = Math.log(C.SPEED_FACTOR_MAX);

function viewScale(state) {
  return Math.min(state.view.w, state.view.h) / C.VIEW_SIZE;
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
    for (let th = 0; th < 16; th += 0.08) {
      const r = 60 * Math.exp(b * th);
      if (r > C.RIM + 400) break;
      const a = off - th; // arms trail behind the counter-clockwise flow
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      th === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawRings(ctx, state, px) {
  C.RINGS.forEach((r, i) => {
    const passed = i < state.checkpoint;
    ctx.lineWidth = (passed ? 3 : 5) * px;
    ctx.strokeStyle = passed ? 'rgba(90,255,170,0.25)' : 'rgba(90,255,170,0.6)';
    ctx.setLineDash(passed ? [] : [30 * px, 18 * px]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, G.TAU);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.lineWidth = 8 * px;
  ctx.strokeStyle = 'rgba(255,215,100,0.8)';
  ctx.beginPath();
  ctx.arc(0, 0, C.RIM, 0, G.TAU);
  ctx.stroke();

  for (const pulse of state.pulses) {
    const k = pulse.t / 1.5;
    ctx.lineWidth = (4 + 30 * k) * px;
    ctx.strokeStyle = `rgba(90,255,170,${0.7 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(0, 0, pulse.r, 0, G.TAU);
    ctx.stroke();
  }
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
    ctx.globalAlpha = Math.max(0, t.fade) * 0.6;
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

  C.RINGS.forEach((r, i) => {
    ctx.strokeStyle = i < state.checkpoint ? 'rgba(90,255,170,0.3)' : 'rgba(90,255,170,0.7)';
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
  const p = state.player;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + p.x * s, cy + p.y * s, 3, 0, G.TAU);
  ctx.fill();
  ctx.restore();
}

function drawHud(ctx, state) {
  if (state.mode === 'title') return;
  const p = state.player;
  const r = Math.hypot(p.x, p.y);
  const zone = 1 + C.RINGS.filter((ring) => r >= ring).length;
  const pct = Math.round(G.clamp(r / C.RIM, 0, 1) * 100);
  const secs = Math.floor(state.time);

  ctx.fillStyle = 'rgba(220,230,255,0.9)';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Zone ${zone}/${C.RINGS.length + 1}`, 14, 14);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(220,230,255,0.7)';
  ctx.fillText(`To the rim: ${pct}%`, 14, 36);
  ctx.fillText(`Falls: ${state.falls}   ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 14, 54);

  // Progress bar with checkpoint notches
  const bw = Math.min(220, state.view.w - 28), bx = 14, by = 76;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw, 4);
  ctx.fillStyle = 'rgba(90,255,170,0.9)';
  ctx.fillRect(bx, by, bw * G.clamp(r / C.RIM, 0, 1), 4);
  ctx.fillStyle = 'rgba(255,215,100,0.8)';
  ctx.fillRect(bx + bw * G.clamp(state.best / C.RIM, 0, 1) - 1, by - 3, 2, 10);
  for (const ring of C.RINGS) ctx.fillRect(bx + bw * (ring / C.RIM) - 0.5, by - 2, 1, 8);

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

  // Jump button with a charge ring.
  const b = L.jump, held = state.charge !== null;
  ctx.fillStyle = held ? 'rgba(90,255,170,0.35)' : 'rgba(90,255,170,0.15)';
  ctx.strokeStyle = 'rgba(90,255,170,0.6)';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, G.TAU);
  ctx.fill();
  ctx.stroke();
  if (held) {
    const k = G.clamp(state.charge / C.CHARGE_TIME, 0, 1);
    ctx.lineWidth = 6;
    ctx.strokeStyle = k >= 1 ? '#fff' : '#5affaa';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 6, -Math.PI / 2, -Math.PI / 2 + k * G.TAU);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(230,255,240,0.9)';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JUMP', b.x, b.y);
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
  drawCore(ctx);
  drawPlayer(ctx, state, px);
  ctx.restore();

  drawMinimap(ctx, state);
  drawHud(ctx, state);
  drawControls(ctx, state);
}
