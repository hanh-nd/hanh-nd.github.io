// The frame loop: fixed-step physics, contacts and rule events, camera, rendering.
import * as THREE from 'three';
import { clamp, rand } from './util.js';
import { GAME, MIRROR, PHYS, PLAYER_CFG } from './config.js';
import { HALF_L, HALF_W, NET_TOP, TABLE_TOP, stepBall } from './physics.js';
import { CAM_FOLLOW, camLook, camera, cameraPoseFor, renderer, scene } from './render/scene.js';
import { updateCrowd } from './render/venues.js';
import { ai2Racket, aiRacket, allyRacket, player } from './render/racket.js';
import { ball, ballPrev, marker, renderBall, serveZone, setBall } from './render/ball.js';
import { input, swing, updateMouseTarget, updatePlayer } from './input.js';
import { DEBUG, TLOG } from './log.js';
import { checkSmashUpgrade, playerHit, racketContact } from './strokes.js';
import { ai, ai2, aiHit, ally, nearAI, serverBot, turnBot, turnRacket, updateAI } from './ai.js';
import { aiServeCharge, beginToss, stepToss } from './serve.js';
import { botReach, jutsuAtBounce, jutsuAtNet, mirrorReflect, resumeTime, stepDecoys, stepSnake, updateGhosts, yourReach } from './jutsu.js';
import { canHit, endPoint, holdBallForServe, liveJutsu, match, onFloor, onTableBounce, other, rally, serveFault, timeScale } from './rules.js';
import { $, msgTimer, setMsgTimer, showMessage, updateLiveHUD } from './ui/hud.js';
import { Sound } from './audio.js';

/* =====================================================================
   MAIN LOOP — fixed-timestep physics, interpolated rendering
   ===================================================================== */
export let simTime = 0, accumulator = 0, lastFrame = performance.now();
export const stepEvents = { net: false, table: null, floor: null, side: false };

/** Ball physics + collisions + rule events + racket contacts for one fixed step. */
function stepLiveBall(dt) {
  Object.assign(ballPrev, ball.p);
  if (rally.stop) { if (simTime < rally.stop.until) return; resumeTime(); }   // Time Stop: the ball hangs
  const ev = stepEvents;
  ev.net = false; ev.table = null; ev.floor = null; ev.side = false;
  stepBall(ball, dt, ev);
  if (rally.snake) stepSnake();
  const jtNet = liveJutsu();   // the jutsu crosses the net: it vanishes, or time stops
  if (jtNet && !jtNet.netDone && rally.serveStage === 0 && (ballPrev.z > 0) !== (ball.p.z > 0) && ball.p.y > NET_TOP) {
    jtNet.netDone = true; jutsuAtNet(jtNet, other(jtNet.by));
  }

  if (ev.net) { Sound.bounce('net', 1); if (rally.live) rally.netTouched = true; }
  if (ev.side) Sound.bounce('net', 1);
  if (ev.table) {
    if (ev.table.speed > 0.4) Sound.bounce('table', ev.table.speed);
    if (ev.table.side === 'player') marker.visible = false;
    if (rally.live) {
      rally.shotBounces++;
      if (ev.table.edge) showMessage('Edge ball!', '', 'warn', 0.9);
      onTableBounce(ev.table.side, ev.table.x);
      const jt = liveJutsu();
      if (jt && rally.live && rally.serveStage === 0 && ev.table.side !== jt.by && !jt.bounced) { jt.bounced = true; jutsuAtBounce(jt, ev.table.side); }
    }
  }
  if (ev.floor) {
    if (ev.floor.speed > 0.5) Sound.bounce('floor', ev.floor.speed);
    if (rally.live) onFloor();
  }
  if (!rally.live) return;
  stepDecoys(dt);
  checkSmashUpgrade();
  if (checkVolley()) return;

  // Over the table the blade can't dip low (racketMinY): like yours, the CPU's contact is lenient
  // vertically there, so it can reach in for a short ball.
  const botYWeight = Math.abs(ball.p.z) < HALF_L ? PLAYER_CFG.yWeight : 1;
  // A primed Yata Mirror catches the ball itself as it rises off the bounce — no racket needed.
  for (const side of ['player', 'ai']) {
    if (rally.mirror[side] === 'primed' && canHit(side) && (ball.v.y < 0 || ball.p.y - TABLE_TOP > MIRROR.catchH || Math.abs(ball.p.z) > HALF_L)) { TLOG.contact(side); TLOG.note({ stroke: 'mirror', kind: 'mirror' }); return mirrorReflect(side, turnBot(side)); }
  }
  const near = turnBot('player');   // 2v2: only the partner whose turn it is can meet the ball
  if (near) {
    if (canHit('player') && racketContact(near.racket, botReach('player'), botYWeight, false) >= 0) { TLOG.contact('player'); return aiHit(near); }
  } else if (canHit('player') || (DEBUG.on && rally.lastHitter === 'ai')) {   // debug also logs pre-bounce crossings
    const d = racketContact(player, yourReach(), PLAYER_CFG.yWeight);
    if (d >= 0 && canHit('player')) { TLOG.contact('player'); return playerHit(d); }
  }
  if (canHit('ai')) {
    const far = turnBot('ai');
    if (racketContact(far.racket, botReach('ai'), botYWeight) >= 0) { TLOG.contact('ai'); return aiHit(far); }
  }
  if (simTime - rally.lastHitTime > GAME.rallyTimeout) onFloor();   // safety net
}

