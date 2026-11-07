// Chakra, the jutsu and their effects, FLOW, Ego rank.
import { clamp, rand } from './util.js';
import { AI_COMMON, CHAKRA, FLOW, GODHAND, HIRAISHIN, JUTSU, JUTSU_AI, META_REACH, META_STEADY, MIRROR, MISDIRECT, PLAYER_CFG, POSSESSION, RANK, SAMEHADA, SLOTS, SLOT_COST, SMASH, SPIRIT, STOP, STYLE_KIT } from './config.js';
import { HALF_L, HALF_W, TABLE_TOP, landingOf, predictBounce, simulate, solveShot, stepBall } from './physics.js';
import { crowdReact } from './render/venues.js';
import { player } from './render/racket.js';
import { FX_TEX, HAND_TEX, ball, decoys, fxBurst, fxMark, fxSprite, marker, setBall } from './render/ball.js';
import { applyShot, pendingUpgrade, setPendingUpgrade, topspinOf } from './strokes.js';
import { activeBots, ai, aiPlay, levelCfg, memberBot, memberRacket, noteAIShot, seesJutsu, styleCfg, turnBot, turnRacket, yourTurn } from './ai.js';
import { incomingJutsu, isPlaying, isYou, liveJutsu, match, nameOf, opp, other, rally, registerHit } from './rules.js';
import { $, showMessage, store } from './ui/hud.js';
import { hex } from './tournament.js';
import { Sound } from './audio.js';
import { cameraShake, setCameraShake, simTime } from './loop.js';

/* =====================================================================
   JUTSU — chakra, arming, the three jutsu, counters, FLOW, Ego rank
   ===================================================================== */
export const chakra = { player: 0, ai: 0 };
export const flow = { player: false, ai: false, streak: { player: 0, ai: 0 }, deep: { player: false, ai: false } };   // deep: an Awakening's FLOW, it survives a lost point
export let armed = 0;   // the jutsu (1–3 in your kit) your next stroke fires; 0: not armed
export const NO_ERROR = { pitch: 0, yaw: 0, bias: 0 };
export const sealsOf = side => Math.floor(chakra[side] / CHAKRA.seal);
export const chakraFull = side => chakra[side] >= CHAKRA.max;
/** Your kit (start menu), restored from storage with the menus (buildMenus). */
export let yourKit = [...STYLE_KIT.allround];
/** Your contact reach: Flying Thunder God makes it huge for the rest of the point. */
export const yourReach = () => PLAYER_CFG.hitRadius * (rally.warp.player ? HIRAISHIN.reach : 1) * (rally.mirror.player === 'primed' ? MIRROR.reach : 1) * (flow.deep.player ? FLOW.deep.reach : 1) * (rally.zone === 'player' ? META_REACH : 1);
/** A bot's contact reach (Flying Thunder God: bigger). */
export const botReach = side => AI_COMMON.hitRadius * (rally.warp[side] ? HIRAISHIN.reach : 1) * (rally.mirror[side] === 'primed' ? MIRROR.reach : 1) * (flow.deep[side] ? FLOW.deep.reach : 1) * (rally.zone === side ? META_REACH : 1);
export const kitOfBot = c => c.kit || STYLE_KIT[c.style] || STYLE_KIT.allround;   // (c.kit: a test's override)
/** The kit of whoever plays `side`'s strokes: yours, or that side's bot's style kit. */
const kitOf = side => (isYou(side) ? yourKit : kitOfBot(memberBot(side, rally.turn[side]) || ai));
export const kitJutsu = (side, slot) => kitOf(side)[SLOTS.indexOf(slot)];
export const canFire = (side, slot) => !rally.fired[side] && sealsOf(side) >= SLOT_COST[slot];

export function resetJutsu() {
  chakra.player = chakra.ai = 0;
  armed = 0;
  flow.player = flow.ai = false; flow.streak.player = flow.streak.ai = 0; flow.deep.player = flow.deep.ai = false;
  clearDecoys();
  syncChakra(); syncFlow();
}
export function gainChakra(side, amount) {
  if (!isPlaying()) return;
  const k = flow[side] ? CHAKRA.flow : 1;
  chakra[side] = Math.min(CHAKRA.max, chakra[side] + amount * k);
  syncChakra();
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* no haptics */ } };
/** A double-tap, a second finger, your scorebug row, Space or right-click: arm the biggest jutsu
 *  your seals pay for — or disarm. tier (1–3, keys 1–3 or a tap on the armed list): switch to that
 *  one (the armed one again: disarm). Any stroke then fires it. */
