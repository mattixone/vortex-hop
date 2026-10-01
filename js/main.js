// Game state, player, input and the main loop.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import * as W from './world.js';
import { render, formatTime } from './render.js';
import { collide } from './physics.js';
import { updatePickups, rehome } from './pickups.js';
import { pad, pollGamepad, justPressed, rumble, BUTTON, setup, startSetup, cancelSetup, setupPrompt, padReadout, resetMapping } from './gamepad.js';
import { botControl, newBrain } from './bots.js';
import { input, initInput, moveVector, updateLayout, sliderCancelled, keyboardFill, aimVector } from './input.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const overTitle = document.getElementById('over-title');
const overText = document.getElementById('over-text');
document.getElementById('build').textContent = `build ${C.BUILD}`;


const BEST_KEY = 'vortex-hop-best';
const SETTINGS_KEY = 'vortex-hop-settings';
const OLD_SLIDER_KEY = 'vortex-hop-slider';

function loadBest() {
  try { return parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

function saveBest(t) {
  try { localStorage.setItem(BEST_KEY, String(t)); } catch { /* private mode etc. */ }
}

// ---- Settings (saved on the device) ----
// slider: optional two-handed jump slider (off by default; double-tap-and-drag always works)
// rumble: controller rumble and phone vibration (on by default)
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const oldSlider = localStorage.getItem(OLD_SLIDER_KEY) === '1'; // from before the settings screen
    input.sliderEnabled = saved.slider ?? oldSlider;
    input.rumbleEnabled = saved.rumble ?? true;
  } catch { /* storage blocked: defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ slider: input.sliderEnabled, rumble: input.rumbleEnabled }));
  } catch { /* storage blocked */ }
}

loadSettings();
const sliderToggle = document.getElementById('slider-toggle');
const rumbleToggle = document.getElementById('rumble-toggle');
sliderToggle.checked = input.sliderEnabled;
rumbleToggle.checked = input.rumbleEnabled;
sliderToggle.addEventListener('change', () => {
  input.sliderEnabled = sliderToggle.checked;
  saveSettings();
});
rumbleToggle.addEventListener('change', () => {
  input.rumbleEnabled = rumbleToggle.checked;
  saveSettings();
  if (input.rumbleEnabled) {
    rumble(0.5, 0.5, 150); // a quick test buzz if a controller is connected
    try { navigator.vibrate?.(30); } catch { /* not supported */ }
  }
});

// Bot colours (hues) for the push battle.
const BOT_HUES = [12, 280, 45];

const state = {
  mode: 'title',         // 'title' | 'play' | 'over'
  gameMode: 'solo',      // 'solo' (survival run) | 'battle' (push battle vs bots)
  botCount: 3,
  tiles: [],
  player: null,          // the human's actor (also in actors)
  actors: [],            // everyone on the vortex: the player, plus bots in a battle
  cam: { x: 0, y: 0, angle: 0, shake: 0, zoom: 1 },
  time: 0,               // seconds survived this run (the score)
  bestTime: loadBest(),
  strength: C.STRENGTH_START,
  pickups: [],
  pickupCount: C.PICKUP_COUNT,
  gusts: [],             // push blasts fading out: { x, y, f, t }
  popups: [],            // floating "+12s" texts: { x, y, text, hue, t }
  pulses: [],            // calm rings spreading from where you grabbed a pickup: { x, y, t }
  particles: [],
  trail: [],
  trailTimer: 0,
  message: null,         // { text, t }
  aim: null,             // where a jump released now would land (while the slider is held)
  walking: false,        // joystick/keys held this frame (the camera waits until you stop)
  aimOnTile: false,      // is there a tile under the landing marker right now?
  view: { w: 0, h: 0, dpr: 1 },
  paused: false,
};
window.game = state; // handy for poking at from the dev console

// ---- Setup ----

function spawnSafeTile(r, th = Math.random() * G.TAU) {
  const x = Math.cos(th) * r, y = Math.sin(th) * r;
  const tile = W.createTile(x, y, 115);
  state.tiles = state.tiles.filter(
    (t) => Math.hypot(t.x - x, t.y - y) > (t.radius + tile.radius) * 0.8
  );
  state.tiles.push(tile);
  return tile;
}

