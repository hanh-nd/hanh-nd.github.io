// Your strokes: contact, which stroke a swipe makes (drive, block, chop, sidespin, smash) and where it goes.
import { clamp, rand } from './util.js';
import { AIM, BLOCK, CHOP, COMBO, JUTSU, PHYS, PLAYER_CFG, SIGNATURES, SMASH, SPIN } from './config.js';
import { HALF_L, HALF_W, TABLE_TOP, carriedSpin, handPlay, landingOf, reachableShort, solveShot, strokeError } from './physics.js';
import { player } from './render/racket.js';
import { ball, ballPrev, setSpinShotAt, spinShotAt } from './render/ball.js';
import { input, smashIntent, swing } from './input.js';
import { poppedUp } from './combo.js';
import { DEBUG, TLOG, lr } from './log.js';
import { aiOnOpponentHit, arcOf, turnBot } from './ai.js';
import { NO_ERROR, fireJutsu, jutsuShot, mirrorCheck, mirrorReflect, possessedStroke, startJutsu, yourJutsu, yourReach, yourSteady } from './jutsu.js';
import { canHit, incomingJutsu, match, rally, registerHit, timeScale } from './rules.js';
import { showMessage } from './ui/hud.js';
import { Sound } from './audio.js';
import { cameraShake, setCameraShake, simTime } from './loop.js';

/** The brush of a sideways flick (see SPIN): sideways push (m/s) and sidespin about +Y (rad/s). */
function brushOf(sideVx) {
  const vb = clamp(sideVx / timeScale(), -SPIN.maxBrush, SPIN.maxBrush);   // real → sim m/s
  return { push: 0.4 * SPIN.grip * vb, spin: 0.6 * SPIN.grip * vb / PHYS.radius };
}

/** The flick a smash takes off a ball met `h` m above the table (see SMASH.easeHigh). */
const smashNeed = h => SMASH.minSwing * (1 - SMASH.easeHigh * clamp((h - 0.25) / 0.3, 0, 1));
const recentArm = () => (simTime - swing.armAt <= PLAYER_CFG.strokeWindow ? swing.arm : 0);
const recentSwing = () => (simTime - swing.peakAt <= SMASH.window ? swing.peak : 0);
const recentSide = () => (simTime - swing.sideAt <= SPIN.window ? swing.sidePeak : 0);

/** Contact test: did the ball pass through the racket's face plane this step (measured relative to
 *  the moving racket, so forward swings count) within `radius` of the blade center?
 *  Returns the off-center distance at contact, or -1 for no contact. */
export function racketContact(r, radius, yWeight, sweep = true) {
  const f = r.owner === 'player' ? 1 : -1;   // the ball travels toward +Z to reach the player
  const rel0 = (ballPrev.z - r.last.z) * f, rel1 = (ball.p.z - r.pos.z) * f;
  if (!(rel0 < 0 && rel1 >= 0)) return -1;
  const t = rel0 / (rel0 - rel1);
  const lerp = (a, b) => a + (b - a) * t;
  const dx = lerp(ballPrev.x, ball.p.x) - lerp(r.last.x, r.pos.x);
  const dy = lerp(ballPrev.y, ball.p.y) - lerp(r.last.y, r.pos.y);
  let d = Math.hypot(dx, dy * yWeight);
  // A moving racket sweeps a strip: also accept the ball where the racket just was.
  // A smash flick sweeps generously; any other quick move (e.g. lunging sideways to defend)
  // gets a short window so a racket that just swept across the ball's line still meets it.
  if (sweep && d > radius && r === player) {
    const smashing = recentSwing() >= SMASH.minSwing;
    const since = simTime - (smashing ? SMASH.sweepTime : PLAYER_CFG.lungeSweep);
    const reach = radius * (smashing ? SMASH.sweepReach : 1);
    const bx = lerp(ballPrev.x, ball.p.x), by = lerp(ballPrev.y, ball.p.y);
    let best = Infinity;
    for (const q of swing.path) if (q.t >= since) best = Math.min(best, Math.hypot(bx - q.x, (by - q.y) * yWeight));
    if (best <= reach) d = Math.min(best, radius);
  }
  if (DEBUG.on && r === player) {
    DEBUG.log.push({ t: +simTime.toFixed(3), d: +d.toFixed(3), hit: d <= radius, canHit: canHit('player'), swing: +recentSwing().toFixed(2),
      peakAge: +(simTime - swing.peakAt).toFixed(3), velX: +r.vel.x.toFixed(2), velZ: +r.vel.z.toFixed(2) });
  }
  return d <= radius ? d : -1;
}

