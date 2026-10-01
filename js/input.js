// On-screen joystick, double-tap-and-drag jump, optional jump slider, keyboard.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';

export const input = {
  sliderEnabled: false,    // optional two-handed jump slider (a setting)
  rumbleEnabled: true,     // controller rumble and phone vibration (a setting)
  joy: null,               // { id, ox, oy, x, y, t0 } while a finger is on the joystick
  aim: null,               // double-tap-and-drag jump being aimed: { id, ox, oy, x, y }
  // Jump slider while held: { id, startY, x, restY, s }. s is 0 at rest (short hop),
  // 1 at the top (longest jump) and negative when pulled down towards cancel.
  slider: null,
  keys: new Set(),
  usingPad: false,         // last input came from a game controller (hides touch hints)
  pushVisible: false,      // the push button is on screen (push battle)
};

let layout = null;

// Where the controls sit on screen. Recomputed on resize.
export function updateLayout(view) {
  const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  const R = G.clamp(Math.min(view.w, view.h) * 0.13, 48, 72);
  const pad = 24;
  const bottom = view.h - pad - sab;
  const sliderW = R * 0.75, upLen = R * 1.8, cancelLen = R * 0.75;
  layout = {
    joyR: R,
    // Where the joystick rests when untouched (you can grab it anywhere): bottom
    // centre for one-handed play, or the middle of the left half when the jump
    // slider takes the right half.
    joyHome: { x: view.w / 2, y: bottom - R * 1.4 },
    joyHomeLeft: { x: Math.max(pad + R, view.w / 4), y: bottom - R * 1.4 },
    // Push button (push battle): bottom right, or bottom left when the slider has the right half.
    pushRight: { x: view.w - pad - R * 0.8, y: bottom - R * 0.8, r: R * 0.8 },
    pushLeft: { x: pad + R * 0.8, y: bottom - R * 0.8, r: R * 0.8 },
    slider: {
      w: sliderW,
      upLen,                              // rest → top
      cancelLen,                          // rest → bottom
      cancelS: (cancelLen * 0.5) / upLen, // pull down past half the red zone to cancel
      home: { x: view.w - pad - sliderW / 2 - 6, restY: bottom - cancelLen },
      minRestY: 200 + upLen,              // keep the top clear of the minimap
      minX: view.w / 2 + sliderW,
      maxX: view.w - pad - sliderW / 2,
      maxRestY: bottom - cancelLen,
    },
  };
  return layout;
}

export function getLayout() {
  return layout;
}

export function pushButton() {
  return input.sliderEnabled ? layout.pushLeft : layout.pushRight;
}

// Movement direction in screen space with magnitude 0..1, or null when idle.
export function moveVector() {
  let x = 0, y = 0;
  if (input.joy) {
    x = (input.joy.x - input.joy.ox) / layout.joyR;
    y = (input.joy.y - input.joy.oy) / layout.joyR;
  } else {
    const k = input.keys;
    if (k.has('ArrowLeft') || k.has('a')) x -= 1;
    if (k.has('ArrowRight') || k.has('d')) x += 1;
    if (k.has('ArrowUp') || k.has('w')) y -= 1;
    if (k.has('ArrowDown') || k.has('s')) y += 1;
  }
  const mag = Math.hypot(x, y);
  if (mag < C.JOY_DEADZONE) return null;
  const m = Math.min(1, mag);
  return { x: x / mag, y: y / mag, mag: input.joy ? m : 1 };
}

export function sliderCancelled(sl) {
  return sl.s < -layout.slider.cancelS;
}

function releaseSlider(handlers) {
  const sl = input.slider;
  input.slider = null;
  if (sl && !sliderCancelled(sl)) handlers.jump(G.clamp(sl.s, 0, 1));
}

export function keyboardFill(dt) {
  const sl = input.slider;
  if (sl && sl.id === 'key') sl.s = Math.min(1, sl.s + dt / C.CHARGE_TIME);
}

let lastTap = null; // { t, x, y } of the last quick tap, for spotting a double tap

// Snaps a 0..1 aim amount to short / medium / long (equal thirds). Returns the
// band (0, 1, 2) and the matching jump power for jump().
export function snapJump(amount) {
  const level = Math.min(2, Math.floor(G.clamp(amount, 0, 1) * 3));
  const d = C.JUMP_SNAPS[level];
  return { level, power: (d - C.JUMP_MIN) / (C.JUMP_RANGE - C.JUMP_MIN) };
}

let lastLevel = -1;

// The jump being aimed, in screen space: direction, snapped power and band, or
// null when the thumb is inside the dead zone (letting go there cancels).
export function aimVector() {
  const a = input.aim;
  if (!a) return null;
  const dx = a.x - a.ox, dy = a.y - a.oy, d = Math.hypot(dx, dy);
  if (d < C.AIM_DEADZONE) return null;
  const snap = snapJump((d - C.AIM_DEADZONE) / (C.AIM_DRAG - C.AIM_DEADZONE));
  return { x: dx / d, y: dy / d, power: snap.power, level: snap.level };
}