// Anyone on the vortex: the player or a bot. Bots carry a `brain`.
function makeActor(tile, opts = {}) {
  const a = {
    mode: 'tile', tile, lx: 0, ly: 0, x: tile.x, y: tile.y, jump: null, fallT: 0, fellAt: null,
    face: { x: 0, y: -1 },  // facing direction in world space
    knock: { x: 0, y: 0 },  // shove from a push, slowing to a stop
    protect: 0,             // seconds of push immunity left
    lives: C.BATTLE_LIVES, charges: 0, push: null, cooldown: 0, out: false,
    bot: !!opts.bot, name: opts.name || 'You', hue: opts.hue ?? null,
    brain: opts.bot ? newBrain() : null,
  };
  faceOutward(a);
  return a;
}

function faceOutward(a) {
  const r = Math.hypot(a.x, a.y) || 1;
  a.face = { x: a.x / r, y: a.y / r };
}

function placeOn(a, tile) {
  Object.assign(a, { mode: 'tile', tile, lx: 0, ly: 0, x: tile.x, y: tile.y, jump: null, knock: { x: 0, y: 0 }, push: null });
  faceOutward(a);
}

// Starts a run: 'solo' (survival) or 'battle' (push battle vs state.botCount bots).
function newGame(gameMode = state.gameMode) {
  state.gameMode = gameMode;
  state.tiles = [];
  W.populate(state.tiles);
  state.actors = [];
  if (gameMode === 'battle') {
    const n = 1 + state.botCount, th0 = Math.random() * G.TAU;
    for (let i = 0; i < n; i++) {
      const tile = spawnSafeTile(C.START_R, th0 + (i - (n - 1) / 2) * C.BATTLE_SPREAD);
      state.actors.push(makeActor(tile, i === 0 ? {} : { bot: true, name: `Bot ${i}`, hue: BOT_HUES.at(i - 1) }));
    }
    state.pickupCount = C.BATTLE_PICKUPS;
  } else {
    state.actors.push(makeActor(spawnSafeTile(C.START_R)));
    state.pickupCount = C.PICKUP_COUNT;
  }
  state.player = state.actors.at(0);
  state.time = 0;
  state.strength = C.STRENGTH_START;
  W.setStrength(state.strength);
  state.particles = [];
  state.trail = [];
  state.pickups = [];
  state.popups = [];
  state.pulses = [];
  state.gusts = [];
  input.slider = null;
  input.aim = null;
  const p = state.player;
  state.cam.x = p.x;
  state.cam.y = p.y;
  state.cam.angle = -Math.PI / 2 - Math.atan2(p.face.y, p.face.x);
  state.cam.zoom = zoomFor(p.tile);
  state.mode = 'play';
  state.paused = false;
  overlay.hidden = true;
  say(gameMode === 'battle' ? 'Push them off!' : 'Survive the vortex');
}

function say(text) {
  state.message = { text, t: 0 };
}

// Controller rumble, if you're playing with one and it's switched on in settings.
function buzz(strong, weak, ms) {
  if (input.usingPad && input.rumbleEnabled) rumble(strong, weak, ms);
}

function burst(x, y, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * G.TAU, s = speed * (0.3 + Math.random());
    const life = 0.4 + Math.random() * 0.5;
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
  }
}

// ---- Movement, jumping, falling (shared by the player and bots) ----

// Controls are screen-relative, so rotate them into the world.
function worldDir(v) {
  return G.rotate(v.x, v.y, -state.cam.angle);
}

function moveTo(a, tile, x, y) {
  const l = W.toLocal(tile, x, y);
  a.tile = tile;
  a.lx = l.x;
  a.ly = l.y;
  a.x = x;
  a.y = y;
}

// Walking keeps you on your tile. At its edge you step onto any tile that
// overlaps it (or is within STEP_REACH); otherwise you slide along the edge.
// `dir` is a world direction, `mag` 0..1.
function walk(a, dir, mag, dt) {
  const step = C.WALK_SPEED * mag * dt;
  for (const ang of [0, 0.6, -0.6, 1.2, -1.2]) {
    const d = G.rotate(dir.x, dir.y, ang);
    const s = step * Math.cos(ang);
    const nx = a.x + d.x * s, ny = a.y + d.y * s;
    if (W.containsPoint(a.tile, nx, ny)) {
      moveTo(a, a.tile, nx, ny);
      // Walking a little way across the piece you were left on wakes it up.
      const rest = a.tile.dormant;
      if (rest && Math.hypot(a.lx - rest.x, a.ly - rest.y) > C.WAKE_DISTANCE) W.startCrack(a.tile, a.lx, a.ly);
      return;
    }
    if (ang === 0 && stepAcross(a, nx, ny, d)) return;
  }
}