/** The swipe that makes the stroke (real m/s; sf > 0 forward, < 0 pulling back). A forward flick
 *  fast enough to smash is remembered a little longer (SMASH.window) than other swipes. */
export function strokeSwipe() {
  if (recentSwing() >= SMASH.minSwing) return { sl: swing.vx, sf: swing.vf };
  if (simTime - swing.strokeAt <= PLAYER_CFG.strokeWindow) return { sl: swing.sl, sf: swing.sf };
  return { sl: 0, sf: 0 };
}

/** Spin the opponent's stroke put on the ball that is still on it (the bounce's own spin aside). */
export const unreadSpin = () => carriedSpin(rally.shotW, simTime - rally.lastHitTime, rally.shotBounces);

/** Topspin (+) / backspin (-) part of spin w about the direction of travel v (rad/s). */
export function topspinOf(w, v) {
  const h = Math.hypot(v.x, v.z) || 1;
  return (w.x * v.z - w.z * v.x) / h;
}

/** Player stroke, aimed for the table. The swipe picks the stroke: still = block, forward =
 *  drive (faster = more pace and topspin), pull back = push (backspin), flick = smash.
 *  Contact point + sideways swing → direction. The opponent's spin shifts the return long
 *  (topspin) or short (backspin) unless the stroke suits it: push vs backspin, drive vs topspin. */
