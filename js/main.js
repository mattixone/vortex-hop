// Game state, player, input and the main loop.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import * as W from './world.js';
import { render, formatTime } from './render.js';
import { collide } from './physics.js';
import { input, initInput, moveVector, updateLayout, sliderCancelled, keyboardFill } from './input.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const overlayHelp = document.getElementById('overlay-help');
const playButton = document.getElementById('play');
document.getElementById('build').textContent = `build ${C.BUILD}`;

const BEST_KEY = 'vortex-hop-best';

function loadBest() {
  try { return parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

function saveBest(t) {
  try { localStorage.setItem(BEST_KEY, String(t)); } catch { /* private mode etc. */ }
}

const state = {
  mode: 'title',         // 'title' | 'play' | 'over'
  tiles: [],
  player: null,
  cam: { x: 0, y: 0, angle: 0, shake: 0, zoom: 1 },
  time: 0,               // seconds survived this run (the score)
  bestTime: loadBest(),
  strength: C.STRENGTH_START,
  particles: [],
  trail: [],
  trailTimer: 0,
  message: null,         // { text, t }
  aim: null,             // where a jump released now would land (while the slider is held)
  face: { x: 0, y: -1 }, // facing direction in world space
  walking: false,        // joystick/keys held this frame (the camera waits until you stop)
  view: { w: 0, h: 0, dpr: 1 },
};
window.game = state; // handy for poking at from the dev console

// ---- Setup ----

function spawnSafeTile(r) {
  const th = Math.random() * G.TAU;
  const x = Math.cos(th) * r, y = Math.sin(th) * r;
  const tile = W.createTile(x, y, 115);
  state.tiles = state.tiles.filter(
    (t) => Math.hypot(t.x - x, t.y - y) > (t.radius + tile.radius) * 0.8
  );
  state.tiles.push(tile);
  return tile;
}

function putPlayerOn(tile) {
  state.player = { mode: 'tile', tile, lx: 0, ly: 0, x: tile.x, y: tile.y, jump: null, fallT: 0 };
  // Start facing outward.
  const r = Math.hypot(tile.x, tile.y) || 1;
  state.face = { x: tile.x / r, y: tile.y / r };
}

function newGame() {
  state.tiles = [];
  W.populate(state.tiles);
  putPlayerOn(spawnSafeTile(C.START_R));
  state.time = 0;
  state.strength = C.STRENGTH_START;
  W.setStrength(state.strength);
  state.particles = [];
  state.trail = [];
  input.slider = null;
  state.cam.x = state.player.x;
  state.cam.y = state.player.y;
  state.cam.angle = -Math.PI / 2 - Math.atan2(state.face.y, state.face.x);
  state.cam.zoom = zoomFor(state.player.tile);
  state.mode = 'play';
  overlay.hidden = true;
  say('Survive the vortex');
}

function say(text) {
  state.message = { text, t: 0 };
}

function burst(x, y, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * G.TAU, s = speed * (0.3 + Math.random());
    const life = 0.4 + Math.random() * 0.5;
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
  }
}

// ---- Player actions ----

// Controls are screen-relative (up = outward), so rotate them into the world.
function worldDir(v) {
  return G.rotate(v.x, v.y, -state.cam.angle);
}

function moveTo(tile, x, y) {
  const p = state.player, l = W.toLocal(tile, x, y);
  p.tile = tile;
  p.lx = l.x;
  p.ly = l.y;
  p.x = x;
  p.y = y;
}

// Walking keeps you on your tile. At its edge you step onto any tile that
// overlaps it (or is within STEP_REACH); otherwise you slide along the edge.
function walk(v, dt) {
  const p = state.player;
  const dir = worldDir(v);
  const step = C.WALK_SPEED * v.mag * dt;
  for (const a of [0, 0.6, -0.6, 1.2, -1.2]) {
    const d = G.rotate(dir.x, dir.y, a);
    const s = step * Math.cos(a);
    const nx = p.x + d.x * s, ny = p.y + d.y * s;
    if (W.containsPoint(p.tile, nx, ny)) {
      moveTo(p.tile, nx, ny);
      // Walking a little way across the piece you were left on wakes it up.
      const rest = p.tile.dormant;
      if (rest && Math.hypot(p.lx - rest.x, p.ly - rest.y) > C.WAKE_DISTANCE) W.startCrack(p.tile, p.lx, p.ly);
      return;
    }
    if (a === 0 && stepAcross(nx, ny, d)) return;
  }
}

function stepAcross(nx, ny, d) {
  const p = state.player;
  const rx = nx + d.x * C.STEP_REACH, ry = ny + d.y * C.STEP_REACH;
  let next = null, x = 0, y = 0;
  for (const t of state.tiles) {
    if (t === p.tile || t.rubble) continue;
    if (W.containsPoint(t, nx, ny)) { next = t; x = nx; y = ny; break; }
    if (!next && W.containsPoint(t, rx, ry)) { next = t; x = rx; y = ry; }
  }
  if (!next) return false;
  moveTo(next, x, y);
  W.startCrack(next, p.lx, p.ly); // stepping on a tile cracks it, just like landing
  return true;
}

function jumpDistance(power) {
  return G.lerp(C.JUMP_MIN, C.JUMP_RANGE, power);
}

// You can set the slider mid-air; the jump only happens if you release on a tile.
function jump(power) {
  const p = state.player;
  if (p.mode !== 'tile') return;
  const d = jumpDistance(power), f = state.face;
  p.mode = 'air';
  p.tile = null;
  p.jump = { sx: p.x, sy: p.y, tx: p.x + f.x * d, ty: p.y + f.y * d, t: 0 };
}

function land() {
  const p = state.player;
  // Smaller tiles are drawn on top, so they win when tiles overlap.
  let best = null;
  for (const t of state.tiles) {
    if (!t.rubble && W.containsPoint(t, p.x, p.y) && (!best || t.area < best.area)) best = t;
  }
  if (!best) return fall();
  const l = W.toLocal(best, p.x, p.y);
  p.mode = 'tile';
  p.tile = best;
  p.lx = l.x;
  p.ly = l.y;
  W.startCrack(best, l.x, l.y);
  burst(p.x, p.y, 8, 'rgba(220,230,255,', 60);
}

function fall() {
  const p = state.player;
  p.mode = 'falling';
  p.tile = null;
  p.fallT = 0;
  input.slider = null;
}

// A fall ends the run once the falling animation finishes.
function gameOver() {
  state.mode = 'over';
  const newBest = state.time > state.bestTime;
  if (newBest) {
    state.bestTime = state.time;
    saveBest(state.time);
  }
  overlayTitle.textContent = newBest ? 'New best!' : 'Lost to the vortex';
  overlayText.textContent = newBest
    ? `You lasted ${formatTime(state.time)}`
    : `You lasted ${formatTime(state.time)} · best ${formatTime(state.bestTime)}`;
  overlayHelp.hidden = true;
  playButton.textContent = 'Play again';
  overlay.hidden = false;
}

// ---- Update ----

function updateTiles(dt) {
  const p = state.player;
  const next = [];
  for (const t of state.tiles) {
    W.updateTile(t, dt);

    if (t.crack && t.crack.t >= t.crack.duration) {
      const frags = W.shatter(t);
      const w = W.toWorld(t, t.crack.ix, t.crack.iy);
      burst(w.x, w.y, 14, 'rgba(255,200,140,', 90);
      if (p.tile === t) {
        const home = frags.find((f) => G.pointInPolygon(p.lx, p.ly, f.srcCell));
        if (home && !home.rubble) {
          p.tile = home;
          p.lx -= home.srcCenter.x;
          p.ly -= home.srcCenter.y;
          // The piece you're left on has no timer until you move.
          if (!home.solid) home.dormant = { x: p.lx, y: p.ly };
        } else {
          fall();
        }
        state.cam.shake = 8;
      }
      for (const f of frags) { delete f.srcCell; next.push(f); }
      continue;
    }

    const swallowed = Math.hypot(t.x, t.y) < C.CORE_R;
    if (swallowed) {
      if (p.tile === t) fall();
      continue;
    }
    next.push(t);
  }
  state.tiles = next;

  for (const hit of collide(state.tiles)) {
    const k = Math.min(1, hit.speed / 200);
    burst(hit.x, hit.y, 3 + Math.round(k * 8), 'rgba(200,220,255,', 40 + k * 80);
    if (hit.a === p.tile || hit.b === p.tile) state.cam.shake = Math.max(state.cam.shake, 2 + k * 8);
  }
  W.feedRim(state.tiles);
}

function updatePlayer(dt) {
  const p = state.player;
  const move = state.mode === 'play' ? moveVector() : null;
  state.walking = !!move;
  if (move) state.face = worldDir(move); // facing is kept in world space
  if (p.mode === 'tile') {
    const w = W.toWorld(p.tile, p.lx, p.ly);
    p.x = w.x;
    p.y = w.y;
    if (move) walk(move, dt);
  } else if (p.mode === 'air') {
    const j = p.jump;
    j.t += dt;
    const k = Math.min(1, j.t / C.AIR_TIME);
    p.x = G.lerp(j.sx, j.tx, k);
    p.y = G.lerp(j.sy, j.ty, k);
    if (k >= 1) land();
  } else if (p.mode === 'falling') {
    p.fallT += dt;
    W.driftPoint(p, C.MIN_AREA, dt * 3); // sucked in fast, like the tiniest shard
    if (p.fallT >= C.FALL_TIME && state.mode === 'play') gameOver();
  }

  keyboardFill(dt);
  const sl = input.slider;
  if (sl && !sliderCancelled(sl) && p.mode === 'tile') {
    const d = jumpDistance(G.clamp(sl.s, 0, 1));
    state.aim = { x: p.x + state.face.x * d, y: p.y + state.face.y * d };
  } else {
    state.aim = null;
  }

  state.trailTimer -= dt;
  if (state.trailTimer <= 0 && p.mode !== 'falling') {
    state.trailTimer = 0.25;
    state.trail.push({ x: p.x, y: p.y });
    if (state.trail.length > 200) state.trail.shift();
  }
}

function zoomFor(tile) {
  const w = Math.sqrt(tile.area);
  const k = G.clamp(Math.log(w / C.ZOOM_SMALL_W) / Math.log(C.ZOOM_LARGE_W / C.ZOOM_SMALL_W), 0, 1);
  return G.lerp(C.ZOOM_NEAR, 1, k);
}

function updateCamera(dt) {
  const p = state.player, cam = state.cam;
  const follow = 1 - Math.exp(-8 * dt);
  cam.x += (p.x - cam.x) * follow;
  cam.y += (p.y - cam.y) * follow;
  // Once you stop walking, swing the view round so you're facing up the screen.
  // (Turning while you walk would make screen-relative controls walk in circles.)
  if (!state.walking) {
    const target = -Math.PI / 2 - Math.atan2(state.face.y, state.face.x);
    cam.angle += G.wrapAngle(target - cam.angle) * (1 - Math.exp(-C.CAMERA_TURN * dt));
  }
  // Zoom in on smaller tiles; hold the zoom while airborne or falling.
  if (p.mode === 'tile') cam.zoom += (zoomFor(p.tile) - cam.zoom) * (1 - Math.exp(-C.ZOOM_SPEED * dt));
  cam.shake *= Math.exp(-10 * dt);
}

function updateEffects(dt) {
  for (const q of state.particles) {
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.life -= dt;
  }
  state.particles = state.particles.filter((q) => q.life > 0);
  if (state.message) {
    state.message.t += dt;
    if (state.message.t > 2.5) state.message = null;
  }
}

// ---- Loop ----

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.mode === 'play') {
    state.time += dt;
    state.strength += C.STRENGTH_RATE * dt;
    W.setStrength(state.strength);
    updateTiles(dt);
    updatePlayer(dt);
    updateCamera(dt);
    updateEffects(dt);
  } else {
    // Title and game-over screens: the vortex keeps swirling behind the card.
    updateTiles(dt);
    updatePlayer(dt);
    updateCamera(dt);
    updateEffects(dt);
  }
  if (state.player) render(canvas, state);
  requestAnimationFrame(frame);
}

// ---- Input & sizing ----

function resize() {
  const dpr = window.devicePixelRatio || 1;
  state.view = { w: window.innerWidth, h: window.innerHeight, dpr };
  canvas.width = Math.round(state.view.w * dpr);
  canvas.height = Math.round(state.view.h * dpr);
  // Size the canvas to the visible window: on iOS 100vh can include the hidden toolbar area.
  canvas.style.width = `${state.view.w}px`;
  canvas.style.height = `${state.view.h}px`;
  updateLayout(state.view);
}

initInput(canvas, {
  active: () => state.mode === 'play',
  jump,
  restart: newGame,
});
window.addEventListener('resize', resize);
playButton.addEventListener('click', newGame);

resize();
// Show a live vortex behind the title card.
state.tiles = [];
W.populate(state.tiles);
putPlayerOn(spawnSafeTile(C.START_R));
state.cam.x = state.player.x;
state.cam.y = state.player.y;
state.cam.angle = -Math.PI / 2 - Math.atan2(state.face.y, state.face.x);
requestAnimationFrame(frame);