export function armJutsu(tier = 0) {
  if (match.paused || match.watch || !isPlaying() || rally.fired.player) return;
  const n = Math.min(sealsOf('player'), SLOTS.length);
  if (tier) armed = armed === tier || tier > n ? 0 : tier;
  else armed = armed ? 0 : n;
  if (armed) { Sound.seal(); flashFx(JUTSU[yourKit[armed - 1]].color); buzz(25); }
  syncChakra();
}
/** Auto jutsu (Settings, for one-handed play): with all seals full you are armed without a tap. */
export let autoJutsu = false;
const armedTier = () => armed || (autoJutsu && chakraFull('player') && !rally.fired.player ? SLOTS.length : 0);
const isArmed = () => armedTier() > 0;
/** Your stroke's jutsu: the one you armed, if you can still pay for it (else a normal stroke, still armed). */
export const yourJutsu = () => {
  const slot = SLOTS[armedTier() - 1];
  const id = slot && canFire('player', slot) ? kitJutsu('player', slot) : null;
  return id && idleJutsu('player', id) ? null : id;
};
/** A self jutsu with nothing to do right now: a Copy Wheel with no jutsu to copy, a Samehada with
 *  no seals to eat, an Awakening already in FLOW, a Guard already up (a Mirror too). */
export function idleJutsu(side, id) {
  const self = JUTSU[id].self;
  return self === 'copy' ? !incomingJutsu(side) : self === 'drain' ? sealsOf(other(side)) < 1
    : self === 'flow' ? flow.deep[side] : self === 'warp' ? rally.warp[side] : self === 'hand' ? rally.hand[side]
    : self === 'mirror' ? !!rally.mirror[side] : self === 'charge' ? !!rally.charge[side] : false;
}

/** `side`'s stroke fires jutsu `id`: seals spent; it goes live in registerHit. dir: the corner (world
 *  X sign) it aims at; 0 = away from the receiver's racket. A Copy Wheel
 *  fires the incoming jutsu back instead (its seals: the Copy Wheel's). fizzle: a Black Flash that
 *  missed the center — the seals are gone, the stroke is a normal one. */
export function fireJutsu(side, id, dir = 0, fizzle = false) {
  const slot = SLOTS[kitOf(side).indexOf(id)];
  chakra[side] = Math.max(0, chakra[side] - SLOT_COST[slot || 'block'] * CHAKRA.seal);
  rally.fired[side] = true;
  const broke = rally.bind === side;
  if (broke) breakBind(side);   // chakra breaks a Shadow Possession — and that's all it does (but a mirror)
  let j = JUTSU[id], name = j.name;
  let copied = false;
  if (j.self === 'copy') {
    const copy = incomingJutsu(side);
    if (copy) { name = `${j.name} · ${JUTSU[copy].name}`; id = copy; j = JUTSU[copy]; copied = true; Sound.sharingan(); }
  }
  if (isYou(side)) { armed = 0; match.stats.jutsu++; buzz([20, 30, 40]); }
  if (fizzle) {
    if (isYou(side) && !broke) callout('✕', j.name, 'HIT DEAD CENTER', 0x8a93a6);
    rally.pendingJutsu = null;
    return syncChakra();
  }
  if (isYou(side)) callout(j.kanji, name, '', j.color);
  else if (name !== j.name) callout(j.kanji, name, match.watch ? '' : j.counter, j.color);
  if (j.flash) { chakra[side] = Math.min(CHAKRA.max, chakra[side] + CHAKRA.seal); setCameraShake(SMASH.shake * 2.2); }   // Black Flash: a seal back
  if (j.self === 'slow') { if (isYou(side)) rally.slow = true; rally.zone = side; }   // Meta Vision: steady hands (yours: their balls in slow motion too)
  if (j.self === 'warp') rally.warp[side] = true;
  if (j.self === 'hand') rally.hand[side] = true;
  if (j.self === 'void') rally.void = side;
  if (j.self === 'drain') rally.shark = side;   // pays out in endPoint, if this side wins the point
  if (j.self === 'mirror') rally.mirror[side] = 'up';
  if (j.self === 'bind') rally.bind = other(side);
  if (j.self === 'charge') { rally.charge[side] = { n: 0 }; if (copied) rally.charge[other(side)] = null; }   // a copy cancels theirs
  if (j.self === 'flow') { flow[side] = flow.deep[side] = true; flow.streak[side] = Math.max(flow.streak[side], FLOW.streak); syncFlow(); }
  rally.pendingJutsu = { id, by: side, dir };
  syncChakra();
}
/** Samehada, when its side wins the point: eats up to SAMEHADA.take of the other side's seals and
 *  keeps some. Seals they spent during the point are safe (SPEND FIRST); whatever they had armed
 *  that they can no longer pay for stays unplayed. */