export function playerHit(contactDist) {
  const r = player;
  // Your Yata Mirror, primed: whatever the stroke, it reflects. Bound by a Shadow Possession: the
  // stroke is theirs, unless it fires a jutsu (chakra breaks the shadow).
  if (rally.mirror.player === 'primed') { TLOG.note({ stroke: 'mirror' }); return mirrorReflect('player'); }
  if (rally.bind === 'player' && !yourJutsu()) { TLOG.note({ stroke: 'possessed' }); return possessedStroke('player'); }
  const { sl, sf } = strokeSwipe();
  const contact = contactOf(contactDist);
  // Only forward-pointing flicks count; one that peaked a moment ago still does.
  const swingSpeed = Math.max(smashIntent(sl, sf), recentSwing());
  if (swingSpeed >= smashNeed(contact.h)) return playerSmash(swingSpeed, Math.abs(swing.vx) > Math.abs(sl) ? swing.vx : sl, contact);
  // A firm sideways flick: a sidespin stroke (see SPIN) — it replaces the push and the touch.
  const spin = recentSide() >= SPIN.minSwing;
  const arm = recentArm(), fwd = Math.max(0, sf);
  const push = !spin && sf <= -PLAYER_CFG.pushMin;
  const drive = fwd >= PLAYER_CFG.driveFwd;   // (arm: logged only, for now — see ARM)
  // Short touch: a slow ball met over the table with a still racket drops just over the net.
  let touch = !spin && !push && fwd < PLAYER_CFG.touchMaxFwd && ball.p.z < PLAYER_CFG.touchZ && contact.speedIn < PLAYER_CFG.touchMaxSpeed;
  // A pull-back from deep is a chop; a still racket at the table a block (see BLOCK, CHOP).
  const chop = push && ball.p.z >= CHOP.z;
  const longPush = push ? clamp((-sf - PLAYER_CFG.pushMin) * PLAYER_CFG.longPush, 0, PLAYER_CFG.longPushMax) : 0;
  // A brush with a forward swipe is a sidespin drive (SPIN.drive of a drive's pace); without, a soft block.
  const drivePower = clamp(0.38 + fwd * 0.085, 0.2, PLAYER_CFG.maxPower);
  const power = push ? PLAYER_CFG.pushPower + longPush : spin ? Math.max(SPIN.power, drivePower * SPIN.drive) : drivePower;
  const tilt = input.tilt;
  const bs = rally.botShot, sig = bs && bs.sig;
  // Armed, any stroke fires the jutsu you armed. Its chakra pushes through a signature shot.
  const jid = yourJutsu(), J = jid && JUTSU[jid];
  // A signature shot punishes the wrong stroke: it dies in the net or flies long (sigReturn).
  let sigMiss = sig && !jid ? sigReturn(bs, { push, touch, drive, fwd }) : null;
  const looped = sigMiss === 'loop';   // a hard drive got a heavy chop over — but it floats (SIGNATURES.loop)
  if (looped) sigMiss = null;
  // A jutsu coming at you may need the right answer (a Sharingan cancels it): see answerMiss.
  sigMiss = answerMiss(J, { still: !push && !spin && fwd < PLAYER_CFG.answerFwd, push }) || sigMiss;
  if (sigMiss === 'long' || (J && J.speed)) touch = false;
  if (DEBUG.on) DEBUG.log.push({ stroke: spin ? 'sidespin' : chop ? 'chop' : push ? 'push' : touch ? 'touch' : drive ? 'drive' : 'block', sf: +sf.toFixed(2), sig, sigMiss, h: +(ball.p.y - TABLE_TOP).toFixed(2), z: +ball.p.z.toFixed(2) });

  const misread = chop ? Math.max(0, contact.topIn - CHOP.max) : contact.topIn - (push || touch ? -PLAYER_CFG.spinRead : PLAYER_CFG.spinRead);
  let depthShift = clamp(misread / 150 * 0.4, -0.45, 0.45) - tilt * 0.12;
  if (sigMiss === 'long') depthShift += 0.55;
  if (sig === 'dragon-loop' && !sigMiss) depthShift = Math.min(depthShift, 0.05);   // driven through: it holds
  let tz = -(0.3 + power * 0.95 + depthShift);
  // Contact off-center angles the ball (Pong-style), plus lateral swing; the aim eases into the
  // corner (softAim) so an overshot swipe stays on the table.
  const offX = contact.offX;
  let tx = softAim(ball.p.x * 0.2 + offX * 2.4 + (spin ? 0 : sl * 0.12));   // a brush pushes for real, below
  let top = push ? -clamp(0.6 - sf * 0.2, 0.6, 1) * 130 : clamp(tilt + fwd * 0.25, -1, 1.2) * 130;
  const side = spin ? 0 : clamp(sl * 7, -50, 50);   // a brush adds its spin after the solve
  let vh = 3.2 + power * 5, arc = Infinity;
  const block = !push && !spin && !touch && !drive && ball.p.z <= HALF_L + BLOCK.table;
  if (block) {   // its pace, sent back: early (still rising) keeps more of it
    const keep = BLOCK.keep + (ball.v.y > 0 ? BLOCK.rise : 0);
    vh = clamp(Math.hypot(ball.v.x, ball.v.z) * keep, vh, BLOCK.max);
    tz = -clamp(BLOCK.base + (vh - 3.2) * BLOCK.depth + depthShift, 0.35, 1.2);
    arc = Math.max(BLOCK.arc, contact.h + 0.05);
  }
  if (spin) arc = Math.max(SPIN.arc, contact.h + 0.05);   // a brush stays low (it floated ~0.45 m: real play, ?log)
  if (chop) {    // its topspin, turned into backspin: low, deep and slow
    vh = rand(...CHOP.speed);
    tz = -(rand(...CHOP.depth) + depthShift);
    top = -clamp(CHOP.base + CHOP.reverse * Math.max(0, contact.topIn) + CHOP.pull * (-sf - PLAYER_CFG.pushMin), CHOP.base, CHOP.max);
    arc = Math.max(CHOP.arc + CHOP.float * clamp((contact.topIn - CHOP.floatFrom) / CHOP.floatSpan, 0, 1.5), contact.h + 0.05);
  }
  if (touch) {
    const t = PLAYER_CFG.touch;
    tz = -clamp(t.depth + depthShift * 0.3, 0.25, 0.6);   // the incoming spin still nudges it
    tx *= 0.8; top = t.top + tilt * 40;                     // an open face (wheel) adds backspin
    vh = Math.hypot(tx - ball.p.x, tz - ball.p.z) / t.time;
  }
  if (TLOG.on) {
    const ts = timeScale();
    TLOG.note({ stroke: spin ? 'sidespin' : chop ? 'chop' : push ? 'push' : touch ? 'touch' : drive ? 'drive' : block ? 'block' : 'soft',
      sf: lr(sf), sl: lr(sl), fwd: lr(fwd), arm: lr(arm), flick: lr(swingSpeed), sideFlick: lr(recentSide()), swipeAge: lr(simTime - swing.strokeAt),
      fingerV: [lr(swing.tvx * ts), lr(-swing.tvz * ts)], racketV: [lr(r.vel.x * ts), lr(-r.vel.z * ts)], off: lr(contact.off), offX: lr(contact.offX),
      tilt: lr(tilt), misread: Math.round(misread), depthShift: lr(depthShift), aim: [lr(tx), lr(tz)], vh: lr(vh), arcCap: arc < Infinity ? lr(arc) : null,
      sig: sig || null, sigMiss, looped: looped ? 1 : 0, jutsu: jid || null });
  }
  // Mozart Serve, Chiquita: the sidespin carries your return toward the side it curved to, unless
  // you swipe sideways against it.
  if (bs && bs.lean && (sig === 'mozart-serve' || sig === 'chiquita')) {
    tx += bs.lean * 0.4 * (1 - clamp(-sl * bs.lean / 1.2, 0, 1));
  }

  let edge = false;
  if (contactDist / yourReach() > 0.85 && !rally.warp.player) {   // frame/edge hit: unpredictable (Flying Thunder God: never)
    edge = true;
    tx += rand(-0.5, 0.5); tz -= rand(-0.15, 0.3); vh *= 0.85;
  }
  if (looped) { const L = SIGNATURES[sig].loop; vh = L.speed; top = Math.min(top, L.top); tz = -L.depth; }
  let shot = solveShot(ball.p, { x: tx, z: tz }, vh, top, side);
  // Mild assist: if the planned stroke would find the net, take a little pace off.
  for (let i = 0; sigMiss !== 'net' && i < 3 && shot.land && shot.land.net; i++) {
    vh *= 0.88;
    shot = solveShot(ball.p, { x: tx, z: tz }, vh, top, side);
  }
  // A touch drops short, but never past their reach: one they couldn't meet before its second
  // bounce lands a little deeper (the CPU's own drops play by the same rule: opponentCanReach).
  // It draws them in — not a free point.
  for (let i = 0; touch && i < 8 && shot.land && shot.land.table && !shot.land.net && shot.land.z < 0 && !reachableShort(ball.p, shot, -1); i++) {
    tz -= 0.06; vh = Math.hypot(tx - ball.p.x, tz - ball.p.z) / PLAYER_CFG.touch.time;
    shot = solveShot(ball.p, { x: tx, z: tz }, vh, top, side);
  }
  // A block or a chop stays low: one that would float over its arc is played a little firmer.
  for (let i = 0; i < 5 && arc < Infinity && shot.land && shot.land.table && !shot.land.net && arcOf(shot) > arc; i++) {
    const next = solveShot(ball.p, { x: tx, z: tz }, vh * 1.08, top, side);
    if (!next.land || !next.land.table || next.land.net || next.land.z >= 0) break;
    vh *= 1.08; shot = next;
  }
  // A brush: the face sends the ball where it points; the flick's friction then pushes it sideways
  // and spins it — not aimed, so a brush toward a corner can carry it wide.
  const brush = spin ? brushOf(swing.sideVx) : null;
  if (brush) { shot.v.x += brush.push; shot.w.y += brush.spin; }
  // A jutsu is chakra-guided: no hand error (and a jutsu with a shot of its own plays that).
  // FLOW steadies the hand.
  const js = jid && jutsuShot(jid, 'player', 0, contact);
  if (js && js.shot) shot = js.shot;
  const err = jid ? NO_ERROR : strokeError(AIM.stroke * yourSteady() * (chop ? CHOP.err : 1), contact.speedIn, contact.h, contact.off);
  shot = handPlay(ball.p, shot, err, brush ? 0 : AIM.rescues);
  TLOG.note({ edge: edge ? 1 : 0, err: lr(err.pitch), errBias: lr(err.bias), brush: brush ? lr(swing.sideVx) : 0 });
  if (sigMiss === 'net') intoNet(shot);   // the spin drags it down into the net
  if (sigMiss === 'long') {  // the spin kicks it off the end: it carries until it misses the table
    for (let i = 0, land; i < 25 && (land = landingOf({ p: { ...ball.p }, v: { ...shot.v }, w: { ...shot.w } }, false)) && land.table && land.z < 0; i++) {
      shot.v.x *= 1.06; shot.v.z *= 1.06; shot.v.y += 0.06;
    }
  }
  applyShot(shot);
  r.swing = 1;
  const kmh = Math.hypot(shot.v.x, shot.v.y, shot.v.z) * 3.6;
  match.stats.fastest = Math.max(match.stats.fastest, kmh);
  if (jid) fireJutsu('player', jid, 0, js && js.fizzle);
  else if (edge) showMessage('Edge!', '', 'warn', 0.7);
  if (touch) match.stats.touches++;
  setSpinShotAt(spin ? simTime : -1);   // (before registerHit stamps simTime on the ball: the CPU's read, combos, sees the brush)
  registerHit('player', jid ? 1.2 : touch ? 0.2 : power);
  pendingUpgrade = { hitTime: rally.lastHitTime, contact, miss: sigMiss };   // a wrong answer stays wrong as a smash
}