// The first non-rubble tile under (x, y), other than `except`.
function tileAt(x, y, except = null) {
  for (const t of state.tiles) if (t !== except && !t.rubble && W.containsPoint(t, x, y)) return t;
  return null;
}

function stepAcross(a, nx, ny, d) {
  const rx = nx + d.x * C.STEP_REACH, ry = ny + d.y * C.STEP_REACH;
  let next = null, x = 0, y = 0;
  for (const t of state.tiles) {
    if (t === a.tile || t.rubble) continue;
    if (W.containsPoint(t, nx, ny)) { next = t; x = nx; y = ny; break; }
    if (!next && W.containsPoint(t, rx, ry)) { next = t; x = rx; y = ry; }
  }
  if (!next) return false;
  moveTo(a, next, x, y);
  W.startCrack(next, a.lx, a.ly); // stepping on a tile cracks it, just like landing
  return true;
}

function jumpDistance(power) {
  return G.lerp(C.JUMP_MIN, C.JUMP_RANGE, power);
}

// Starts a jump in world direction `dir` (defaults to facing) with power 0..1.
function jumpActor(a, power, dir = a.face) {
  if (a.mode !== 'tile') return;
  a.face = dir;
  const d = jumpDistance(power);
  a.mode = 'air';
  a.tile = null;
  a.push = null;
  a.knock = { x: 0, y: 0 };
  a.jump = { sx: a.x, sy: a.y, tx: a.x + dir.x * d, ty: a.y + dir.y * d, t: 0, dur: C.AIR_TIME };
}

// The player's jump, from the controls. You can aim mid-air; the jump only happens
// if you release on a tile. `screenDir` (drag or right stick) overrides facing.
function jump(power, screenDir = null) {
  const p = state.player;
  jumpActor(p, power, screenDir ? worldDir(screenDir) : p.face);
}

function land(a) {
  // Smaller tiles are drawn on top, so they win when tiles overlap.
  let best = null;
  for (const t of state.tiles) {
    if (!t.rubble && W.containsPoint(t, a.x, a.y) && (!best || t.area < best.area)) best = t;
  }
  if (!best) return fall(a);
  moveTo(a, best, a.x, a.y);
  a.mode = 'tile';
  W.startCrack(best, a.lx, a.ly);
  burst(a.x, a.y, 8, 'rgba(220,230,255,', 60);
  if (a === state.player) buzz(0.1, 0.3, 60);
}

// Solo: a fall costs FALL_PENALTY vortex strength (`consumed` = the vortex reached
// STRENGTH_MAX: no penalty, the run just ends). Battle: a fall costs a life.
function fall(a, consumed = false) {
  a.mode = 'falling';
  a.tile = null;
  a.fallT = 0;
  a.fellAt = { x: a.x, y: a.y };
  a.knock = { x: 0, y: 0 };
  a.push = null;
  const you = a === state.player;
  if (you) input.slider = null;
  if (state.mode !== 'play') return;
  if (state.gameMode === 'battle') {
    a.lives--;
    if (you) {
      state.cam.shake = 10;
      buzz(1, 0.6, 350);
      say(a.lives > 0 ? `Fell! ${a.lives} ${a.lives === 1 ? 'life' : 'lives'} left` : 'Knocked out!');
    } else {
      say(a.lives > 0 ? `${a.name} fell` : `${a.name} is out!`);
    }
  } else if (consumed) {
    say('The vortex consumed you');
  } else {
    state.strength += C.FALL_PENALTY;
    W.setStrength(state.strength);
    state.cam.shake = 10;
    buzz(1, 0.6, 350);
    say(`Fell! Vortex +${C.FALL_PENALTY}×`);
  }
}

// Once the falling animation ends: respawn, or (solo) game over / (battle) out.
function afterFall(a) {
  if (state.gameMode === 'battle') {
    if (a.lives <= 0) {
      a.out = true;
      a.mode = 'out';
      checkBattleEnd();
    } else {
      respawn(a);
      a.protect = C.RESPAWN_PROTECT;
    }
  } else if (state.strength >= C.STRENGTH_MAX) {
    gameOver();
  } else {
    respawn(a);
  }
}