export function drainSeals(side) {
  const foe = other(side), took = Math.min(SAMEHADA.take, sealsOf(foe));
  chakra[foe] -= took * CHAKRA.seal;
  chakra[side] = Math.min(CHAKRA.max, chakra[side] + Math.min(took, SAMEHADA.keep) * CHAKRA.seal);
  if (isYou(foe)) armed = Math.min(armed, sealsOf(foe));
  const orbs = $(foe === 'player' ? 'orbs-p' : 'orbs-a');
  if (orbs) { orbs.classList.remove('drained'); void orbs.offsetWidth; orbs.classList.add('drained'); }
  fxBurst(turnRacket(foe).pos.x, turnRacket(foe).pos.y, turnRacket(foe).pos.z, JUTSU.samehada.color, 0.4);
  if (took) { Sound.samehada(); if (!match.watch) showMessage(isYou(side) ? 'Samehada feeds' : 'Samehada ate your seals', `${took} seal${took > 1 ? 's' : ''} eaten`, isYou(side) ? 'good' : 'bad', 1.2, 3); }
  syncChakra();
}

/** A shot that floats up deep toward `tgt` (on the other side from `by`): slow, so it sits up —
 *  the Mirror's bait and a possessed stroke. Faster only if the net is in the way. */
function floatShot(by, tgt, cfg) {
  const toward = by === 'player' ? -1 : 1;
  const lands = sh => sh.land && sh.land.table && !sh.land.net && Math.sign(sh.land.z) === toward;
  let vh = rand(...cfg.speed), shot = solveShot(ball.p, tgt, vh, cfg.top, 0);
  for (let i = 0; i < 14 && !lands(shot); i++) shot = solveShot(ball.p, tgt, vh *= 1.06, cfg.top, 0);
  return shot;
}
/** Yata Mirror: `side`'s mirror is up and the other side just struck. Hard enough: it is primed
 *  (it will reflect). Softer: it stays up, waiting, for the rest of the point. */
export function mirrorCheck(side) {
  const j = JUTSU.mirror, r = turnRacket(side);
  if (Math.hypot(ball.v.x, ball.v.z) >= MIRROR.min) {
    rally.mirror[side] = 'primed';
    fxSprite(FX_TEX.ring, j.color, r.pos.x, r.pos.y + 0.05, r.pos.z, 0.3, 0.4, 1.5);
    Sound.mirror();
    return;
  }
}
/** A primed Yata Mirror meets the ball: it goes back faster, flat, to the corner away from the
 *  striker — chakra-guided, it lands. A COUNTER (chakra back). */
export function mirrorReflect(side, c = null) {
  const j = JUTSU.mirror, toward = side === 'player' ? -1 : 1, foe = turnRacket(other(side)), r = turnRacket(side);
  rally.mirror[side] = 0;
  if (rally.bind === side) rally.bind = null;   // the mirror breaks a Shadow Possession too
  const tx = -(Math.sign(foe.pos.x) || 1) * rand(0.48, 0.62), top = 30;
  const tgt = { x: tx, z: toward * rand(1.0, 1.18) };
  let vh = clamp(Math.hypot(ball.v.x, ball.v.z) * MIRROR.boost, MIRROR.min, MIRROR.max), shot = solveShot(ball.p, tgt, vh, top, 0);
  const lands = sh => sh.land && sh.land.table && !sh.land.net && Math.sign(sh.land.z) === toward;
  for (let i = 0; i < 14 && !lands(shot); i++) shot = solveShot(ball.p, tgt, vh *= 0.94, top, 0);
  fxSprite(FX_TEX.ring, j.color, r.pos.x, r.pos.y + 0.05, r.pos.z, 0.5, 0.5, 2.5);
  fxBurst(ball.p.x, ball.p.y, ball.p.z, j.color, 0.5);
  flashFx(j.color); setCameraShake(SMASH.shake * 1.8);
  callout(j.kanji, j.name, 'REFLECTED', j.color);
  gainChakra(side, CHAKRA.counter);
  if (isYou(side)) { match.stats.counters++; buzz([30, 20, 50]); crowdReact('player', 0.8); }
  rally.jutsu = null;   // (no second counter for the ball it reflected)
  rally.pendingJutsu = { id: 'mirror', by: side, dir: 0 };
  setPendingUpgrade(null);
  if (c) { aiPlay(c, shot, top, 1.3); noteAIShot(c, null, tx, top, false); }
  else { applyShot(shot); player.swing = 1; registerHit('player', 1.3); }
}
/** Spirit Bomb ready: `side`'s next stroke is the bomb. */
export const spiritReady = side => !!rally.charge[side] && rally.charge[side].n >= SPIRIT.need;
/** `side` (c: its bot, null = you) releases its gathered Spirit Bomb: chakra-guided (no error), fast,
 *  to the corner away from the receiver. It is a jutsu ball: returned onto the table, a COUNTER. */