/** Your stroke against an incoming jutsu that needs an answer (JUTSU.answer): 'long' if it wanted
 *  a block and you didn't hold still, 'net' if it wanted a push and you didn't pull back; null when
 *  it's right, lucky (PLAYER_CFG.sigLuck), or your own jutsu J is a Copy Wheel (it cancels it). */
function answerMiss(J, { still, push }) {
  const jIn = incomingJutsu('player'), need = jIn && JUTSU[jIn].answer;
  if (!need || (J && J.self === 'copy') || Math.random() < PLAYER_CFG.sigLuck) return null;
  if (need === 'block' && !still) return 'long';
  if (need === 'push' && !push) return 'net';
  return null;
}

/** Your return of a signature shot with the wrong stroke (see SIGNATURES.counter): 'net' (it dies
 *  in the net), 'long' (it flies off the end), 'loop' (a Phantom Chop driven hard enough to get
 *  over, see SIGNATURES.loop), or null — the right stroke, or a lucky one (PLAYER_CFG.sigLuck).
 *  stroke: { push, touch, drive, fwd }. */
function sigReturn(bs, stroke) {
  const { push, touch, drive, fwd } = stroke;
  const pc = SIGNATURES['phantom-chop'];
  if (bs.sig === 'phantom-chop' && !push && drive && fwd >= pc.loop.fwd) return 'loop';
  const miss = {
    'phantom-chop': !push ? 'net' : null,                       // a push gets under it (a hard drive loops it)
    'dragon-loop': !drive ? 'long' : null,                      // only a drive holds it down
    'pimple-reversal': push || touch ? 'long' : null,           // looks like a chop, it's topspin
    'ghost-serve': bs.hidden === 'top' ? (push || touch ? 'long' : null) : (!push ? 'net' : null),
  }[bs.sig] || null;
  return miss && Math.random() >= PLAYER_CFG.sigLuck ? miss : null;
}