/** Volley: touching the ball before it has bounced on your side. Over the table it's an
 *  obstruction (point to the opponent); past the end or side lines it was going out anyway, so
 *  the shot that sent it there loses. Only the real blade counts, not the generous hit zone. */
function checkVolley() {
  for (const who of ['player', 'ai']) {
    const r = turnRacket(who);   // 2v2: the partner whose turn it isn't is out of the way
    if (rally.lastHitter !== other(who) || !(rally.serveStage > 0 || rally.bounceCount === 0)) continue;
    if ((who === 'player') !== (ball.p.z > 0)) continue;
    if (racketContact(r, PLAYER_CFG.bladeRadius, 1, false) < 0) continue;
    ball.v.z *= -0.6; ball.v.x *= 0.6;   // dead block off the racket
    Sound.hit(0.3);
    if (Math.abs(ball.p.x) <= HALF_W && Math.abs(ball.p.z) <= HALF_L) {
      endPoint(other(who), 'Volley', 'error');
    } else {
      const wide = Math.abs(ball.p.x) > HALF_W;
      if (rally.serveStage > 0) serveFault('Serve out');
      else endPoint(who, wide ? 'Wide' : 'Long', 'error');
    }
    return true;
  }
  return false;
}

/** Attract mode behind the start menu: the ball bounces on the table. */
function menuStep(dt) {
  Object.assign(ballPrev, ball.p);
  const ev = stepEvents;
  ev.net = false; ev.table = null; ev.floor = null;
  stepBall(ball, dt, ev);
  if (ev.floor || ball.p.y < 0.1) setBall({ x: rand(-0.5, 0.5), y: 1.3, z: rand(-1, 1) }, { x: 0, y: 0, z: rand(-1, 1) });
  const t = simTime;
  player.pos.set(Math.sin(t * 0.8) * 0.4, 0.95 + Math.sin(t * 1.7) * 0.05, 1.7);
  aiRacket.pos.set(Math.sin(t * 0.9 + 1) * 0.4, 0.95 + Math.sin(t * 1.5) * 0.05, -1.7);
}

export function fixedUpdate(dt) {
  simTime += dt;
  if (match.state === 'menu') return menuStep(dt);
  if (match.watch) updateAI(nearAI, dt); else updatePlayer(dt);
  updateAI(ai, dt);
  if (match.doubles) { updateAI(ally, dt); updateAI(ai2, dt); }
  if (match.state === 'serve') {
    holdBallForServe();
    const bot = serverBot();
    if (bot && simTime >= bot.serveAt) beginToss(match.server, aiServeCharge(bot));
  } else if (match.state === 'toss') {
    stepToss(dt);
  } else {
    stepLiveBall(dt);
  }
  if (match.after) {
    match.timer -= dt;
    if (match.timer <= 0) { const fn = match.after; match.after = null; fn(); }
  }
}