function respawn(a) {
  const at = a.fellAt;
  const r = G.clamp(Math.hypot(at.x, at.y), C.CORE_NO_COLLIDE + 300, C.RIM - 300);
  placeOn(a, spawnSafeTile(r, Math.atan2(at.y, at.x)));
  if (a === state.player) state.trail.push(null); // break the minimap trail instead of drawing a line across
}

// ---- Push (battle only) ----

function startPush(a) {
  if (state.gameMode !== 'battle' || state.mode !== 'play') return false;
  if (a.out || a.mode !== 'tile' || a.charges <= 0 || a.push || a.cooldown > 0) return false;
  a.charges--;
  a.push = { t: 0 };
  return true;
}

// A push winds up for PUSH_WINDUP (aim still follows facing), then shoves every
// player in the cone away, harder up close.
function updatePush(a, dt) {
  a.cooldown = Math.max(0, a.cooldown - dt);
  if (!a.push) return;
  a.push.t += dt;
  if (a.push.t < C.PUSH_WINDUP) return;
  const f = a.face, half = (C.PUSH_CONE / 2) * (Math.PI / 180);
  for (const b of state.actors) {
    if (b === a || b.out || b.mode !== 'tile' || b.protect > 0) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 1 || d > C.PUSH_RANGE) continue;
    if (Math.acos(G.clamp((dx * f.x + dy * f.y) / d, -1, 1)) > half) continue;
    const s = C.PUSH_SPEED * G.lerp(1, C.PUSH_FAR, d / C.PUSH_RANGE);
    b.knock.x += (dx / d) * s;
    b.knock.y += (dy / d) * s;
    burst(b.x, b.y, 10, 'rgba(200,240,255,', 120);
    if (b === state.player) { state.cam.shake = Math.max(state.cam.shake, 8); buzz(0.8, 0.4, 200); }
  }
  state.gusts.push({ x: a.x, y: a.y, f: { ...f }, t: 0 });
  if (a === state.player) buzz(0.2, 0.5, 90);
  a.push = null;
  a.cooldown = C.PUSH_COOLDOWN;
}

// Slides a shoved player across their tile; off the edge means another tile or a fall.
function updateKnock(a, dt) {
  const k = a.knock;
  if (Math.hypot(k.x, k.y) < 4) { k.x = k.y = 0; return; }
  const nx = a.x + k.x * dt, ny = a.y + k.y * dt;
  const damp = Math.exp(-C.PUSH_DAMPING * dt);
  k.x *= damp;
  k.y *= damp;
  if (W.containsPoint(a.tile, nx, ny)) return moveTo(a, a.tile, nx, ny);
  const other = tileAt(nx, ny, a.tile);
  if (other) {
    moveTo(a, other, nx, ny);
    W.startCrack(other, a.lx, a.ly);
    return;
  }
  a.x = nx;
  a.y = ny;
  fall(a);
}

// Moves an actor for one frame: ride your tile (walking with `move`, a world
// {x, y, mag}), fly a jump, or fall.
function updateActor(a, move, dt) {
  if (a.out) return;
  a.protect = Math.max(0, a.protect - dt);
  if (a.mode === 'tile') {
    const w = W.toWorld(a.tile, a.lx, a.ly);
    a.x = w.x;
    a.y = w.y;
    if (move) walk(a, move, move.mag, dt);
    if (a.mode === 'tile') updateKnock(a, dt);
    if (a.mode === 'tile') updatePush(a, dt);
  } else if (a.mode === 'air') {
    const j = a.jump;
    j.t += dt;
    const k = Math.min(1, j.t / j.dur);
    a.x = G.lerp(j.sx, j.tx, k);
    a.y = G.lerp(j.sy, j.ty, k);
    if (k >= 1) land(a);
  } else if (a.mode === 'falling') {
    a.fallT += dt;
    W.driftPoint(a, C.MIN_AREA, dt * 3); // sucked in fast, like the tiniest shard
    if (a.fallT >= C.FALL_TIME && state.mode === 'play') afterFall(a);
  }
}

// ---- End of a run ----

function showOver(title, text) {
  state.mode = 'over';
  overTitle.textContent = title;
  overText.textContent = text;
  showCard(overCard);
  overlay.hidden = false;
}