/** Lower a shot (struck from the ball's position) until the net stops it — not so far that it
 *  hits the striker's own half, which would read as a strange error. */
export function intoNet(shot) {
  const side = Math.sign(ball.p.z);
  shot.v.y -= rand(0, 0.2);
  for (let i = 0; i < 40; i++) {
    const land = landingOf({ p: { ...ball.p }, v: { ...shot.v }, w: { ...shot.w } }, false);
    if (!land || (land.net && !(land.table && Math.sign(land.z) === -side))) return shot;
    shot.v.y -= 0.08;
  }
  return shot;
}

/** Corner aim that eases into the corner instead of running off the table. */
const softAim = x => PLAYER_CFG.cornerX * Math.tanh(x / PLAYER_CFG.cornerX);

/** The moment of contact, as the stroke error needs it (see strokeError). */
function contactOf(contactDist) {
  return {
    offX: ball.p.x - player.pos.x, x: ball.p.x, h: ball.p.y - TABLE_TOP,
    off: contactDist / yourReach(), speedIn: Math.hypot(ball.v.x, ball.v.y, ball.v.z),
    topIn: topspinOf(unreadSpin(), ball.v),
    popUp: poppedUp(),   // the CPU floated your brush back up (Set & Kill)
  };
}

/** Smash: pace scales with swing speed, aimed deep toward the side you swing to, then played
 *  with the hand error of a smash (see AIM): safe off a high, slow ball, a gamble off a low, fast or
 *  spinny one — and the faster the flick, the less room to spare. `contact` is the moment of
 *  contact; for an upgrade (swing finished just after a normal hit) it is the remembered one,
 *  and the shot is re-solved from where the ball is now. */
