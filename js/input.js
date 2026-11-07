// Mouse and touch: the racket target, swipe tracking and stroke intent.
import * as THREE from 'three';
import { clamp } from './util.js';
import { DOUBLE_TAP, MOUSE_MAP, PHYS, PLAYER_CFG, REACH, SMASH, SPIN, TOUCH_GAIN, VOID } from './config.js';
import { HALF_L, TABLE_TOP, moveBody, racketMinY } from './physics.js';
import { _vcLook, _vcPos, cameraPoseFor, canvas, viewCam } from './render/scene.js';
import { player, playerBody } from './render/racket.js';
import { ball } from './render/ball.js';
import { TLOG } from './log.js';
import { DOUBLES, youServe, yourTurn } from './ai.js';
import { beginToss } from './serve.js';
import { armJutsu } from './jutsu.js';
import { canHit, isPlaying, match, rally, timeScale } from './rules.js';
import { $ } from './ui/hud.js';
import { back, hideOverlay, openOverlay, screen, togglePause } from './ui/menus.js';
import { Sound } from './audio.js';
import { simTime } from './loop.js';

/* =====================================================================
   INPUT — mouse/touch (pointer events)
   ===================================================================== */
export const input = {
  mouseActive: false,
  ndc: new THREE.Vector2(0, -0.4),
  target: { x: 0, z: 1.8 },    // where the player wants the racket (XZ)
  wheelTilt: 0, tilt: 0,
  touch: false,                // the last pointer was a finger (smash flicks need more: touchSmash)
  charging: false, chargeStart: 0,
};

// Touch drags the racket relative to where the finger lands (like a trackpad), so the racket never
// jumps under the finger and a quick swipe becomes a swing. Mouse maps the cursor directly.
export let touchLast = null;
// Touch sensitivity (Settings): multiplies TOUCH_GAIN. The slider (0–100, middle = 1×) maps to
// 0.5×–2× on a log scale, so each side of the middle feels the same size.
export const touchSens = {
  value: 50,
  get mult() { return Math.pow(2, (this.value - 50) / 50); },
};
// Only the first finger drives the racket; a second finger's tap arms a jutsu, and so does a
// double-tap (a short, still tap, then a touch close by — armed as the second one lands, so it
// works mid-point). The tap that serves never starts a double-tap.
let touchId = null;
let tapDown = null, lastTap = null;
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    input.touch = true;
    if (!touchLast || e.pointerId !== touchId) return;
    input.target.x += (e.clientX - touchLast.x) / window.innerWidth * 2 * MOUSE_MAP.xRange * TOUCH_GAIN * touchSens.mult;
    input.target.z += (e.clientY - touchLast.y) / window.innerHeight / 0.6 * (MOUSE_MAP.zNear - PLAYER_CFG.minZ) * TOUCH_GAIN * touchSens.mult;
    touchLast = { x: e.clientX, y: e.clientY };
    return;
  }
  input.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  input.mouseActive = true;
});
canvas.addEventListener('pointerdown', e => {
  Sound.init();
  input.touch = e.pointerType === 'touch';
  if (e.pointerType === 'touch') {
    if (touchLast && e.pointerId !== touchId) return armJutsu();   // second finger
    touchLast = { x: e.clientX, y: e.clientY }; touchId = e.pointerId;
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP.gap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP.dist) {
      lastTap = null; tapDown = null; armJutsu();
      input.mouseActive = false;
      return;
    }
    tapDown = { t: now, x: e.clientX, y: e.clientY };
    input.mouseActive = false;
  } else {
    input.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    input.mouseActive = true;
    if (e.button === 2) return armJutsu();
  }
  if (e.button === 0) startCharge();
});
window.addEventListener('pointerup', e => {
  if (e.pointerType === 'touch' && touchId != null && e.pointerId !== touchId) return;
  if (e.pointerType === 'touch' && tapDown) {
    const now = performance.now();
    const tap = Math.hypot(e.clientX - tapDown.x, e.clientY - tapDown.y) < DOUBLE_TAP.move && now - tapDown.t < DOUBLE_TAP.hold;
    lastTap = tap && !input.charging ? { t: now, x: e.clientX, y: e.clientY } : null;   // (a serving tap doesn't count)
    tapDown = null;
  }
  touchLast = null; touchId = null;
  if (e.button === 0) releaseCharge();
});
window.addEventListener('pointercancel', e => { if (e.pointerId === touchId) { touchLast = null; touchId = null; } });
window.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'KeyE') && isPlaying()) { e.preventDefault(); if (!e.repeat) armJutsu(); }
  if (/^Digit[1-3]$/.test(e.code) && isPlaying() && !e.repeat) armJutsu(+e.code.slice(5));
  else if (e.code === 'Escape' && match.state === 'menu') {   // menus: close Settings / Help, else Back
    if (openOverlay()) hideOverlay();
    else if (screen !== 'menu-start' && !$(screen).classList.contains('hidden')) back();
  } else if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  input.wheelTilt = clamp(input.wheelTilt - e.deltaY * 0.0015, -1, 1);
}, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());
// iOS Safari ignores the CSS above on a long press over the canvas and still shows the selection
// magnifier. Cancelling the native touch stops it; pointer events (used for all input) still fire.
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
document.addEventListener('selectstart', e => e.preventDefault());
window.addEventListener('blur', () => { if (isPlaying() && !match.paused) togglePause(); });
// Mobile: switching apps or locking the screen pauses the game.
document.addEventListener('visibilitychange', () => { if (document.hidden && isPlaying() && !match.paused) togglePause(); });
/** Mouse: the cursor maps straight onto the racket target (see MOUSE_MAP). */
export function updateMouseTarget() {
  if (!input.mouseActive) return;
  const t = clamp((input.ndc.y - MOUSE_MAP.ndcNear) / (MOUSE_MAP.ndcFar - MOUSE_MAP.ndcNear), 0, 1);
  input.target.x = clamp(input.ndc.x * MOUSE_MAP.xGain, -1, 1) * MOUSE_MAP.xRange;
  input.target.z = MOUSE_MAP.zNear + (PLAYER_CFG.minZ - MOUSE_MAP.zNear) * t;
}

