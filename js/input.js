// On-screen joystick + jump button (touch or mouse) and keyboard controls.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';

export const input = {
  joy: null,               // { id, ox, oy, x, y } while a finger is on the joystick
  jumpId: null,            // pointer holding the jump button
  keys: new Set(),
  face: { x: 0, y: -1 },   // last direction moved, in screen space (up = outward)
};

let layout = null;

// Where the controls sit on screen. Recomputed on resize.
export function updateLayout(view) {
  const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  const R = G.clamp(Math.min(view.w, view.h) * 0.13, 48, 72);
  const pad = 24;
  const bottom = view.h - pad - sab;
  layout = {
    joyR: R,
    joyHome: { x: pad + R, y: bottom - R },
    jump: { x: view.w - pad - R * 0.9, y: bottom - R * 0.9, r: R * 0.9 },
  };
  return layout;
}

export function getLayout() {
  return layout;
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
  input.face = { x: x / mag, y: y / mag };
  return { x: x / mag, y: y / mag, mag: input.joy ? m : 1 };
}

// handlers: { active(), jumpStart(), jumpRelease(), jumpCancel(), restart() }
export function initInput(canvas, handlers) {
  canvas.addEventListener('pointerdown', (e) => {
    if (!handlers.active()) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    if (x > window.innerWidth / 2) {
      // The whole right half works as the jump button, so it's hard to miss.
      if (input.jumpId !== null) return;
      input.jumpId = e.pointerId;
      handlers.jumpStart();
    } else {
      if (input.joy) return;
      input.joy = { id: e.pointerId, ox: x, oy: y, x, y };
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });

  canvas.addEventListener('pointermove', (e) => {
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
    if (input.joy && e.pointerId === input.joy.id) input.joy = null;
    if (e.pointerId === input.jumpId) {
      input.jumpId = null;
      release ? handlers.jumpRelease() : handlers.jumpCancel();
    }
  };
  canvas.addEventListener('pointerup', end(true));
  canvas.addEventListener('pointercancel', end(false));

  const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener('keydown', (e) => {
    const k = keyName(e);
    if (k === 'r') return handlers.restart();
    if (k === ' ') {
      e.preventDefault();
      if (!e.repeat && handlers.active()) handlers.jumpStart();
      return;
    }
    input.keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    const k = keyName(e);
    if (k === ' ') return handlers.active() && handlers.jumpRelease();
    input.keys.delete(k);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.joy = null;
    input.jumpId = null;
    handlers.jumpCancel();
  });
}
