// Game controller support via the browser's Gamepad API. Polled once per frame.
// Controllers that report the "standard" layout (Xbox, PlayStation, Switch Pro,
// most pads on iPhone) work out of the box. For anything else there's a guess at
// the common layouts, and a "Set up controller" flow that records a custom
// mapping per controller.
import { CONFIG as C } from './config.js';
import { snapJump } from './input.js';

export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9 };

export const pad = {
  connected: false,
  move: null,         // left stick: { x, y, mag } in screen space, or null
  aim: null,          // right stick: { x, y, power } in screen space, or null (centred = cancel)
  pressed: new Set(), // buttons that went down this frame (standard indices)
  active: false,      // any stick or button used this frame
  gp: null,
};

const STORE = 'vortex-hop-pad:';
const rest = new Map(); // controller id -> axis values when first seen (spots triggers resting at ±1)
let prev = [];
let custom = null, customFor = null;

function loadCustom(gp) {
  if (customFor !== gp.id) {
    customFor = gp.id;
    try { custom = JSON.parse(localStorage.getItem(STORE + gp.id)); } catch { custom = null; }
  }
  return custom;
}

function saveCustom(gp, map) {
  custom = map;
  customFor = gp.id;
  try { localStorage.setItem(STORE + gp.id, JSON.stringify(map)); } catch { /* storage blocked */ }
}

export function resetMapping() {
  if (!pad.gp) return;
  custom = null;
  customFor = pad.gp.id;
  try { localStorage.removeItem(STORE + pad.gp.id); } catch { /* storage blocked */ }
}

export function hasCustomMapping() {
  return !!(pad.gp && loadCustom(pad.gp));
}

// Which axes are the sticks. Custom mapping wins; otherwise the standard layout,
// or for non-standard pads the common [LX, LY, LT, RX, RY, RT] arrangement when
// axis 2 rests at ±1 like a trigger.
function layout(gp) {
  const c = loadCustom(gp);
  if (c) return c;
  const r = rest.get(gp.id) || [];
  let rx = 2, ry = 3;
  if (gp.mapping !== 'standard' && gp.axes.length >= 5 && Math.abs(r[2] || 0) > 0.5) { rx = 3; ry = 4; }
  return { lx: { i: 0, s: 1 }, ly: { i: 1, s: 1 }, rx: { i: rx, s: 1 }, ry: { i: ry, s: 1 }, auto: true };
}

function axisValue(gp, a, auto) {
  if (!a || a.i == null) return 0;
  // In auto mode, ignore an axis that was stuck away from centre when the pad
  // connected (a trigger resting at ±1 would otherwise aim or walk forever).
  if (auto && Math.abs((rest.get(gp.id) || [])[a.i] || 0) > 0.5) return 0;
  return (gp.axes[a.i] || 0) * a.s;
}

function stick(x, y, deadzone) {
  const m = Math.hypot(x, y);
  if (m < deadzone) return null;
  return { x: x / m, y: y / m, mag: Math.min(1, (m - deadzone) / (1 - deadzone)) };
}

// ---- Controller setup: record which axes and buttons are which ----

const STEPS = [
  { key: 'lx', type: 'axis', text: 'Push the LEFT stick to the RIGHT' },
  { key: 'ly', type: 'axis', text: 'Push the LEFT stick DOWN' },
  { key: 'rx', type: 'axis', text: 'Push the RIGHT stick to the RIGHT' },
  { key: 'ry', type: 'axis', text: 'Push the RIGHT stick DOWN' },
  { key: 'jump', type: 'button', text: 'Press the button you want for JUMP' },
  { key: 'pause', type: 'button', text: 'Press the button you want for PAUSE' },
];

export const setup = { active: false, step: 0, map: {}, base: null, waiting: true, done: false };

export function startSetup() {
  Object.assign(setup, { active: true, step: 0, map: {}, base: null, waiting: true, done: false });
}

export function cancelSetup() {
  setup.active = false;
}

export function setupPrompt() {
  if (setup.done) return 'Saved! Your controller is set up.';
  if (!setup.active) return '';
  return `${setup.step + 1}/${STEPS.length}: ${STEPS[setup.step].text}` + (setup.waiting ? ' (let go of everything first)' : '');
}

function stepSetup(gp) {
  const axes = Array.from(gp.axes);
  const down = gp.buttons.map((b) => b.pressed || b.value > 0.5);
  if (setup.waiting) {
    // Wait until nothing is held and the sticks are back near where they started.
    const settled = !down.some(Boolean) && (!setup.base || axes.every((v, i) => Math.abs(v - setup.base[i]) < 0.3));
    if (settled) { setup.base = axes; setup.waiting = false; }
    return;
  }
  const s = STEPS[setup.step];
  if (s.type === 'axis') {
    let best = -1, delta = 0;
    axes.forEach((v, i) => { const d = v - setup.base[i]; if (Math.abs(d) > Math.abs(delta)) { delta = d; best = i; } });
    if (best < 0 || Math.abs(delta) < 0.6) return;
    setup.map[s.key] = { i: best, s: Math.sign(delta) };
  } else {
    const i = down.findIndex(Boolean);
    if (i < 0) return;
    setup.map[s.key] = i;
  }
  setup.step++;
  setup.waiting = true;
  if (setup.step >= STEPS.length) {
    saveCustom(gp, setup.map);
    setup.active = false;
    setup.done = true;
  }
}

// Live readout of the raw controller, for the setup panel.
export function padReadout() {
  const gp = pad.gp;
  if (!gp) return 'No controller detected. Press a button on it.';
  const axes = Array.from(gp.axes).map((v, i) => `${i}:${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join('  ');
  const held = gp.buttons.map((b, i) => (b.pressed || b.value > 0.5 ? i : null)).filter((i) => i !== null).join(', ') || 'none';
  return `${gp.id}\nlayout: ${gp.mapping || 'non-standard'}${hasCustomMapping() ? ' (custom mapping saved)' : ''}\naxes: ${axes}\nbuttons held: ${held}`;
}

// ---- Per-frame poll ----

export function pollGamepad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = Array.from(list).find((p) => p && p.connected) || null;
  pad.pressed.clear();
  pad.gp = gp;
  pad.connected = !!gp;
  pad.move = pad.aim = null;
  pad.active = false;
  if (!gp) {
    prev = [];
    return pad;
  }
  if (!rest.has(gp.id)) rest.set(gp.id, Array.from(gp.axes));

  if (setup.active) {
    stepSetup(gp);
    prev = gp.buttons.map((b) => b.pressed || b.value > 0.5); // don't leak setup presses into the game
    return pad;
  }

  const L = layout(gp);
  pad.move = stick(axisValue(gp, L.lx, L.auto), axisValue(gp, L.ly, L.auto), C.PAD_DEADZONE);
  const a = stick(axisValue(gp, L.rx, L.auto), axisValue(gp, L.ry, L.auto), C.PAD_AIM_DEADZONE);
  pad.aim = a && { x: a.x, y: a.y, ...snapJump(a.mag) }; // same short/medium/long snapping as touch
  gp.buttons.forEach((b, i) => {
    const down = b.pressed || b.value > 0.5;
    if (down && !prev[i]) {
      pad.pressed.add(i);
      // Custom buttons act as the standard ones the game listens for.
      if (!L.auto && i === L.jump) pad.pressed.add(BUTTON.A);
      if (!L.auto && i === L.pause) pad.pressed.add(BUTTON.START);
    }
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