// Solo: the run ends when the vortex reaches STRENGTH_MAX.
function gameOver() {
  const newBest = state.time > state.bestTime;
  if (newBest) {
    state.bestTime = state.time;
    saveBest(state.time);
  }
  showOver(newBest ? 'New best!' : 'The vortex consumed you',
    newBest ? `You lasted ${formatTime(state.time)}` : `You lasted ${formatTime(state.time)} · best ${formatTime(state.bestTime)}`);
}

// Battle: ends when you're out (your place = players left + 1) or you're the last one.
function checkBattleEnd() {
  const left = state.actors.filter((a) => !a.out).length;
  const p = state.player;
  const bots = `${state.botCount} bot${state.botCount === 1 ? '' : 's'}`;
  if (p.out) {
    const place = left + 1;
    showOver('Knocked out', `${place}${['st', 'nd', 'rd'].at(place - 1) || 'th'} place of ${state.actors.length} · lasted ${formatTime(state.time)} vs ${bots}`);
  } else if (left === 1) {
    showOver('You win!', `Last one standing vs ${bots} in ${formatTime(state.time)}`);
  }
}

// ---- Update ----

function updateTiles(dt) {
  const p = state.player;
  const live = state.actors.filter((a) => !a.out);
  const next = [];
  for (const t of state.tiles) {
    W.updateTile(t, dt);

    if (t.crack && t.crack.t >= t.crack.duration) {
      const frags = W.shatter(t);
      const w = W.toWorld(t, t.crack.ix, t.crack.iy);
      burst(w.x, w.y, 14, 'rgba(255,200,140,', 90);
      for (const a of live) {
        if (a.tile !== t) continue;
        const home = frags.find((f) => G.pointInPolygon(a.lx, a.ly, f.srcCell));
        if (home && !home.rubble) {
          a.tile = home;
          a.lx -= home.srcCenter.x;
          a.ly -= home.srcCenter.y;
          // The piece you're left on has no timer until you move.
          if (!home.solid) home.dormant = { x: a.lx, y: a.ly };
        } else {
          fall(a);
        }
        if (a === p) state.cam.shake = 8;
      }
      rehome(state, t, frags);
      for (const f of frags) { delete f.srcCell; next.push(f); }
      continue;
    }

    const swallowed = Math.hypot(t.x, t.y) < C.CORE_R;
    if (swallowed) {
      for (const a of live) if (a.tile === t) fall(a);
      continue;
    }
    next.push(t);
  }
  state.tiles = next;

  for (const hit of collide(state.tiles)) {
    const k = Math.min(1, hit.speed / 200);
    burst(hit.x, hit.y, 3 + Math.round(k * 8), 'rgba(200,220,255,', 40 + k * 80);
    if (hit.a === p.tile || hit.b === p.tile) {
      state.cam.shake = Math.max(state.cam.shake, 2 + k * 8);
      buzz(0.3 + k * 0.6, 0.2, 80 + k * 120);
    }
  }
  W.feedRim(state.tiles);
}

function updateScore(dt) {
  for (const got of updatePickups(state, dt, new Set(state.tiles))) {
    if (state.gameMode === 'battle') {
      const a = got.actor, full = a.charges >= C.PUSH_MAX_CHARGES;
      a.charges = Math.min(C.PUSH_MAX_CHARGES, a.charges + 1);
      state.popups.push({ x: got.x, y: got.y, text: full ? 'full' : '+1 push', hue: a.bot ? a.hue : 160, t: 0 });
      burst(got.x, got.y, 14, 'hsla(160,90%,75%,', 90);
      if (a === state.player) buzz(0, 0.5, 90);
      continue;
    }
    const before = state.strength;
    state.strength = Math.max(C.STRENGTH_START, state.strength - got.calm);
    const secs = Math.round((before - state.strength) / C.STRENGTH_RATE);
    const deep = got.calm / C.CALM_MAX;
    state.popups.push({ x: got.x, y: got.y, text: secs > 0 ? `+${secs}s` : 'calm', hue: 190 + deep * 120, t: 0 });
    state.pulses.push({ x: got.x, y: got.y, t: 0 });
    burst(got.x, got.y, 12 + Math.round(deep * 12), `hsla(${190 + deep * 120},90%,75%,`, 90);
    buzz(0, 0.5, 90);
  }
  W.setStrength(state.strength);
}