function playerSmash(swingSpeed, sl, contact, upgrade = false) {
  const swing = Math.max(swingSpeed, SMASH.minSwing);
  const jid = yourJutsu(), J = jid && JUTSU[jid];
  let vh = clamp(SMASH.minSpeed + (swing - SMASH.minSwing) * 1.2, SMASH.minSpeed, SMASH.maxSpeed);
  // The flick's direction leads the aim (diagonal right → right); contact point adds a little.
  const tx = clamp(contact.x * 0.3 + contact.offX * 0.6 + sl * 0.25, -0.65, 0.65);
  const tz = -rand(0.95, 1.25);
  const top = SMASH.topspin + input.tilt * 40;
  let shot = solveShot(ball.p, { x: tx, z: tz }, vh, top, clamp(sl * 5, -30, 30));
  if (shot.land && shot.land.net) {                    // no clear path at this pace: flatten a little
    vh *= 0.9;
    shot = solveShot(ball.p, { x: tx, z: tz }, vh, top, 0);
  }
  const js = jid && jutsuShot(jid, 'player', 0, contact);
  if (js && js.shot) shot = js.shot;
  // Set & Kill: the pop-up your brush forced — a steady smash, with no low-ball risk.
  const setUp = contact.popUp;
  const err = jid ? NO_ERROR : strokeError(AIM.smash * yourSteady() * (setUp ? COMBO.setKill.steady : 1), contact.speedIn, contact.h, contact.off, contact.topIn - input.tilt * 80, setUp ? 0 : AIM.smashLow);
  shot = handPlay(ball.p, shot, err, AIM.rescues);
  // Smashing into a jutsu that wants a block or a push: it flies long / dies in the net.
  const miss0 = answerMiss(J, { still: false, push: false });
  if (miss0 === 'long') { shot.v.x *= 1.25; shot.v.z *= 1.25; shot.v.y += 0.8; }
  if (miss0 === 'net') intoNet(shot);
  applyShot(shot);
  player.swing = 1;
  const kmh = Math.hypot(shot.v.x, shot.v.y, shot.v.z) * 3.6;
  match.stats.fastest = Math.max(match.stats.fastest, kmh);
  match.stats.smashes++;
  setSpinShotAt(-1);
  setCameraShake(SMASH.shake * (jid ? 2 : 1));
  const miss = smashMissReason(shot, contact, err);
  const smashLog = { setKill: setUp ? 1 : 0, stroke: upgrade ? 'smash(late)' : 'smash', flick: lr(swing), smashSl: lr(sl), err: lr(err.pitch), errBias: lr(err.bias), smashMiss: miss || null, jutsu: jid || null };
  if (upgrade) TLOG.amend(smashLog); else TLOG.note(smashLog);
  if (DEBUG.on) DEBUG.log.push({ stroke: jid || 'smash', sig: rally.botShot && rally.botShot.sig, miss, h: +contact.h.toFixed(2) });
  if (jid) {
    fireJutsu('player', jid, 0, js && js.fizzle);
    if (upgrade) { rally.jutsu = rally.pendingJutsu; rally.pendingJutsu = null; startJutsu(rally.jutsu); }   // no registerHit on an upgrade
  } else showMessage('SMASH!', `${Math.round(kmh)} km/h${miss ? ` · ${miss}` : ''}`, miss ? 'bad' : 'warn', 0.9, 2);
  Sound.smash();
  pendingUpgrade = null;
  if (!jid) rally.yourSmashes++;   // your habits (ADAPT.smash) — a jutsu is chakra, not a habit
  rally.smashH = contact.h;
  if (upgrade) {
    rally.smashed = !jid;
    if (rally.mirror.ai === 'up') mirrorCheck('ai');   // the soft stroke became a smash: their mirror may prime
    const c = turnBot('ai'); if (c) aiOnOpponentHit(c);
  }   // same stroke, new trajectory: the CPU has to re-read it
  else registerHit('player', 1.2, !jid);
}