export function releaseSpirit(side, c = null) {
  const j = JUTSU.spiritbomb, toward = side === 'player' ? -1 : 1, recv = turnRacket(other(side)), r = turnRacket(side);
  rally.charge[side] = null;
  const tx = -(Math.sign(recv.pos.x) || 1) * rand(...SPIRIT.wide), tgt = { x: tx, z: toward * rand(1.0, 1.2) };
  const lands = sh => sh.land && sh.land.table && !sh.land.net && Math.sign(sh.land.z) === toward;
  let vh = rand(...SPIRIT.speed), shot = solveShot(ball.p, tgt, vh, SPIRIT.top, 0);
  for (let i = 0; i < 12 && !lands(shot); i++) shot = solveShot(ball.p, tgt, vh *= 0.94, SPIRIT.top, 0);
  fxSprite(FX_TEX.burst, j.color, r.pos.x, r.pos.y + 0.1, r.pos.z, 0.7, 0.5, 2.5);
  flashFx(j.color); setCameraShake(SMASH.shake * 2);
  callout(j.kanji, j.name, isYou(side) || match.watch ? 'RELEASED' : '', j.color);
  rally.pendingJutsu = { id: 'spiritbomb', by: side, dir: 0 };
  setPendingUpgrade(null);
  if (c) { aiPlay(c, shot, SPIRIT.top, 1.4); noteAIShot(c, null, tx, SPIRIT.top, false); }
  else { applyShot(shot); player.swing = 1; registerHit('player', 1.4); }
}
/** Shadow Possession: `side` is bound and strikes without a jutsu — the stroke is the caster's: it
 *  floats to the caster's racket and sits up (POSSESSION). The caster's next ball is the combo. */
export function possessedStroke(side, c = null) {
  const j = JUTSU.possession, caster = other(side), cr = turnRacket(caster), r = turnRacket(side), toward = side === 'player' ? -1 : 1;
  rally.bind = null;
  const tx = clamp(cr.pos.x, -0.5, 0.5) + rand(-0.06, 0.06);
  const shot = floatShot(side, { x: tx, z: toward * rand(...POSSESSION.depth) }, POSSESSION);
  rally.combo = caster;
  fxSprite(FX_TEX.ring, j.color, r.pos.x, r.pos.y, r.pos.z, 0.3, 0.5, 1.5);
  Sound.possession();
  if (isYou(side)) callout(j.kanji, 'POSSESSED', 'YOUR BALL FLOATS TO THEM', j.color);
  else if (!match.watch) showMessage('Possessed!', 'It floats to you — smash it', 'good', 1, 2);
  if (c) { rally.held = side; aiPlay(c, shot, POSSESSION.top, 0.3); noteAIShot(c, null, tx, POSSESSION.top, false); }
  else { applyShot(shot); player.swing = 1; setPendingUpgrade(null); registerHit('player', 0.3, false, false); }
}
/** `side` fired a jutsu while bound: the shadow lets go. */
function breakBind(side) {
  rally.bind = null;
  const r = turnRacket(side);
  fxBurst(r.pos.x, r.pos.y, r.pos.z, JUTSU.possession.color, 0.35);
  if (!match.watch) showMessage('Shadow broken', '', isYou(side) ? 'good' : 'bad', 0.8, 1);
}
/** God Hand: the first ball that would lose `side` the point (it beat them, or their own went out
 *  or into the net) is caught behind their end line and played back, deep — the point goes on. */