/** Serve power oscillates 0 → 1 → 0 while held, so timing the release matters. */
export function currentCharge() {
  const t = (performance.now() - input.chargeStart) / 1100;
  const c = t % 2;
  return c < 1 ? c : 2 - c;
}
export function startCharge() {
  if (match.paused || match.state !== 'serve' || !youServe() || input.charging) return;
  input.charging = true;
  input.chargeStart = performance.now();
}
export function releaseCharge() {
  if (!input.charging) return;
  input.charging = false;
  if (match.paused || match.state !== 'serve' || !youServe()) return;
  beginToss('player', currentCharge());
}

/** Player: the feet run toward the target (limited speed/acceleration, behind the end line), the
 *  racket follows the target as far as the arm reaches; height auto-tracks an incoming ball. */
export function updatePlayer(dt) {
  input.target.x = clamp(input.target.x, PLAYER_CFG.minX, PLAYER_CFG.maxX);
  input.target.z = clamp(input.target.z, PLAYER_CFG.minZ, PLAYER_CFG.maxZ);
  keepOnScreen(input.target);

  input.tilt = input.wheelTilt;

  const serving = (match.state === 'serve' || match.state === 'toss') && youServe();
  const r = player, k = 1 - Math.exp(-PLAYER_CFG.followRate * dt);
  // 2v2: you serve from your right half (diagonally, see onTableBounce).
  const tx = serving ? clamp(input.target.x, match.doubles ? DOUBLES.serveMinX : -PLAYER_CFG.serveMaxX, PLAYER_CFG.serveMaxX) : input.target.x;
  const tz = serving ? clamp(input.target.z, PLAYER_CFG.serveMinZ, PLAYER_CFG.serveMaxZ) : input.target.z;
  const body = playerBody;
  const arm = REACH.armX;
  const heavy = rally.live && rally.void && rally.void !== 'player' ? VOID.you : 1;   // inside their Infinite Void: heavy feet
  moveBody(body, tx, Math.max(tz, HALF_L + REACH.bodyBehind), PLAYER_CFG.bodySpeed * heavy, PLAYER_CFG.bodyAccel * heavy, dt);
  if (!(serving && match.state === 'toss')) {   // during the toss the racket waits under the ball
    r.pos.x += (clamp(tx, body.x - arm, body.x + arm) - r.pos.x) * k;
    r.pos.z += (clamp(tz, body.z - REACH.armZ, body.z + REACH.armZ) - r.pos.z) * k;
  }

  // Height: meet the ball after its bounce. Before the bounce, wait at the height it will have
  // then — tracking the ball itself would put the racket in its path (a volley loses the point).
  let ty = PLAYER_CFG.restY;
  if (rally.live && rally.lastHitter === 'ai' && yourTurn() && ball.v.z > 0 && ball.p.z > -0.3) {
    ty = clamp(canHit('player') ? ball.p.y : rally.expectY, TABLE_TOP + 0.06, 1.7);
  }
  const minY = racketMinY(r.pos.x, r.pos.z);
  r.pos.y += (Math.max(ty, minY) - r.pos.y) * (1 - Math.exp(-PLAYER_CFG.heightRate * dt));
  r.pos.y = Math.max(r.pos.y, minY);   // never through the table
  r.integrateVelocity(dt);
  trackSwing(r, dt);
}