// Bots: their brains pick this frame's walk, jump or push.
function updateBots(dt) {
  for (const a of state.actors) {
    if (!a.bot) continue;
    const c = state.mode === 'play' ? botControl(a, state, dt) : { move: null, jump: null, push: false };
    if (c.jump) jumpActor(a, c.jump.power, c.jump.dir);
    if (c.push) startPush(a);
    if (c.move) a.face = { x: c.move.x, y: c.move.y };
    updateActor(a, c.move, dt);
  }
}

function updatePlayer(dt) {
  const p = state.player;
  const move = state.mode === 'play' ? moveVector() || pad.move : null;
  const aimDir = state.mode === 'play' ? aimVector() || pad.aim : null;
  // Aiming holds the camera still too, so the drag direction stays put on screen.
  state.walking = !!move || !!input.aim || !!pad.aim;
  if (aimDir) p.face = worldDir(aimDir);
  else if (move) p.face = worldDir(move); // facing is kept in world space
  const w = move ? { ...worldDir(move), mag: move.mag } : null;
  updateActor(p, w, dt);
  input.pushVisible = state.gameMode === 'battle' && state.mode === 'play' && !p.out;

  keyboardFill(dt);
  const sl = input.slider;
  if (aimDir && p.mode === 'tile') {
    const d = jumpDistance(aimDir.power);
    state.aim = { x: p.x + p.face.x * d, y: p.y + p.face.y * d, armed: true };
  } else if (sl && !sliderCancelled(sl) && p.mode === 'tile') {
    const d = jumpDistance(G.clamp(sl.s, 0, 1));
    state.aim = { x: p.x + p.face.x * d, y: p.y + p.face.y * d, armed: true };
  } else {
    state.aim = null;
  }
  state.aimOnTile = !!(state.aim && tileAt(state.aim.x, state.aim.y, p.tile));

  state.trailTimer -= dt;
  if (state.trailTimer <= 0 && p.mode !== 'falling' && !p.out) {
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
    const target = -Math.PI / 2 - Math.atan2(p.face.y, p.face.x);
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
  for (const q of state.popups) q.t += dt;
  state.popups = state.popups.filter((q) => q.t < 1.4);
  for (const q of state.pulses) q.t += dt;
  state.pulses = state.pulses.filter((q) => q.t < 1);
  for (const q of state.gusts) q.t += dt;
  state.gusts = state.gusts.filter((q) => q.t < 0.4);
  if (state.message) {
    state.message.t += dt;
    if (state.message.t > 2.5) state.message = null;
  }
}

// ---- Loop ----

let last = performance.now();
// Controller buttons: A/Start to play; A/RB/RT to jump to the right-stick marker;
// Start to pause, and from the pause screen Start resumes and Y restarts.
function handlePad() {
  pollGamepad();
  updatePadPanel();
  if (setup.active) return;
  if (pad.active) input.usingPad = true;
  if (state.mode !== 'play' || !overlay.hidden) return padMenus();
  if (justPressed(BUTTON.START)) return togglePause();
  if (state.paused) {
    if (justPressed(BUTTON.Y)) newGame();
    return;
  }
  if (pad.aim && justPressed(BUTTON.A, BUTTON.RB, BUTTON.RT)) jump(pad.aim.power, pad.aim);
  if (justPressed(BUTTON.X, BUTTON.LB)) startPush(state.player);
}

// Controller on the menus: A picks the main action of the card, B goes back.
function padMenus() {
  const back = justPressed(BUTTON.B), go = justPressed(BUTTON.A, BUTTON.START);
  if (!settingsCard.hidden) { if (back) closeSettings(); return; }
  if (!helpCard.hidden) { if (back || go) showCard(mainCard); return; }
  if (!multiCard.hidden) { if (back) showCard(mainCard); else if (go) newGame('battle'); return; }
  if (!overCard.hidden) { if (back) showCard(mainCard); else if (go) newGame(); return; }
  if (go) newGame('solo');
}

function togglePause() {
  if (state.mode !== 'play') return;
  state.paused = !state.paused;
  input.joy = input.aim = input.slider = null;
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  handlePad();
  if (state.mode === 'play' && state.paused) {
    // Frozen: just redraw.
  } else if (state.mode === 'play') {
    state.time += dt;
    state.strength += C.STRENGTH_RATE * dt;
    if (state.gameMode === 'battle') state.strength = Math.min(state.strength, C.BATTLE_STRENGTH_MAX);
    W.setStrength(state.strength);
    if (state.gameMode === 'solo' && state.strength >= C.STRENGTH_MAX && state.player.mode !== 'falling') fall(state.player, true);
    updateTiles(dt);
    updatePlayer(dt);
    updateBots(dt);
    updateScore(dt);
    updateCamera(dt);
    updateEffects(dt);
  } else {
    // Title and game-over screens: the vortex keeps swirling behind the card.
    updateTiles(dt);
    updatePlayer(dt);
    updateBots(dt);
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
  active: () => state.mode === 'play' && !state.paused,
  jump,
  push: () => startPush(state.player),
  restart: () => newGame(),
  pause: togglePause,
});
// While paused, a tap resumes.
canvas.addEventListener('pointerdown', () => {
  if (state.mode === 'play' && state.paused) togglePause();
});
// Switching apps or locking the phone pauses the run.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'play' && !state.paused) togglePause();
});
// ---- Menus: title, Multiplayer, Huh? (help), Settings, game over ----
const mainCard = document.getElementById('main-card');
const multiCard = document.getElementById('multi-card');
const helpCard = document.getElementById('help-card');
const settingsCard = document.getElementById('settings');
const overCard = document.getElementById('over-card');
const cards = [mainCard, multiCard, helpCard, settingsCard, overCard];
const padHint = document.getElementById('pad-hint');
const padStep = document.getElementById('pad-step');
const padReadoutEl = document.getElementById('pad-readout');
let settingsReturn = mainCard;