export function godHandSave(side) {
  rally.hand[side] = false;
  const s = side === 'player' ? 1 : -1, j = JUTSU.godhand;
  const p = { x: clamp(ball.p.x, -HALF_W + 0.15, HALF_W - 0.15), y: TABLE_TOP + 0.32, z: s * (HALF_L + 0.25) };
  const tgt = { x: -(Math.sign(turnRacket(other(side)).pos.x) || 1) * rand(...GODHAND.wide), z: -s * rand(0.95, 1.15) };   // away from them
  let vh = rand(...GODHAND.speed), shot = solveShot(p, tgt, vh, GODHAND.top, 0);
  for (let i = 0; i < 12 && !(shot.land && shot.land.table && !shot.land.net); i++) shot = solveShot(p, tgt, vh *= 0.92, GODHAND.top, 0);
  setBall(p, shot.v, shot.w);
  fxSprite(HAND_TEX, j.color, p.x, p.y + 0.12, p.z, 0.5, 0.7, 0.6);
  fxBurst(p.x, p.y, p.z, j.color, 0.45);
  flashFx(j.color); Sound.godhand(); buzz(40);
  callout(j.kanji, j.name, 'CAUGHT', j.color);
  rally.pendingJutsu = null;
  registerHit(side, 0.8, false, false);
}
/** Time Stop: the ball hangs over the net while the receiving side stands frozen (STOP.time). */
function stopTime(side) {
  rally.stop = { side, until: simTime + STOP.time };
  flashFx(JUTSU.timestop.color); Sound.timestop();
}
/** Time flows again: the ball darts off to the corner away from the receiver's racket. */
export function resumeTime() {
  const side = rally.stop.side, jt = liveJutsu(), j = jt && JUTSU[jt.id];
  rally.stop = null;
  if (!j) return;
  const toward = side === 'player' ? 1 : -1, recv = turnRacket(side);
  const tgt = { x: -(Math.sign(recv.pos.x) || 1) * rand(...STOP.dart.wide), z: toward * rand(...j.depth) };
  let vh = rand(...STOP.dart.speed), shot = solveShot(ball.p, tgt, vh, j.top, 0);
  const lands = sh => sh.land && sh.land.table && !sh.land.net && Math.sign(sh.land.z) === toward;
  for (let i = 0; i < 12 && !lands(shot); i++) shot = solveShot(ball.p, tgt, vh *= 0.92, j.top, 0);
  if (!lands(shot)) return;   // no room: it goes on as it was
  Object.assign(ball.v, shot.v); Object.assign(ball.w, shot.w);
  fxBurst(ball.p.x, ball.p.y, ball.p.z, j.color, 0.3);
  Sound.poof();
  if (yourTurn() && side === 'player') {
    const m = predictBounce(ball, 1);
    marker.visible = !!m;
    if (m) marker.position.set(m.x, TABLE_TOP + 0.003, m.z);
  }
  rereadJutsu(side);
}
/** A jutsu goes live on the ball (its stroke was just registered). */
export function startJutsu(jt) {
  const j = JUTSU[jt.id];
  speedLines();
  if (j.decoys) spawnClones();
  if (j.snake && nextSnake) { rally.snake = { ...nextSnake, t0: simTime, off: 0 }; nextSnake = null; }
  (Sound[jt.id] || Sound.jutsu).call(Sound, jt.id);
}

/** The shot a jutsu plays from the ball's position, toward `by`'s opponents: { shot, tx, top }.
 *  Chakra-guided: no hand error, and it slows until it lands. { shot: null }: no shot of its own (a
 *  self jutsu, or decoys on top of the stroke). A Copy Wheel plays the incoming jutsu's shot. A
 *  Black Flash off-center (contact.off ≥ flash; a CPU: JUTSU_AI.flash) fizzles: { fizzle: true }. */
let nextSnake = null;   // the curl of the Boomerang Snake just played (startJutsu puts it on the ball)
export function jutsuShot(id, by, dir = 0, contact = null) {
  if (rally.bind === by && JUTSU[id].self !== 'mirror') return { shot: null, fizzle: true };   // its chakra only breaks the shadow
  if (JUTSU[id].self === 'copy') id = incomingJutsu(by) || id;
  const j = JUTSU[id], toward = by === 'player' ? -1 : 1, recv = turnRacket(other(by));
  if (j.flash) {
    const c = turnBot(by), hit = c ? Math.random() < JUTSU_AI[c.level].flash : !contact || contact.off < j.flash;
    if (!hit) return { shot: null, fizzle: true };
  }
  if (j.self === 'mirror') {   // the bait: a ball that sits up, deep
    const tx = rand(-0.35, 0.35);
    return { shot: floatShot(by, { x: tx, z: toward * rand(...MIRROR.bait.depth) }, MIRROR.bait), tx, top: MIRROR.bait.top };
  }
  if (!j.speed) return { shot: null };
  let tx = rand(-0.25, 0.25), tz = rand(1.0, 1.2);
  if (j.aim === 'body') tx = clamp(recv.pos.x + rand(-0.12, 0.12), -0.6, 0.6);
  if (j.aim === 'corner') tx = (dir || -(Math.sign(recv.pos.x) || 1)) * rand(0.55, 0.66);
  if (j.snake) tx = (dir || -(Math.sign(recv.pos.x) || 1)) * rand(0.42, 0.55);   // it curls in to this corner
  if (j.depth) tz = rand(...j.depth);
  const lands = sh => sh.land && sh.land.table && !sh.land.net && Math.sign(sh.land.z) === toward;
  let vh = rand(...j.speed), shot = solveShot(ball.p, { x: tx, z: toward * tz }, vh, j.top, 0);
  for (let i = 0; i < 12 && !lands(shot); i++) shot = solveShot(ball.p, { x: tx, z: toward * tz }, vh *= 0.92, j.top, 0);
  if (j.snake) {   // the curl: an offset on top of the real path, zero at both ends (see stepSnake)
    nextSnake = { T: flightTime(shot), out: Math.sign(tx) * j.snake };
  }
  return { shot, tx, top: j.top };
}
/** Time until a shot (from the ball's position) first touches the table or floor. */
function flightTime(shot) {
  return simulate({ p: { ...ball.p }, v: { ...shot.v }, w: { ...shot.w } }, 2, (b, ev, t) => (ev.table || ev.floor ? t : undefined)) || 0.5;
}