/** Pull a racket target back inside the camera frame (near corners of the reachable area are
 *  outside the view, especially on wide or portrait phone screens). Checks the blade edge and
 *  the bottom of the handle. */
const _ndc = new THREE.Vector3();
function keepOnScreen(t) {
  const y = PLAYER_CFG.restY, blade = 0.11;
  const poseFor = () => {   // where the camera will settle for this target
    cameraPoseFor(t.x, t.z, _vcPos, _vcLook);
    viewCam.position.copy(_vcPos); viewCam.lookAt(_vcLook); viewCam.updateMatrixWorld(true);
  };
  poseFor();
  for (let i = 0; i < 40; i++) {         // blade below the bottom edge → step toward the table
    _ndc.set(t.x, y - blade, t.z).project(viewCam);
    if (_ndc.y >= -0.97) break;
    t.z -= 0.03;
    poseFor();
  }
  for (let i = 0; i < 60; i++) {         // blade past the left/right edge → pull toward the center
    _ndc.set(t.x + Math.sign(t.x) * blade, y, t.z).project(viewCam);
    if (Math.abs(_ndc.x) <= 0.97) break;
    t.x *= 0.97;
    poseFor();
  }
}

/** Smash intent of a racket motion (vx sideways, fwd = speed toward the net): its speed if it
 *  points mostly forward (within SMASH.maxAngle), otherwise 0 — so sideways moves never count.
 *  On a touch screen it is scaled by PLAYER_CFG.touchSmash, and back by the touch sensitivity
 *  so a smash needs the same finger flick at any setting. */
const FORWARD_RATIO = Math.tan((90 - SMASH.maxAngle) * Math.PI / 180);
export function smashIntent(vx, fwd) {
  const k = input.touch ? PLAYER_CFG.touchSmash / touchSens.mult : 1;   // a finger swipe covers more ground
  return fwd > 0 && fwd >= FORWARD_RATIO * Math.abs(vx) ? Math.hypot(vx, fwd) * k : 0;
}
/** Sidespin intent: the speed of a mostly sideways motion (within SPIN.maxAngle), else 0. Scaled
 *  for touch like smashIntent. */