const _camTarget = new THREE.Vector3(), _lookTarget = new THREE.Vector3();
export let cameraShake = 0;
/** Real seconds the world holds still after a stroke in a heated rally (HEAT). The headless sim
 *  steps fixedUpdate itself, so it never waits on it. */
export let hitStop = 0;
function updateCamera(dt) {
  if (match.state === 'menu') {   // slow orbit behind the menu
    const t = performance.now() / 1000 * 0.12;
    camera.position.set(Math.sin(t) * 4.2, 2.3, Math.cos(t) * 4.2);
    camLook.set(0, TABLE_TOP + 0.55, 0);   // a little above the table: the stands fill the frame
    camera.lookAt(camLook);
    return;
  }
  const k = 1 - Math.exp(-CAM_FOLLOW.rate * dt);
  if (match.watch) cameraPoseFor(player.pos.x * 0.3, CAM_FOLLOW.refZ + 0.3, _camTarget, _lookTarget);   // steadier, a bit further back
  else cameraPoseFor(player.pos.x, player.pos.z, _camTarget, _lookTarget);
  camera.position.lerp(_camTarget, k);
  camLook.lerp(_lookTarget, k);
  camera.lookAt(camLook);
  if (cameraShake > 0.0005) {
    camera.position.x += rand(-1, 1) * cameraShake;
    camera.position.y += rand(-1, 1) * cameraShake;
    cameraShake *= Math.exp(-10 * dt);
  }
}

export function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const running = !match.paused && match.state !== 'matchOver';
  if (running) {
    updateMouseTarget();
    if (hitStop > 0) {   // hit-stop (HEAT): the world holds still; the camera, shake and sparks go on
      hitStop -= dt;
      accumulator = 0;
    } else {
      accumulator += dt * timeScale();
      let steps = 0;
      while (accumulator >= PHYS.dt && steps < PHYS.maxSubSteps && hitStop <= 0) {
        fixedUpdate(PHYS.dt);
        accumulator -= PHYS.dt;
        steps++;
      }
      if (steps === PHYS.maxSubSteps || hitStop > 0) accumulator = 0;   // avoid a spiral of death after a stall; a hit-stop starts clean
    }
  }

  const alpha = running ? accumulator / PHYS.dt : 1;
  renderBall(alpha, running ? dt : 0);
  // The face visibly closes with a forward swipe and opens on a pull-back (plus manual tilt).
  const swipeTilt = simTime - swing.strokeAt <= PLAYER_CFG.strokeWindow ? clamp(swing.sf, -2, 3) * 0.3 : 0;
  player.updateMesh(dt, match.state === 'menu' ? 0 : match.watch ? player.tilt : clamp(input.tilt + swipeTilt, -1, 1));
  aiRacket.updateMesh(dt, aiRacket.tilt);
  if (match.doubles && match.state !== 'menu') { allyRacket.updateMesh(dt, allyRacket.tilt); ai2Racket.updateMesh(dt, ai2Racket.tilt); updateGhosts(); }
  serveZone.visible = match.doubles && (match.state === 'serve' || match.state === 'toss' || (rally.live && rally.serveStage > 0));
  if (serveZone.visible) serveZone.material.opacity = 0.1 + 0.06 * Math.sin(now / 150);
  updateCamera(dt);
  if (marker.visible) marker.material.opacity = 0.5 + 0.25 * Math.sin(now / 120);
  if (match.state !== 'menu') updateLiveHUD();
  updateCrowd(dt, now / 1000);
  if (msgTimer > 0) { setMsgTimer(msgTimer - (dt)); if (msgTimer <= 0) $('msg').classList.remove('show'); }

  renderer.render(scene, camera);
}

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setCameraShake(v) { return (cameraShake = v); }
export function setHitStop(v) { return (hitStop = Math.max(hitStop, v)); }