/** Shadow Clone: two decoys fly at the other lanes of the table, same pace and spin. */
function spawnClones() {
  const land = landingOf(ball, false);
  if (!land || !land.table) return;
  const top = topspinOf(ball.w, ball.v), vh = Math.hypot(ball.v.x, ball.v.z);
  const lanes = [-0.5, 0, 0.5].sort((a, b) => Math.abs(b - land.x) - Math.abs(a - land.x));
  decoys.forEach((d, k) => {
    const shot = solveShot(ball.p, { x: lanes[k] + rand(-0.08, 0.08), z: land.z + rand(-0.12, 0.12) }, vh * rand(0.95, 1.05), top, 0);
    d.b = { p: { ...ball.p }, v: shot.v, w: shot.w };
  });
}
const decoyEv = { net: false, table: null, floor: null, side: false };
export function stepDecoys(dt) {
  for (const d of decoys) if (d.b) stepBall(d.b, dt, decoyEv);
  if (simTime >= rally.cloneRevealAt) revealClones();
}
export const clearDecoys = () => { for (const d of decoys) d.b = null; };
/** Just after the real ball's bounce the clones go up in smoke: a bot that chased one has to find
 *  the real ball (a reaction's delay). */
function revealClones() {
  rally.cloneRevealAt = Infinity;
  if (!decoys.some(d => d.b)) return;
  clearDecoys();
  Sound.poof();
  for (const c of activeBots()) if (c.plan && c.plan.decoy) {
    c.plan.decoy = null; c.plan.computed = false;
    c.plan.readyAt = simTime + levelCfg(c).reactionMs * styleCfg(c).reaction / 1000 * 0.8;
  }
}
/** A jutsu changed the ball's path (a vanish, curl, time stop or roll-back) on its way to `side`:
 *  that side's bot re-reads it at once if it saw it coming (JUTSU_AI.see), else it freezes for a
 *  moment (× freezeK: longer for a ball it lost sight of). */
function rereadJutsu(side, freezeK = 1) {
  const c = turnBot(side);
  if (!c || !c.plan) return;
  const jt = liveJutsu(), ja = JUTSU_AI[c.level], freeze = (jt ? seesJutsu(c, jt.id) : Math.random() < ja.see) ? 0 : ja.reread * freezeK;
  c.plan.computed = false; c.plan.err = null;
  c.plan.readyAt = simTime + levelCfg(c).reactionMs * styleCfg(c).reaction / 1000 * freeze;
}
/** The live jutsu crosses the net toward `side`: it vanishes, or time stops. */
export function jutsuAtNet(jt, side) {
  const j = JUTSU[jt.id];
  if (j.stop) stopTime(side);
  if (j.vanish) { rally.hidden = true; fxBurst(ball.p.x, ball.p.y, ball.p.z, j.color, 0.18); Sound.poof(); rereadJutsu(side, MISDIRECT.freeze); }
}
/** Boomerang Snake, every step until its bounce: the ball bows out past the side line and curls
 *  back in — an offset on top of its real flight (so it lands where it was aimed). */