const SIDE_RATIO = Math.tan(SPIN.maxAngle * Math.PI / 180);
function sideIntent(vx, fwd) {
  const k = input.touch ? SPIN.touch / touchSens.mult : 1;
  return Math.abs(fwd) <= SIDE_RATIO * Math.abs(vx) ? Math.abs(vx) * k : 0;
}

/** Swing memory (real m/s): the peak recent smash flick (peak speed, its sideways vx and forward
 *  vf), the strongest recent swipe of any direction (sl, sf: it sets the stroke), and the racket's
 *  recent path. A swipe rarely peaks at the exact instant of contact, so all are kept briefly. */
export const swing = { peak: 0, peakAt: -1, vx: 0, vf: 0, sl: 0, sf: 0, strokeMag: 0, strokeAt: -1, arm: 0, armAt: -1, path: [], tPrev: null, tvx: 0, tvz: 0,
  sidePeak: 0, sideAt: -1, sideVx: 0 };   // the peak recent sidespin flick and its sideways speed
function trackSwing(r, dt) {
  // The finger/mouse (target) velocity registers a swipe immediately; the racket's own velocity
  // lags it slightly because of smoothing. Use whichever is faster.
  const t = input.target;
  if (swing.tPrev) {
    const k = 1 - Math.exp(-25 * dt);   // mouse/touch events arrive at 60–120 Hz: average them out
    swing.tvx += ((t.x - swing.tPrev.x) / dt - swing.tvx) * k;
    swing.tvz += ((t.z - swing.tPrev.z) / dt - swing.tvz) * k;
  }
  swing.tPrev = { x: t.x, z: t.z };
  const ts = timeScale();
  const racketSwing = smashIntent(r.vel.x, -r.vel.z);
  const inputSwing = smashIntent(swing.tvx, -swing.tvz);
  const now = Math.max(racketSwing, inputSwing) * ts;
  if (now >= swing.peak || simTime - swing.peakAt > SMASH.window) {
    swing.peak = now; swing.peakAt = simTime;
    swing.vx = (inputSwing > racketSwing ? swing.tvx : r.vel.x) * ts;
    swing.vf = -(inputSwing > racketSwing ? swing.tvz : r.vel.z) * ts;
  }
  // Sidespin comes from the finger/mouse flick only: the racket itself also moves sideways when the
  // feet run to a wide ball and drag the arm along, and that is no brush.
  const nowSide = sideIntent(swing.tvx, -swing.tvz) * ts;
  if (nowSide >= swing.sidePeak || simTime - swing.sideAt > SPIN.window) {
    swing.sidePeak = nowSide; swing.sideAt = simTime; swing.sideVx = swing.tvx * ts;
  }
  const fromInput = Math.hypot(swing.tvx, swing.tvz) >= Math.hypot(r.vel.x, r.vel.z);
  const sl = (fromInput ? swing.tvx : r.vel.x) * ts, sf = -(fromInput ? swing.tvz : r.vel.z) * ts;
  const mag = Math.hypot(sl * 0.5, sf);   // forward/back counts more than sideways
  if (mag >= swing.strokeMag || simTime - swing.strokeAt > PLAYER_CFG.strokeWindow) {
    swing.sl = sl; swing.sf = sf; swing.strokeMag = mag; swing.strokeAt = simTime;
  }
  // The arm: the racket's forward speed relative to the feet (see ARM). On touch it is measured
  // per unit of sensitivity, so a stroke takes the same finger whatever the setting.
  const arm = -(r.vel.z - playerBody.vz) * ts / (input.touch ? touchSens.mult : 1);
  if (Math.abs(arm) >= Math.abs(swing.arm) || simTime - swing.armAt > PLAYER_CFG.strokeWindow) { swing.arm = arm; swing.armAt = simTime; }
  swing.path.push({ x: r.pos.x, y: r.pos.y, t: simTime });
  TLOG.step(r, ts);
  if (swing.path.length > Math.round(SMASH.sweepTime / PHYS.dt)) swing.path.shift();
}