/** If this smash won't land, the main reason, so the player learns which balls to smash. */
function smashMissReason(shot, contact, err) {
  const land = landingOf({ p: { ...ball.p }, v: { ...shot.v }, w: { ...shot.w } }, false);
  if (land && land.table && land.z < 0 && Math.abs(land.x) <= HALF_W) return '';
  if (Math.abs(err.bias) > 0.25) return err.bias > 0 ? 'topspin lifted it' : 'backspin pulled it down';
  if (contact.h < 0.3) return 'ball too low';
  if (contact.speedIn > 9) return 'ball too fast';
  if (contact.off > 0.7) return 'off-center';
  return land && land.net ? 'into the net' : 'overhit';
}

/** A normal hit that may still become a smash if the swipe peaks within SMASH.grace. */
export let pendingUpgrade = null;
export function checkSmashUpgrade() {
  const u = pendingUpgrade;
  if (!u) return;
  if (!rally.live || rally.lastHitTime !== u.hitTime || simTime - u.hitTime > SMASH.grace || ball.p.z < 0.2) {
    pendingUpgrade = null;
    return;
  }
  if (u.miss) return;   // it already went wrong (a jutsu's or a signature's answer): no rescue
  if (rally.jutsu && rally.jutsu.by === 'player') return;   // a jutsu stroke stays what it was
  if (recentSwing() >= smashNeed(u.contact.h) && swing.peakAt >= u.hitTime) playerSmash(recentSwing(), swing.vx, u.contact, true);
  else if (spinShotAt !== u.hitTime && recentSide() >= SPIN.minSwing && swing.sideAt >= u.hitTime) playerSpinUpgrade(u);
}

/** A sideways flick that peaks just after a normal hit (swinging through the ball): the same
 *  stroke, plus the brush's push and sidespin (see SPIN). */
function playerSpinUpgrade(u) {
  const brush = brushOf(swing.sideVx);
  ball.v.x += brush.push; ball.w.y += brush.spin;
  rally.shotW = { ...ball.w };   // the brush is part of the stroke's spin
  setSpinShotAt(u.hitTime);
  if (TLOG.last) TLOG.amend({ stroke: TLOG.last.stroke + '+side', brush: lr(swing.sideVx), sideFlick: lr(recentSide()) });
  const c = turnBot('ai');
  if (c) aiOnOpponentHit(c);   // same stroke, new trajectory: the CPU has to re-read it
}

export function applyShot(shot) {
  Object.assign(ball.v, shot.v);
  Object.assign(ball.w, shot.w);
}

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setPendingUpgrade(v) { return (pendingUpgrade = v); }