function showCard(card) {
  for (const c of cards) c.hidden = c !== card;
  overlay.scrollTop = 0;
}

function openSettings() {
  settingsReturn = overCard.hidden ? mainCard : overCard;
  showCard(settingsCard);
}

function closeSettings() {
  cancelSetup();
  showCard(settingsReturn);
}

const BOTS_KEY = 'vortex-hop-bots';
try { state.botCount = G.clamp(parseInt(localStorage.getItem(BOTS_KEY), 10) || 3, 1, 3); } catch { /* storage blocked */ }
function setBots(n) {
  state.botCount = n;
  try { localStorage.setItem(BOTS_KEY, String(n)); } catch { /* storage blocked */ }
  for (const b of document.querySelectorAll('[data-bots]')) b.classList.toggle('on', Number(b.dataset.bots) === n);
}
setBots(state.botCount);
for (const b of document.querySelectorAll('[data-bots]')) b.addEventListener('click', () => setBots(Number(b.dataset.bots)));

document.getElementById('menu-single').addEventListener('click', () => newGame('solo'));
document.getElementById('menu-multi').addEventListener('click', () => showCard(multiCard));
document.getElementById('menu-settings').addEventListener('click', openSettings);
document.getElementById('menu-help').addEventListener('click', () => showCard(helpCard));
document.getElementById('battle-start').addEventListener('click', () => newGame('battle'));
document.getElementById('multi-back').addEventListener('click', () => showCard(mainCard));
document.getElementById('help-back').addEventListener('click', () => showCard(mainCard));
document.getElementById('over-again').addEventListener('click', () => newGame());
document.getElementById('over-menu').addEventListener('click', () => showCard(mainCard));
document.getElementById('over-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('pad-setup-start').addEventListener('click', startSetup);
document.getElementById('pad-reset').addEventListener('click', () => { cancelSetup(); resetMapping(); });
window.addEventListener('gamepadconnected', () => { padHint.hidden = false; });
window.addEventListener('gamepaddisconnected', () => { padHint.hidden = !pollGamepad().connected; });

function updatePadPanel() {
  if (settingsCard.hidden) return;
  padStep.textContent = setupPrompt() ||
    (pad.connected ? 'Controller detected. If the sticks or buttons act strangely, press Start setup.' : 'No controller detected yet. Connect one and press any button on it.');
  padReadoutEl.textContent = pad.connected ? padReadout() : '';
}
window.addEventListener('resize', resize);

resize();
// Show a live vortex behind the title card.
state.tiles = [];
W.populate(state.tiles);
state.player = makeActor(spawnSafeTile(C.START_R));
state.actors = [state.player];
state.cam.x = state.player.x;
state.cam.y = state.player.y;
state.cam.angle = -Math.PI / 2 - Math.atan2(state.player.face.y, state.player.face.x);
showCard(mainCard);
requestAnimationFrame(frame);