// A tiny buzz when the drag crosses into a new band (Android; iPhone ignores it).
function tickOnBandChange() {
  const v = aimVector();
  const level = v ? v.level : -1;
  if (level !== lastLevel && level >= 0 && input.rumbleEnabled) {
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
  }
  lastLevel = level;
}

// handlers: { active(), jump(power 0..1, screenDir?), push(), restart(), pause() }
export function initInput(canvas, handlers) {
  canvas.addEventListener('pointerdown', (e) => {
    input.usingPad = false;
    if (!handlers.active()) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    const pb = pushButton();
    if (input.pushVisible && Math.hypot(x - pb.x, y - pb.y) < pb.r * 1.25) {
      handlers.push(); // a tap on the push button, not the start of a walk
      return;
    }
    if (input.sliderEnabled && x > window.innerWidth / 2) {
      // The slider appears under your thumb anywhere on the right half.
      if (input.slider) return;
      const L = layout.slider;
      input.slider = {
        id: e.pointerId,
        startY: y,
        x: G.clamp(x, L.minX, L.maxX),
        restY: G.clamp(y, L.minRestY, L.maxRestY),
        s: 0,
      };
    } else {
      if (input.joy || input.aim) return;
      const now = performance.now() / 1000;
      if (lastTap && now - lastTap.t < C.DOUBLE_TAP_TIME && Math.hypot(x - lastTap.x, y - lastTap.y) < C.DOUBLE_TAP_DIST) {
        // Second tap of a double tap, held: aim a jump instead of walking.
        input.aim = { id: e.pointerId, ox: x, oy: y, x, y };
        lastTap = null;
      } else {
        input.joy = { id: e.pointerId, ox: x, oy: y, x, y, t0: now };
      }
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });

  canvas.addEventListener('pointermove', (e) => {
    const a = input.aim;
    if (a && e.pointerId === a.id) {
      a.x = e.clientX;
      a.y = e.clientY;
      tickOnBandChange();
      return;
    }
    const sl = input.slider;
    if (sl && e.pointerId === sl.id) {
      const L = layout.slider;
      sl.s = G.clamp((sl.startY - e.clientY) / L.upLen, -L.cancelLen / L.upLen, 1);
      return;
    }
    const j = input.joy;
    if (!j || e.pointerId !== j.id) return;
    j.x = e.clientX;
    j.y = e.clientY;
    // Drag the base along if the finger wanders past the rim.
    const dx = j.x - j.ox, dy = j.y - j.oy, d = Math.hypot(dx, dy);
    if (d > layout.joyR) {
      j.ox = j.x - (dx / d) * layout.joyR;
      j.oy = j.y - (dy / d) * layout.joyR;
    }
  });

  const end = (release) => (e) => {
    const j = input.joy;
    if (j && e.pointerId === j.id) {
      // A quick touch that barely moved is a tap (the first half of a double tap).
      const now = performance.now() / 1000;
      const moved = Math.hypot(e.clientX - j.ox, e.clientY - j.oy);
      lastTap = release && now - j.t0 < C.TAP_MAX_TIME && moved < C.TAP_MAX_MOVE ? { t: now, x: j.ox, y: j.oy } : null;
      input.joy = null;
    }
    const a = input.aim;
    if (a && e.pointerId === a.id) {
      const v = release ? aimVector() : null;
      input.aim = null;
      if (v) handlers.jump(v.power, v);
    }
    if (input.slider && e.pointerId === input.slider.id) {
      release ? releaseSlider(handlers) : (input.slider = null);
    }
  };
  canvas.addEventListener('pointerup', end(true));
  canvas.addEventListener('pointercancel', end(false));

  const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener('keydown', (e) => {
    const k = keyName(e);
    if (k === 'r') return handlers.restart();
    if (k === 'p') return handlers.pause();
    if (k === 'f') return handlers.active() && handlers.push();
    if (k === ' ') {
      // Holding Space fills the slider up over CHARGE_TIME (see keyboardFill).
      e.preventDefault();
      if (!e.repeat && handlers.active() && !input.slider) {
        const h = layout.slider.home;
        input.slider = { id: 'key', startY: 0, x: h.x, restY: h.restY, s: 0 };
      }
      return;
    }
    if (k === 'Escape') {
      input.slider = null;
      return;
    }
    input.keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    const k = keyName(e);
    if (k === ' ') {
      if (input.slider && input.slider.id === 'key' && handlers.active()) releaseSlider(handlers);
      return;
    }
    input.keys.delete(k);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.joy = null;
    input.aim = null;
    input.slider = null;
  });
}