export function stepSnake() {
  const sn = rally.snake, jt = liveJutsu();
  if (!sn || !jt || !JUTSU[jt.id].snake || jt.bounced) { rally.snake = null; return; }
  const u = clamp((simTime - sn.t0) / sn.T, 0, 1), off = 4 * sn.out * u * (1 - u);
  ball.p.x += off - sn.off; sn.off = off;
}
/** The live jutsu bounces on `side`'s half (its first bounce there): it may roll back. */
export function jutsuAtBounce(jt, side) {
  const j = JUTSU[jt.id];
  if (j.decoys) rally.cloneRevealAt = Math.min(rally.cloneRevealAt, simTime + JUTSU.clone.reveal);
  if (j.vanish) { rally.hidden = false; fxMark(ball.p.x, ball.p.z, j.color, 'ripple'); Sound.poof(); }
  if (j.snake) { if (rally.snake) ball.p.x -= rally.snake.off; rally.snake = null; }
  if (!j.rollback) return;
  // The backspin bites: it hops back toward the net.
  ball.v.x *= 0.3; ball.v.y = 1.5; ball.v.z = -Math.sign(ball.p.z) * 1.0;
  ball.w.x = ball.w.y = ball.w.z = 0;
  fxMark(ball.p.x, ball.p.z, j.color, j.fx.mark);
  flashFx(j.color); Sound.poof();
  rereadJutsu(side);
}

/** `side`'s stroke landed on the other half: chakra, and if it answered a jutsu, a COUNTER. */
export function strokeLanded(side) {
  gainChakra(side, CHAKRA.stroke + (match.rallyCount > CHAKRA.rallyFrom ? CHAKRA.rally : 0));
  if (rally.charge[side]) rally.charge[side].n++;              // a Spirit Bomb gathers
  const j = rally.jutsuAnswer;
  rally.jutsuAnswer = null;
  if (!j || j.by === side) return;
  gainChakra(side, CHAKRA.counter);
  if (match.watch) return showMessage('Counter!', JUTSU[j.id].name, 'neutral', 0.9, 2);
  if (isYou(side)) {
    match.stats.counters++;
    callout('返', 'COUNTER!', '', 0xffd23f);
    Sound.counter();
    buzz(30);
    crowdReact('player', 0.8);
  } else showMessage('Countered', '', 'bad', 0.9, 2);
}

/** FLOW: FLOW.streak points in a row; losing one ends it. */
export function updateFlow(winner) {
  const loser = other(winner), st = flow.streak;
  st[winner]++; st[loser] = 0;
  if (flow.deep[loser]) flow.deep[loser] = false;   // an Awakening's FLOW holds once
  else flow[loser] = false;
  if (!flow[winner] && st[winner] >= FLOW.streak) {
    flow[winner] = true;
    if (isYou(winner)) { match.stats.flows++; callout('覚醒', 'FLOW', 'EGO AWAKENED', 0xffd23f); Sound.flow(); buzz([30, 40, 60]); }
    else callout('覚醒', `${nameOf(winner).toUpperCase()} · FLOW`, '', opp.color);
  }
  syncFlow();
}

/** Ego rank (#1 is the top): a win climbs, a loss slips. Returns { before, after }. */
export const rankNow = () => clamp(Math.round(store.get('pp3d.rank', RANK.start)), 1, 999);
export function moveRank(won) {
  const before = rankNow();
  const gain = won ? RANK.win[match.levelKey] * (match.doubles ? RANK.duo : match.mode === 'tour' ? RANK.tour : 1) : -RANK.loss;
  const after = clamp(Math.round(before - gain), 1, 999);
  store.set('pp3d.rank', after);
  return { before, after };
}
/** Ego grade for your match: points share, the win, counters, flows, jutsu, winners vs errors. */
export function egoGrade(won) {
  const s = match.stats, total = s.pointsWon[0] + s.pointsWon[1] || 1;
  const e = 100 * s.pointsWon[0] / total + (won ? 12 : 0) + s.counters * 5 + s.flows * 5 + s.jutsu * 2 + s.winners * 0.5 - s.errors * 0.8;
  return e >= 80 ? 'S' : e >= 66 ? 'A' : e >= 52 ? 'B' : e >= 40 ? 'C' : 'D';
}

