// On-screen joystick + jump slider (touch or mouse) and keyboard controls.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';

export const input = {
  joy: null,               // { id, ox, oy, x, y } while a finger is on the joystick
  // Jump slider while held: { id, startY, x, restY, s }. s is 0 at rest (short hop),
  // 1 at the top (longest jump) and negative when pulled down towards cancel.
  slider: null,
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
  const sliderW = R * 0.75, upLen = R * 1.8, cancelLen = R * 0.75;
  layout = {
    joyR: R,
    joyHome: { x: pad + R, y: bottom - R },
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

// handlers: { active(), jump(power 0..1), restart() }
export function initInput(canvas, handlers) {
  canvas.addEventListener('pointerdown', (e) => {
    if (!handlers.active()) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    if (x > window.innerWidth / 2) {
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
      if (input.joy) return;
      input.joy = { id: e.pointerId, ox: x, oy: y, x, y };
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });

  canvas.addEventListener('pointermove', (e) => {
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
    if (input.joy && e.pointerId === input.joy.id) input.joy = null;
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
    input.slider = null;
  });
}
