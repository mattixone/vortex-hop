// Game controller support via the browser's Gamepad API (standard mapping:
// Xbox, PlayStation, Switch Pro and most others). Polled once per frame.
import { CONFIG as C } from './config.js';

export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 };

export const pad = {
  connected: false,
  move: null,         // left stick: { x, y, mag } in screen space, or null
  aim: null,          // right stick: { x, y, power } in screen space, or null (centred = cancel)
  pressed: new Set(), // buttons that went down this frame
  active: false,      // any stick or button used this frame
  gp: null,
};

let prev = [];

function stick(x, y, deadzone) {
  const m = Math.hypot(x, y);
  if (m < deadzone) return null;
  return { x: x / m, y: y / m, mag: Math.min(1, (m - deadzone) / (1 - deadzone)) };
}

export function pollGamepad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = Array.from(list).find((p) => p && p.connected) || null;
  pad.pressed.clear();
  pad.gp = gp;
  pad.connected = !!gp;
  if (!gp) {
    pad.move = pad.aim = null;
    pad.active = false;
    prev = [];
    return pad;
  }
  const ax = (i) => gp.axes[i] || 0;
  pad.move = stick(ax(0), ax(1), C.PAD_DEADZONE);
  const a = stick(ax(2), ax(3), C.PAD_AIM_DEADZONE);
  pad.aim = a && { x: a.x, y: a.y, power: a.mag };
  gp.buttons.forEach((b, i) => {
    const down = b.pressed || b.value > 0.5;
    if (down && !prev[i]) pad.pressed.add(i);
    prev[i] = down;
  });
  pad.active = !!(pad.move || pad.aim || pad.pressed.size);
  return pad;
}

export function justPressed(...buttons) {
  return buttons.some((b) => pad.pressed.has(b));
}

// Rumble where supported (Chrome/Edge; patchy elsewhere). Silently does nothing otherwise.
export function rumble(strong, weak, ms) {
  try {
    pad.gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
  } catch { /* not supported */ }
}