/** Anime FX: a slashed call-out (kanji behind the name, a counter tag below), speed lines, a flash. */
const restart = el => { el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); };
export function callout(kanji, name, sub, color) {
  const el = $('callout');
  el.style.setProperty('--c', hex(color));
  el.querySelector('.kanji').textContent = kanji;
  el.querySelector('b').textContent = name;
  el.querySelector('small').textContent = sub;
  restart(el);
  speedLines();
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function speedLines() { if (!reducedMotion) restart($('speedlines')); }
function flashFx(color) { if (reducedMotion) return; $('flash').style.setProperty('--c', hex(color)); restart($('flash')); }

/** HUD (Naruto Storm style): each side's chakra ring takes the color of the jutsu its seals fire
 *  now; its seal orbs light one by one in their jutsu's colors (a new one flashes, a full set keeps
 *  flashing). When you reach a new seal level, "<jutsu> ready" pops up once. While armed: your kit. */
const sealsShown = { player: 0, ai: 0 };
export function syncChakra() {
  const show = isPlaying() && !match.watch;
  for (const [side, k] of [['player', 'p'], ['ai', 'a']]) {
    $('ck-' + k).style.strokeDashoffset = 100 - chakra[side] / CHAKRA.max * 100;
    $('ckbar-' + k).classList.toggle('full', chakraFull(side));
    // n: the seals it holds (lit). Spent: it already fired this point — the seals it has left stay
    // lit but dimmed (one jutsu per point), not dark: they are still there for the next point.
    const n = isPlaying() ? Math.min(sealsOf(side), SLOTS.length) : 0, kit = kitOf(side), spent = !!rally.fired[side];
    const color = i => hex(JUTSU[kit[i]].color), ring = $('ckbar-' + k).style;
    ring.setProperty('--g1', n ? color(n - 1) : ''); ring.setProperty('--g2', n ? color(n - 1) : ''); ring.setProperty('--g3', n ? color(n - 1) : '');
    const orbs = $('orbs-' + k);
    orbs.classList.toggle('full', n === SLOTS.length && !spent);
    orbs.classList.toggle('spent', spent && n > 0);
    [...orbs.children].forEach((o, i) => {
      o.style.setProperty('--c', color(i));
      o.classList.toggle('on', i < n);
      o.classList.toggle('armed', isYou(side) && armedTier() === i + 1);
      if (i < n && i >= sealsShown[side]) { o.classList.remove('new'); void o.offsetWidth; o.classList.add('new'); }
    });
    if (show && isYou(side) && n > sealsShown[side]) readyPop(kit[n - 1]);
    sealsShown[side] = n;
  }
  const sb = $('scorebug');
  sb.classList.toggle('armed', show && isArmed());
  // While armed: your kit (lit: armed; dimmed: not enough seals); tap one to switch to it.
  const menu = $('jutsu-menu');
  menu.classList.toggle('hidden', !show || !isArmed());
  if (show && isArmed()) menu.innerHTML = SLOTS.map((slot, i) => {
    const j = JUTSU[kitJutsu('player', slot)], cls = armedTier() === i + 1 ? 'on' : canFire('player', slot) ? '' : 'off';
    return `<span class="${cls}" data-tier="${i + 1}" style="--c:${hex(j.color)}">${j.name} <b>${'●'.repeat(SLOT_COST[slot])}</b></span>`;
  }).join('');
}
/** "<jutsu> ready": a new seal level is up (with a chime and a tap on the phone). */
function readyPop(id) {
  const el = $('ready-pop'), j = JUTSU[id];
  el.textContent = `${j.name} ready`;
  el.style.setProperty('--c', hex(j.color));
  el.classList.remove('hidden');
  restart(el);
  Sound.sealReady();
  buzz(15);
}
function syncFlow() {
  const tag = $('tag-flow'), side = flow.player ? 'player' : flow.ai ? 'ai' : null;
  tag.classList.toggle('hidden', !side);
  tag.classList.toggle('ai', side === 'ai');
  tag.textContent = side === 'ai' ? `${opp.short.toUpperCase()} FLOW` : 'FLOW';
  $('flow-vignette').classList.toggle('on', flow.player && !match.watch);
}
/** 2v2: only the partner whose turn it is stays solid (at the serve: server and receiver). */
export function updateGhosts() {
  for (const side of ['player', 'ai']) for (const i of [0, 1]) {
    const pre = match.state === 'serve' || match.state === 'toss';
    const on = rally.live ? rally.turn[side] === i : pre ? i === (side === match.server ? match.serverIdx : match.receiverIdx) : true;
    memberRacket(side, i).setGhost(!on);
  }
}

/** Your hand error ×: FLOW (deeper from an Awakening) and Meta Vision. */
export const yourSteady = () => (flow.player ? (flow.deep.player ? FLOW.deep.aim : FLOW.aim) : 1) * (rally.zone === 'player' ? META_STEADY : 1);

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setArmed(v) { return (armed = v); }
export function setYourKit(v) { return (yourKit = v); }
export function setAutoJutsu(v) { return (autoJutsu = v); }
