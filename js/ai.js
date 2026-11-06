// The CPU players: reading your shot, moving to it, choosing and playing their strokes, adapting.
import { clamp, rand, randn } from './util.js';
import { ADAPT, AIM, AI_COMMON, AI_LEVELS, AI_STYLES, FLOW, GAME, HIRAISHIN, JUTSU, JUTSU_AI, META_STEADY, MIRROR, PLAYER_CFG, POSSESSION, REACH, SHORT_PLAY, SIGNATURES, SIGNATURE_OF, SIG_INTENT, SLOTS, SLOT_COST, SMART, SMART_J, SMASH, SMASH_D, SPIN_D, STYLE_PATTERNS, VOID } from './config.js';
import { HALF_L, HALF_W, TABLE_TOP, handPlay, moveBody, predictIntercept, racketMinY, simulate, solveShot, strokeError } from './physics.js';
import { ai2Body, ai2Racket, aiBody, aiRacket, allyBody, allyRacket, player, playerBody } from './render/racket.js';
import { ball, decoys } from './render/ball.js';
import { DEBUG, TLOG, lr } from './log.js';
import { applyShot, intoNet, topspinOf, unreadSpin } from './strokes.js';
import { callout, canFire, chakraFull, fireJutsu, flow, idleJutsu, jutsuShot, kitOfBot, mirrorReflect, possessedStroke, sealsOf } from './jutsu.js';
import { incomingJutsu, match, nameOf, other, rally, registerHit } from './rules.js';
import { scoutPattern, scoutSignature, showMessage } from './ui/hud.js';
import { practice } from './ui/menus.js';
import { Sound } from './audio.js';
import { cameraShake, setCameraShake, simTime } from './loop.js';

/* =====================================================================
   AI — predicts the intercept, moves there at limited speed after a
   reaction delay, aims for corners with level-scaled error and mistakes.
   ===================================================================== */
/** A CPU player. 'ai' plays the far end (z < 0); when you watch a tournament match, a second
 *  one plays the near end ('player'). s is the sign of its half: the same code plays either end
 *  by mirroring Z, so "depth" below means distance from the net (s * z). */
function makeAI(owner, racket, body) {
  return { owner, racket, body, s: owner === 'ai' ? -1 : 1, level: 'easy', style: 'allround', name: '', plan: null, serveAt: 0, serveX: 0, recoverUntil: 0,
    pattern: null,        // { def, step }: this point's pattern (separate from plan, which every hit wipes)
    intent: null,         // what its next stroke will be, decided when the opponent hits (tells show it)
    serveIntent: null,    // its serve this point (a pattern's serve or a signature serve)
    lastSide: 0,          // X side of its previous shot this point ('switch')
    sigThisPoint: false, sigShown: false,
    adapt: newAdapt() };
}
/** Per-match adaptation state (see ADAPT): decayed miss weights per zone and the current target. */
export function newAdapt() { return { zoneMiss: {}, target: null, heldPoints: 0, hold: ADAPT.hold[0], rest: 0, smashUse: 0, smashWon: 0, anti: 0 }; }
export const ai = makeAI('ai', aiRacket, aiBody);
export const nearAI = makeAI('player', player, playerBody);
export const ally = makeAI('player', allyRacket, allyBody), ai2 = makeAI('ai', ai2Racket, ai2Body);
export const BOTS = [ai, nearAI, ally, ai2];

/** 2v2 (doubles, real rules): each side is two players who must hit in turn; rally.turn[side] is
 *  which of them (0 or 1) strikes that side's next ball. Member 0 of the near side is you. The
 *  serve goes diagonally, right half to right half, and rotates A1→B1, B1→A2, A2→B2, B2→A1. In 1v1
 *  every side has just member 0. */
export const DOUBLES = {
  serveMinX: 0.12,        // you serve from your right half (x > 0 at the near end)
  centre: 0.02,           // the centre line counts for both halves (m)
  waitBack: 0.5,          // a partner whose turn it isn't steps this far back...
  waitSide: 0.7,          // ...and to this side of the one who plays (m)
  rotation: [['player', 0, 'ai', 0], ['ai', 0, 'player', 1], ['player', 1, 'ai', 1], ['ai', 1, 'player', 0]],
};
/** The bot playing member i of `side`, or null when it's you. */
export const memberBot = (side, i = 0) => side === 'ai' ? (i ? ai2 : ai) : i ? ally : match.watch ? nearAI : null;
export const memberRacket = (side, i = 0) => side === 'ai' ? (i ? ai2Racket : aiRacket) : i ? allyRacket : player;
const memberBody = (side, i = 0) => side === 'ai' ? (i ? ai2Body : aiBody) : i ? allyBody : playerBody;
/** Who strikes `side`'s next ball: its bot (null = you), racket and body. */
export const turnBot = side => memberBot(side, rally.turn[side]);
export const turnRacket = side => memberRacket(side, rally.turn[side]);
const turnBody = side => memberBody(side, rally.turn[side]);
/** Is it you who plays the near side's next ball? */
export const yourTurn = () => !match.watch && rally.turn.player === 0;
export const youServe = () => !match.watch && match.server === 'player' && match.serverIdx === 0;
export const serverBot = () => memberBot(match.server, match.serverIdx);
export const serverRacket = () => memberRacket(match.server, match.serverIdx);
/** The bots in this match. */
export const activeBots = () => match.doubles ? [ai, ai2, ally] : match.watch ? [ai, nearAI] : [ai];
/** The CPU that plays `who`'s next ball, or null when it's you. */
const botFor = who => turnBot(who);
export const levelCfg = c => AI_LEVELS[c.level];
const iqOf = c => c.iq ?? levelCfg(c).iq;
/** Does bot c read jutsu `id` (JUTSU_AI.see × the jutsu's readK: how readable it is, default 1)? */
export const seesJutsu = (c, id) => Math.random() < JUTSU_AI[c.level].see * (JUTSU[id].readK ?? 1);
export const styleCfg = c => AI_STYLES[c.style];
/** Z of a point at `depth` on c's half, kept within the CPU's reach. */
const reachZ = (c, depth) => c.s * clamp(depth, -AI_COMMON.maxZ, -AI_COMMON.minZ);
const signatureOf = c => SIGNATURE_OF[c.name] || null;
/** Is c adapting to you? Only the far CPU, only when you play it. */
export const adapting = c => c === ai && !match.watch;
/** How hard c plays against your smash right now (0..1): its adaptation × its level's cap. */
const antiSmash = c => (adapting(c) ? c.adapt.anti * levelCfg(c).antiSmash : 0);
/** How readable the smash coming at it is: 1 off a low ball, 0 off one that really sat up (SMASH_D). */
const smashRead = () => (rally.smashed ? clamp((SMASH_D.clean - rally.smashH) / (SMASH_D.clean - SMASH_D.lazy), 0, 1) : 0);

export function aiOnOpponentHit(c) {
  c.plan = { readyAt: simTime + levelCfg(c).reactionMs * styleCfg(c).reaction / 1000, computed: false, nextUpdate: 0, point: null, err: null,
    speedIn: Math.hypot(ball.v.x, ball.v.y, ball.v.z), topIn: topspinOf(ball.w, ball.v),   // your ball as you struck it
    take: null, sigChecked: false,
    decoy: null };        // Shadow Clone: the decoy it chased (null: it reads the real ball)
  const jt = rally.pendingJutsu || rally.jutsu;
  if (jt && JUTSU[jt.id].decoys && jt.by !== c.owner && !seesJutsu(c, jt.id)) {
    c.plan.decoy = decoys[Math.floor(Math.random() * decoys.length)];
  }
  // Boomerang Snake: unless it reads the curl, it follows the ball out wide.
  if (jt && JUTSU[jt.id].snake && jt.by !== c.owner && !seesJutsu(c, jt.id)) {
    c.plan.err = { x: Math.sign(ball.p.x || 1) * 0.22, y: 0, z: 0 };
  }
  // A smash it saw coming (it knows you love the smash, and the ball wasn't that high): it reacts sooner.
  if (rally.smashed) {
    const save = SMASH_D.react * antiSmash(c) * smashRead();
    c.plan.readyAt = simTime + (c.plan.readyAt - simTime) * (1 - save);
  }
  // Infinite Void: the other side's domain — it reacts late. Flying Thunder God: it is there at once.
  if (rally.void && rally.void !== c.owner) c.plan.readyAt += VOID.delay;
  if (rally.warp[c.owner]) c.plan.readyAt = simTime + (c.plan.readyAt - simTime) * 0.5;
  if (rally.mirror[c.owner] === 'primed') c.plan.readyAt = simTime + (c.plan.readyAt - simTime) * 0.4;   // its mirror waits for it
  if (rally.held === c.owner) { c.plan.readyAt += POSSESSION.hold; rally.held = null; }   // still in the shadow
  // Their Yata Mirror is up: it reads it (no hard ball at it) or it goes for the bait.
  if (rally.mirror[other(c.owner)] === 'up') c.plan.mirror = seesJutsu(c, 'mirror') ? 'read' : 'bait';
  if (!c.intent) c.intent = decideIntent(c);
  TLOG.cpuPlan(c);
}

/** c has read your ball: with the seals for it (its team's) it may fire a jutsu of its kit on this
 *  stroke — decided now, so the call-out and the glowing racket warn you while the ball is still
 *  coming. It saves up for the bigger ones (a smash on a ball that sits up); a Copy Wheel only
 *  against an incoming jutsu. Not on a short ball. */
function contactJutsu(c, pt) {
  c.plan.jutsuChecked = true;
  const side = c.owner, seals = sealsOf(side);
  if (!seals || rally.fired[side] || c.s * pt.z < HALF_L - 0.1 || (c.intent && c.intent.sig)) return;
  if (match.doubles && side === 'player') return;   // your ally fills the team's chakra; you spend it
  if (match.mode === 'practice' && !practice.cpuJutsu) return;   // Practice with CPU jutsu off
  // A Samehada on it, or a Shadow Possession: if it notices, it spends now (SPEND FIRST / break it).
  const urgent = (rally.shark === other(side) || rally.bind === side) && Math.random() < JUTSU_AI[c.level].see;
  const kit = kitOfBot(c), high = pt.y - TABLE_TOP > 0.3, r = Math.random();
  let slot;
  // Sharked: its biggest jutsu (spend first). Bound: its cheapest — a jutsu only breaks the shadow (but a mirror).
  const order = rally.bind === side ? [...SLOTS].sort((a, b) => (kit[SLOTS.indexOf(b)] === 'mirror') - (kit[SLOTS.indexOf(a)] === 'mirror')) : ['smash', 'drive', 'block'];
  if (urgent) slot = order.find(k => canFire(side, k) && !idleJutsu(side, kit[SLOTS.indexOf(k)]));
  else if (Math.random() < SMART.jutsu * iqOf(c)) slot = smartJutsu(c, kit, high, seals);   // it reads the game
  else if (Math.random() >= JUTSU_AI[c.level].use) return;
  else slot = plainSlot(seals, high);
  if (!slot || !canFire(side, slot)) return;
  const id = kit[SLOTS.indexOf(slot)], j = JUTSU[id];
  if (idleJutsu(side, id)) return;   // e.g. a Copy Wheel waits for a jutsu to copy
  if (c.plan.mirror === 'read' && j.speed && j.speed[0] >= MIRROR.min) return;   // not into a mirror
  c.intent = { ...(c.intent || {}), jutsu: id, key: true, sig: null, lean: 0 };
  callout(j.kanji, j.name, !match.watch && side === 'ai' ? j.counter : '', j.color);   // aimed at your side: the counter
  Sound.seal();
}

/** A CPU's jutsu, the plain way: it saves up — with one seal it mostly waits, with more it goes bigger. */
function plainSlot(seals, high) {
  const r = Math.random();
  return seals >= 3 ? (high || r < 0.5 ? 'smash' : r < 0.8 ? 'drive' : 'block')
    : seals === 2 ? (r < 0.4 ? 'drive' : r < 0.5 ? 'block' : null)
    : r < 0.25 ? 'block' : null;
}
/** A CPU's jutsu when it reads the game (SMART.jutsu × iq): the slot it fires now, or null.
 *  On a game point either way it fires (its use chance, raised by SMART_J.clutch) and goes big;
 *  otherwise it spends like the plain CPU (hoarding for the big ones lost it points in the sim:
 *  the cheap jutsu win as many points per seal). Either way it fires what fits the moment, and
 *  swaps a jutsu that would do nothing now for one that would: Samehada only when they hold seals
 *  to eat, God Hand when the point matters, no power shot into a mirror it read (a Rasengan off a
 *  ball that sits up), Yata Mirror against someone who smashes a lot. */
function smartJutsu(c, kit, high, seals) {
  const side = c.owner, foe = other(side), use = JUTSU_AI[c.level].use;
  const clutch = Math.max(...match.points) >= GAME.pointsToWin - 1;
  if (Math.random() >= (clutch ? use + (1 - use) * SMART_J.clutch : use)) return null;
  const fit = k => {
    const id = kit[SLOTS.indexOf(k)], j = JUTSU[id];
    if (!canFire(side, k) || idleJutsu(side, id)) return 0;
    if (j.self === 'drain') return 0.5 + 0.4 * sealsOf(foe);
    if (j.self === 'hand') return clutch ? 1.6 : 0.7;
    if (j.self === 'mirror') return adapting(c) ? clamp(0.6 + 0.3 * c.adapt.smashUse, 0.6, 2) : 1;
    if (j.speed && j.speed[0] >= MIRROR.min) return c.plan.mirror === 'read' ? 0 : high ? 1.5 : 0.8;
    return 1;
  };
  const opts = SLOTS.map(k => ({ k, w: fit(k) * (clutch ? SLOT_COST[k] ** SMART_J.big : 1) })).filter(o => o.w > 0);
  if (!clutch) {   // the plain choice, unless another fits clearly better
    if (seals < 3 && !chakraFull(side) && Math.random() >= SMART_J.save) return null;   // saving up for its biggest
    const k = plainSlot(seals, high);
    if (!k) return null;
    const best = opts.reduce((a, o) => (o.w > a.w ? o : a), { k: null, w: 0 });
    return fit(k) >= 0.9 * best.w ? k : best.k;
  }
  let r = Math.random() * opts.reduce((a, o) => a + o.w, 0);
  return (opts.find(o => (r -= o.w) < 0) || {}).k || null;
}

/** This point's pattern, if it plays one (serving: patterns that start on its serve are likelier). */
function pickPattern(c, serving) {
  if (Math.random() >= levelCfg(c).pattern) return null;
  const pats = STYLE_PATTERNS[c.style].filter(p => serving || !p.needsServe);
  const weights = pats.map(p => (serving && p.needsServe ? 1.5 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  const def = pats.find((p, i) => (r -= weights[i]) < 0) || pats[0];
  return { def, step: 0 };
}

/** Set up c's point: pick a pattern and its serve (or a signature serve). Called in setupServe. */
export function aiStartPoint(c) {
  Object.assign(c, { intent: null, serveIntent: null, lastSide: 0, sigThisPoint: false, spinSeen: null });
  const serving = serverBot() === c;
  c.pattern = pickPattern(c, serving);
  if (!serving) return;
  const sigId = signatureOf(c), sg = sigId && SIGNATURES[sigId];
  if (sg && sg.when === 'serve' && Math.random() < sg.chance) {
    // Mozart: the side the racket leans to (its sidespin) · Ghost: the spin its racket face hides.
    c.serveIntent = sigId === 'mozart-serve' ? { sig: sigId, lean: Math.random() < 0.5 ? -1 : 1 }
      : { sig: sigId, hidden: Math.random() < 0.5 ? 'top' : 'back' };
    c.sigThisPoint = true;
  } else if (c.pattern && c.pattern.def.serve) {
    c.serveIntent = { ...c.pattern.def.serve };
  }
}

/** What c's next stroke will be, decided as the opponent strikes (so the tell can show it while
 *  the ball comes): its pattern's next step, then — vs you — a capped bias toward the zone where
 *  you keep missing. A signature can replace it once c has read the ball (contactSignature).
 *  The mistake roll and the smash check (aiHit) still come first. */
function decideIntent(c) {
  let intent = null;
  const p = c.pattern;
  if (p && (p.def.loop || p.step < p.def.steps.length)) {
    intent = { ...p.def.steps[p.step % p.def.steps.length], pattern: p.def.id };
  }
  const a = c.adapt;
  if (adapting(c) && a.target && Math.random() < levelCfg(c).adapt) {
    const [side, kind] = a.target.split('-');
    intent = { ...(intent || {}), side, adapt: true };
    if (kind === 'short') { intent.depth = 'short'; }
    else { intent.spin = kind === 'chop' ? 'chop' : 'top'; if (intent.depth === 'short') delete intent.depth; }
  }
  return intent;
}

/** c has read your ball and knows where it will meet it: it plays its signature now if the contact
 *  suits it (SIGNATURES.when) — decided here, so the tell shows while the ball is still coming. */
function contactSignature(c, pt) {
  const id = signatureOf(c), sg = id && SIGNATURES[id], plan = c.plan;
  plan.sigChecked = true;
  if (c.intent && c.intent.jutsu) return;   // it already called a jutsu for this stroke
  if (!sg || sg.when === 'serve' || c.sigThisPoint) return;
  const short = c.s * pt.z < HALF_L - 0.1;
  let ok = sg.when === 'short' ? short : !short;
  if (sg.when === 'high') {   // your ball sits up after its bounce: she takes it at the top
    const top = predictIntercept(ball, c.s, AI_COMMON.reachDepth, -AI_COMMON.maxZ, aiBounced(c));
    ok = !!top && top.y - TABLE_TOP > 0.26;
  }
  if (!ok || (sg.minSpeed && plan.speedIn < sg.minSpeed) || (sg.backspin && plan.topIn > -30)) return;
  if (Math.random() >= sg.chance) return;
  c.sigThisPoint = true;
  c.intent = { ...SIG_INTENT[id], sig: id, key: true };
  if (sg.when === 'high') { plan.take = 'top'; plan.nextUpdate = 0; }
}

/** The racket's tells for what c is about to do (see Racket.updateMesh). */
function aiTells(c) {
  const r = c.racket;
  const serving = (match.state === 'serve' || match.state === 'toss') && serverBot() === c;
  const it = serving ? c.serveIntent : rally.live && c.plan ? c.intent : null;   // from the moment it decides
  r.windTarget = !serving && it && (it.key || it.sig) ? 1 : 0;
  r.glowColor = it && it.jutsu ? JUTSU[it.jutsu].color : it && it.sig ? SIGNATURES[it.sig].color : null;
  r.lean = it && it.lean && (serving || it.jutsu) ? it.lean : 0;   // a sidespin serve
}

/** Bookkeeping after c played a stroke: tag it on the rally (adaptation, scouting, signature
 *  trail), advance its pattern, and scout what you just saw. */
export function noteAIShot(c, intent, tx, top, short) {
  const rel = tx * c.s;   // > 0: toward the opponent's backhand side
  const zone = `${rel > 0.25 ? 'bh' : rel < -0.25 ? 'fh' : 'mid'}-${short ? 'short' : top < 0 ? 'chop' : 'drive'}`;
  const it = intent || {};
  rally.botShot = { by: c.owner, zone, sig: it.sig || null, lean: it.lean || 0, hidden: it.hidden || null };
  rally.answering = null;
  c.lastSide = Math.sign(tx) || 1;
  c.intent = null;
  if (it.pattern && c.pattern && c.pattern.def.id === it.pattern) {
    c.pattern.step++;
    if (it.key) scoutPattern(c, c.pattern.def);
    if (!c.pattern.def.loop && c.pattern.step >= c.pattern.def.steps.length) c.pattern = null;
  }
  if (it.sig) scoutSignature(c, it.sig);
}

/** Predict the intercept and add this shot's positioning error. Re-run a few times per second
 *  while the ball is incoming (net clips change the path); the error is rolled once per shot
 *  so the racket doesn't jitter. */
function computeAIPlan(c) {
  const cfg = levelCfg(c), plan = c.plan;
  plan.computed = true;
  plan.nextUpdate = simTime + 0.15;
  if (!plan.err) {
    // Positioning error grows with the incoming spin and shrinks with level.
    const spin = Math.hypot(ball.w.x, ball.w.y, ball.w.z);
    const e = cfg.aimError * 0.22 * (1 + spin / 120);
    plan.err = { x: randn() * e, y: randn() * e * 0.5, z: randn() * e * 0.6 };
  }
  const p = aiIntercept(c, plan.take || styleCfg(c).take, plan.decoy && plan.decoy.b ? plan.decoy.b : ball);
  if (!p) return;   // out / net ball, or already past its bounce: keep the last plan
  plan.point = {
    x: clamp(p.x + plan.err.x, AI_COMMON.minX, AI_COMMON.maxX),
    y: clamp(p.y + plan.err.y, TABLE_TOP + 0.05, 1.8),
    z: reachZ(c, c.s * p.z + plan.err.z),
  };
  if (!plan.jutsuChecked) contactJutsu(c, p);
  if (!plan.sigChecked) contactSignature(c, p);
}

/** Where the CPU meets the ball, by style: at the top of the bounce ('top'), early on the rise
 *  ('rise', a blocker) or late and deep as it drops ('drop', a defender's chop). */
/** Has the ball already bounced on c's half (a re-plan after it: the next bounce is its second)? */
const aiBounced = c => rally.serveStage === 0 && rally.lastHitter !== c.owner && rally.bounceCount >= 1;
function aiIntercept(c, take, b0 = ball) {
  let bounced = aiBounced(c);
  if (take === 'top') return predictIntercept(b0, c.s, AI_COMMON.reachDepth, -AI_COMMON.maxZ, bounced);
  return simulate(b0, 3, (b, ev, t) => {
    if (ev.floor) return null;
    const pt = { x: b.p.x, y: b.p.y, z: b.p.z, t };
    if (ev.table) {
      if (!bounced) { if (c.s * ev.table.z > 0) bounced = true; return undefined; }
      return pt;                                    // second bounce: take it before it drops
    }
    const depth = c.s * b.p.z;
    if (!bounced || depth < -AI_COMMON.maxZ) return undefined;
    const h = b.p.y - TABLE_TOP;
    if (take === 'rise') return h > 0.13 || b.v.y <= 0 || depth >= AI_COMMON.reachDepth ? pt : undefined;
    return (b.v.y <= 0 && h < 0.2) || depth >= -AI_COMMON.minZ - 0.05 ? pt : undefined;
  });
}

export function updateAI(c, dt) {
  const cfg = levelCfg(c), r = c.racket;
  if (rally.stop && rally.stop.side === c.owner) return r.integrateVelocity(dt);   // Time Stop: frozen with the ball
  // You smash a lot (antiSmash): it waits deeper.
  const homeZ = c.s * (-AI_COMMON.home.z + styleCfg(c).depth + SMASH_D.antiBack * antiSmash(c));
  let goal = { x: ball.p.x * 0.3, y: AI_COMMON.home.y, z: homeZ };   // drift home, shading the ball
  const pre = match.state === 'serve' || match.state === 'toss';
  if (pre && serverBot() === c) {
    goal = { x: c.serveX, y: 0.88, z: -c.s * AI_COMMON.serveZ };
  } else if (match.doubles && pre) {   // the receiver waits on its right half, partners behind on the left
    const recv = match.server !== c.owner && memberBot(c.owner, match.receiverIdx) === c;
    goal = recv ? { x: c.s * 0.4, y: AI_COMMON.home.y, z: homeZ } : { x: -c.s * 0.55, y: AI_COMMON.home.y, z: homeZ + c.s * DOUBLES.waitBack };
  } else if (match.doubles && turnBot(c.owner) !== c) {   // not its ball: clear out, behind and beside the partner
    const mate = turnRacket(c.owner);
    goal = { x: clamp(-(Math.sign(mate.pos.x) || 1) * DOUBLES.waitSide + mate.pos.x * 0.3, -1.2, 1.2), y: AI_COMMON.home.y, z: homeZ + c.s * DOUBLES.waitBack };
  } else if (c.plan) {
    if (simTime >= c.plan.readyAt && (!c.plan.computed || simTime >= c.plan.nextUpdate)) computeAIPlan(c);
    if (!c.plan.computed) goal = r.pos;                     // still reacting
    else if (c.plan.point) goal = c.plan.point;
    else goal = { x: ball.p.x * 0.5, y: AI_COMMON.home.y, z: homeZ };
  }
  // Feet run toward the goal with the level's speed and acceleration (they stop during the
  // follow-through after a hit); the arm moves the racket quickly within reach of the body.
  const body = c.body, recovering = simTime < c.recoverUntil;
  const bodyZ = c.s * Math.max(c.s * (recovering ? body.z : goal.z), HALF_L + REACH.bodyBehind);
  const voided = (rally.live && rally.void && rally.void !== c.owner ? VOID.speed : 1)   // inside the other side's Infinite Void
    * (rally.live && rally.warp[c.owner] ? HIRAISHIN.speed : 1);                          // Flying Thunder God
  moveBody(body, recovering ? body.x : goal.x, bodyZ, cfg.speed * voided, cfg.accel * voided, dt);
  const ax = clamp(goal.x, body.x - REACH.armX, body.x + REACH.armX) - r.pos.x;
  const az = clamp(goal.z, body.z - REACH.armZ, body.z + REACH.armZ) - r.pos.z, d = Math.hypot(ax, az);
  if (d > 1e-4 && !(match.state === 'toss' && serverBot() === c)) {
    const step = Math.min(d, AI_COMMON.armSpeed * dt);
    r.pos.x += ax / d * step; r.pos.z += az / d * step;
  }
  const dy = Math.max(goal.y, racketMinY(goal.x, goal.z)) - r.pos.y;
  r.pos.y += clamp(dy, -AI_COMMON.ySpeed * dt, AI_COMMON.ySpeed * dt);
  r.pos.z = reachZ(c, c.s * r.pos.z);
  r.pos.y = Math.max(r.pos.y, racketMinY(r.pos.x, r.pos.z));
  r.integrateVelocity(dt);
  aiTells(c);
}

export function aiHit(c) {
  const cfg = levelCfg(c), st = styleCfg(c), r = c.racket, body = c.body;
  const toward = -c.s;   // the opponent's half: target depths below are converted with it
  // Its Yata Mirror, primed: it reflects. Bound by a Shadow Possession: the stroke is theirs,
  // unless it fires the jutsu it planned (chakra breaks the shadow).
  if (rally.mirror[c.owner] === 'primed') return mirrorReflect(c.owner, c);
  if (rally.bind === c.owner) {
    const it0 = c.intent, breaks = it0 && it0.jutsu && c.s * ball.p.z >= HALF_L - 0.1 && canFire(c.owner, SLOTS[kitOfBot(c).indexOf(it0.jutsu)]);
    if (!breaks) return possessedStroke(c.owner, c);
  }
  const speedIn = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
  const spinIn = Math.hypot(ball.w.x, ball.w.y, ball.w.z);
  // Fast or spinny balls, and being stretched (racket far from the body, or still running),
  // raise the chance of an error and take pace off the return.
  const stretch = rally.warp[c.owner] ? 0 : clamp(Math.hypot((r.pos.x - body.x) / REACH.armX, (r.pos.z - body.z) / REACH.armZ) - 0.6, 0, 0.6)
    + clamp(Math.hypot(body.vx, body.vz) / cfg.speed - 0.5, 0, 0.5);   // (Flying Thunder God: never)
  const pressure = clamp((speedIn - 6) / 8, 0, 1) * 0.6 + clamp(spinIn / 250, 0, 0.6) + stretch;
  // A jutsu coming at it: one that wants an answer must get it (a Copy Wheel of its own cancels
  // it); any jutsu rattles it a little.
  const jIn = incomingJutsu(c.owner), ja = JUTSU_AI[c.level];
  const copy = c.intent && c.intent.jutsu && JUTSU[c.intent.jutsu].self === 'copy';
  if (jIn && JUTSU[jIn].answer && !copy) return aiAnswerJutsu(c, JUTSU[jIn].answer, JUTSU[jIn].answerK ?? 1);
  const calm = flow[c.owner] ? (flow.deep[c.owner] ? FLOW.deep.mistake : FLOW.mistake) : 1;
  const steady = rally.zone === c.owner ? META_STEADY : 1;   // Meta Vision: fewer errors this point
  const voidErr = rally.void && rally.void !== c.owner ? VOID.err : 0;   // inside their Infinite Void: lost
  const mistake = Math.random() < (cfg.mistakeRate * st.mistake * (1 + pressure * 1.5) * calm + (jIn && !copy ? ja.rattle : 0) + voidErr) * steady;
  // Its plan for this stroke (pattern step, signature, jutsu, adaptive bias — see decideIntent).
  let it = c.intent || {};
  // A ball met over the table (a short ball) leaves no room to swing: a push, a flick or a drop.
  const overTable = c.s * ball.p.z < HALF_L - 0.1;
  const payable = it.jutsu && canFire(c.owner, SLOTS[kitOfBot(c).indexOf(it.jutsu)]);   // (it may have spent them since)
  if (payable && !overTable) return aiJutsu(c, it);   // chakra-guided: no mistake
  if (it.jutsu) it = { ...it, jutsu: null };              // the contact changed: it keeps its chakra
  // Their Yata Mirror: it went for the bait (smashes it), or it read it (nothing hard at it).
  const mir = c.plan && c.plan.mirror, hBall = ball.p.y - TABLE_TOP;
  if (mir === 'bait' && !mistake && hBall > 0.22 && Math.random() < MIRROR.fall) { TLOG.note({ why: 'mirror-bait' }); return aiSmash(c, speedIn); }
  // Its Shadow Possession floated this one up: the combo.
  if (rally.combo === c.owner && hBall > 0.25 && Math.random() < POSSESSION.combo[c.level]) return aiSmash(c, speedIn, POSSESSION.aim);
  if (mir === 'read' && (it.sig === 'chorei-counter' || it.sig === 'hayabusa')) it = { ...it, sig: null };
  // A ball that sits up (high and slow) invites a smash; the higher, the more likely.
  const sitsUp = clamp((ball.p.y - TABLE_TOP - AI_COMMON.smashHeight) / AI_COMMON.smashFull, 0, 1);
  TLOG.note({ sitsUp: lr(sitsUp), smashChance: speedIn < AI_COMMON.smashSlow ? lr(Math.min(1, cfg.smash * st.smash) * sitsUp) : 0 });
  if (!mistake && mir !== 'read' && speedIn < AI_COMMON.smashSlow && Math.random() < Math.min(1, cfg.smash * st.smash) * sitsUp) return aiSmash(c, speedIn);
  const when = it.sig && SIGNATURES[it.sig].when;
  if (when && when !== 'high' && (when === 'short') !== overTable) it = { ...it, sig: null };   // the contact changed
  if (overTable && it.sig !== 'hayabusa') return aiShortBall(c, it, mistake);   // (a ball high over the table can be hit)
  // Your smash: once it has adapted to you, it may meet it with a counter-block.
  const anti = antiSmash(c);
  if (rally.smashed && !mistake && !it.sig && mir !== 'read' && Math.random() < cfg.counter * anti * smashRead()) return aiCounterBlock(c, speedIn, it);
  const pace = it.pace || 1;
  const power = cfg.power * st.power;
  const sideSign = aiSide(c, it);
  let tx = sideSign * Math.min(0.68, 0.62 * st.wide) * (1 - cfg.aimError) + rand(-1, 1) * cfg.aimError * 0.6;   // corners
  if (it.side === 'mid') tx = aiBodyX(c);
  // Sidespin on the incoming ball (a brush, SPIN) kicks its return off the racket toward the side
  // the ball curved to; better players compensate more.
  const curveIn = clamp(ball.w.y * Math.sign(ball.v.z) / 60, -1, 1);
  if (curveIn) tx = clamp(tx + curveIn * 0.12 * (0.4 + cfg.aimError * 5), -0.74, 0.74);
  let tz = it.depth === 'long' ? clamp(1.12 + rand(-1, 1) * cfg.aimError * 0.4, 1.0, 1.27)
    : clamp(0.75 + power * 0.4 + rand(-1, 1) * cfg.aimError * 0.5, 0.45, 1.27);
  let vh = (3.4 + power * 4.5 + Math.random() * 0.6) * (1 - stretch * 0.35) * pace;
  // Topspin drives, sometimes a slower chop (heavy backspin: push it back) — how often depends on
  // the style, or on the plan. Better players spin harder.
  const chop = it.spin ? it.spin === 'chop' || it.spin === 'float' : Math.random() < st.chop + SMASH_D.chop * anti;   // vs a smasher: more backspin
  let top = chop ? -rand(0.55, 1) * (90 + 110 * cfg.spin) * st.chopSpin : rand(0.5, 1) * (50 + 130 * cfg.spin) * st.top;
  let shownTop = top;   // what the racket face shows: a float or a reversal looks just like a chop
  if (it.spin === 'top') top = rand(0.8, 1) * (50 + 130 * cfg.spin) * Math.max(st.top, 1);
  if (it.spin === 'flat') top = rand(15, 35);
  if (it.spin === 'float') top = -rand(5, 15);   // ...but carries almost no spin
  if (chop) { vh *= 0.8; tz = Math.max(tz, 0.95); }   // chops are slow and deep
  let side = rand(-1, 1) * cfg.spin * 40 * st.side, maxArc = AI_COMMON.maxArc - SMASH_D.lowArc * anti;   // ...and lower
  // Your spin (SPIN_D): a topspin stroke against backspin has to lift it — slower, higher — and a
  // spin it misread (or just too heavy) can still beat it. Its own chop copes with either.
  const sr = spinRead(c), backIn = Math.max(0, -sr.top);
  const lift = chop ? 0 : clamp((backIn - SPIN_D.top.tol) / SPIN_D.top.span, 0, 1);
  if (lift) { vh *= 1 - SPIN_D.slow * lift; maxArc += SPIN_D.arc * lift; }
  const spun = mistake || it.sig ? null : spinMiss(sr, chop, st.spinErr);
  // Signatures: the stroke itself (see SIGNATURES; their effect on your return: sigReturn).
  const sig = mistake ? null : it.sig;
  if (sig === 'phantom-chop') { top = -rand(0.92, 1) * (300 + 60 * cfg.spin); vh = rand(6.2, 6.8); maxArc = 0.3; }   // low, deep, dead
  if (sig === 'chorei-counter') { top = rand(90, 120); vh = rand(13, 14.5); }
  if (sig === 'dragon-loop') { top = rand(250, 290); vh = rand(10.5, 11.5); tz = rand(1.12, 1.25); }
  if (sig === 'hayabusa') { top = rand(30, 50); vh = rand(13.5, 15); }
  if (sig === 'pimple-reversal') { top = clamp(-(c.plan ? c.plan.topIn : -100) * 1.15, 110, 220); vh = rand(6.5, 7.2); }   // your backspin, turned
  if (sig === 'pimple-reversal' || it.spin === 'float') shownTop = -rand(0.55, 1) * (90 + 110 * cfg.spin) * st.chopSpin;
  else if (sig) shownTop = top;
  // A short drop shot, just over the net (only if the opponent can reach it before its second bounce).
  if (!mistake && !sig && (it.depth === 'short' || (!it.depth && Math.random() < st.short + SMASH_D.short * anti + dropBias(c)))) {
    const drop = solveShot(ball.p, { x: tx * 0.7, z: toward * rand(0.5, 0.7) }, vh * 0.6, top * 0.5, side);
    if (opponentCanReach(c, drop)) {
      TLOG.note({ kind: 'drop', stretch: lr(stretch) });
      aiPlay(c, drop, it.spin === 'float' ? shownTop * 0.5 : top * 0.5, 0.3);
      return noteAIShot(c, it, tx * 0.7, top * 0.5, true);
    }
  }

  if (spun && c.owner === 'ai') match.stats.spinWins++;
  if (spun && !match.watch && c.owner === 'ai') showMessage('Spin!', spun === 'net' ? 'it dragged your backspin into the net' : spun === 'long' ? 'your topspin kicked it long' : 'your sidespin pulled it wide', 'good', 0.9);
  const kind = spun ? spun : mistake ? (Math.random() < 0.4 ? 'long' : Math.random() < 0.5 ? 'wide' : 'net') : null;
  if (kind === 'long') tz = HALF_L + rand(0.08, 0.38);
  if (kind === 'wide') tx = sideSign * (HALF_W + rand(0.08, 0.28));
  TLOG.note({ kind: chop ? 'chop' : 'drive', err: kind, spinErr: spun, mistake: mistake ? 1 : 0, reads: sr.offTop === 0 && sr.offSide === 0 ? 1 : 0,
    offTop: Math.round(sr.offTop), offSide: Math.round(sr.offSide), lift: lr(lift), stretch: lr(stretch), pressure: lr(pressure), sig: sig || null,
    plan: it.depth || it.spin || it.side ? [it.depth || '', it.spin || '', it.side || ''].join('/') : null });
  const target = { x: tx, z: toward * tz };   // (a mistake is played as it comes: long, wide or netted)
  const shot = kind ? solveShot(ball.p, target, vh, top, side) : aimAI(c, target, vh, top, side, maxArc, !!sig);
  if (kind === 'net') intoNet(shot);
  aiPlay(c, shot, shownTop, sig ? 1 : 0.4 + power * 0.5);
  noteAIShot(c, { ...it, sig }, tx, top, false);   // a missed signature isn't one
}

/** The spin on the ball c is about to play, and what c makes of it (SPIN_D): actual topspin (+) /
 *  backspin (−) and sidespin, and the part it misread — none if it reads your racket, else the gap
 *  to the spin of the last ball it played. Remembers this ball's spin for the next one. */
function spinRead(c) {
  const w = unreadSpin(), top = topspinOf(w, ball.v), side = w.y * Math.sign(ball.v.z || 1);   // the stroke's spin, what is left of it
  const seen = c.spinSeen || { top: 0, side: 0 }, reads = Math.random() < SPIN_D.read[c.level];
  c.spinSeen = { top, side };
  if (DEBUG.on) DEBUG.log.push({ spin: 1, top: Math.round(top), side: Math.round(side), reads });
  return { top, side, offTop: reads ? 0 : top - seen.top, offSide: reads ? 0 : side - seen.side };
}
/** Does the spin beat c's stroke (chop: it takes topspin and backspin alike; k: its style's
 *  spinErr)? 'long' / 'net' / 'wide', or null. */
function spinMiss(sr, chop, k = 1) {
  const T = SPIN_D.top, S = SPIN_D.side, f = (v, a) => clamp((Math.abs(v) - a.tol) / a.span, 0, 1);
  const hv = (v, h) => clamp((Math.abs(v) - h) / SPIN_D.heavySpan, 0, 1);
  const pTop = chop ? 0 : (SPIN_D.err * f(sr.offTop, T) + SPIN_D.heavyErr * hv(sr.top, T.heavy)) * k;
  const pSide = (SPIN_D.err * f(sr.offSide, S) + SPIN_D.heavyErr * hv(sr.side, S.heavy)) * k;
  const r = Math.random();
  if (r < pTop) return (chop ? 0 : sr.offTop || sr.top) > 0 ? 'long' : 'net';
  if (r < pTop + pSide) return 'wide';
  return null;
}

/** Counter-block of a smash: no swing, the racket just meets it and sends its pace back — flat,
 *  low and fast to the corner away from the smasher's racket, while they are still finishing
 *  the smash (SMASH_D.block). */
function aiCounterBlock(c, speedIn, it) {
  const cfg = levelCfg(c), toward = -c.s, B = SMASH_D.block;
  const opp = turnRacket(other(c.owner));
  const open = Math.abs(opp.pos.x) > 0.08 ? -Math.sign(opp.pos.x) : Math.random() < 0.5 ? -1 : 1;
  const tx = open * rand(0.42, 0.64) * (1 - cfg.aimError) + rand(-1, 1) * cfg.aimError * 0.5;
  const tz = toward * rand(0.95, 1.2);
  const top = rand(...B.top);
  const shot = aimAI(c, { x: tx, z: tz }, clamp(speedIn * B.pace, B.min, B.max), top, 0, AI_COMMON.maxArc - SMASH_D.lowArc, true);
  TLOG.note({ kind: 'counterblock' });
  aiPlay(c, shot, top, 0.8);
  noteAIShot(c, { ...it, sig: null }, tx, top, false);
}

/** A jutsu coming at c that wants `need` ('block' / 'push'): it answers right (JUTSU_AI.block) — a
 *  soft block that sits up, or a low push — or it flies long / dies in the net. */
function aiAnswerJutsu(c, need, k = 1) {
  const toward = -c.s, ok = Math.random() < JUTSU_AI[c.level].block * k, tx = rand(-0.45, 0.45);
  let shot;
  if (ok) {
    const push = need === 'push', tgt = { x: tx, z: toward * rand(0.85, 1.1) };
    shot = solveShot(ball.p, tgt, push ? 4.6 : 5.2, push ? -110 : 30, 0);
    if (!landsFor(c, shot)) shot = solveShot(ball.p, tgt, 3.6, 0, 0);
  } else if (need === 'push') {
    shot = intoNet(solveShot(ball.p, { x: tx, z: toward * 1.0 }, 6, 40, 0));
  } else {
    shot = solveShot(ball.p, { x: tx, z: toward * (HALF_L + rand(0.15, 0.45)) }, 9, 70, 0);
  }
  TLOG.note({ kind: 'answer-' + need, ok: ok ? 1 : 0 });
  aiPlay(c, shot, ok && need === 'push' ? -110 : 0, 0.5);
  noteAIShot(c, null, tx, 20, false);
}

/** c fires the jutsu it decided on (contactJutsu): its own shot (jutsuShot) or, for decoys and the
 *  self jutsu, a clean drive. Chakra-guided: it lands, no mistake. */
function aiJutsu(c, it) {
  const cfg = levelCfg(c), toward = -c.s, id = it.jutsu, j = JUTSU[id];
  let js = jutsuShot(id, c.owner, it.lean || 0);
  const fizzle = !!(js && js.fizzle);
  if (!js || !js.shot) {
    const tx = aiSide(c, it) * rand(0.3, 0.6), top = rand(60, 100);
    js = { shot: aimAI(c, { x: tx, z: toward * rand(0.9, 1.2) }, 3.4 + cfg.power * 4.5, top, 0, AI_COMMON.maxArc, true), tx, top };
  }
  if (j.speed && j.speed[0] > 14 && !fizzle) setCameraShake(SMASH.shake * 1.5);
  fireJutsu(c.owner, id, it.lean || 0, fizzle);
  TLOG.note({ kind: 'jutsu', jutsu: id });
  aiPlay(c, js.shot, js.top, 1.2);
  noteAIShot(c, { ...it, sig: null }, js.tx, js.top, false);
}

/** Which side c aims at: its plan's choice (the opponent's backhand is on c.s's side), else a coin flip. */
function aiSide(c, it) {
  const oppRacket = turnRacket(other(c.owner));   // whoever plays the next ball over there
  if (!it.side && Math.random() < SMART.open * iqOf(c)) {   // no plan: it plays the situation (SMART)
    const run = turnBody(other(c.owner)).vx;
    if (Math.abs(run) > SMART.wrongFoot) return -Math.sign(run);           // wrong-foot: back where they came from
    if (Math.abs(oppRacket.pos.x) > 0.1) return -Math.sign(oppRacket.pos.x);   // the open side
  }
  return it.side === 'bh' ? c.s : it.side === 'fh' ? -c.s
    : it.side === 'switch' && c.lastSide ? -c.lastSide
    : it.side === 'open' && Math.abs(oppRacket.pos.x) > 0.1 ? -Math.sign(oppRacket.pos.x)
    : Math.random() < 0.5 ? -1 : 1;
}
/** Extra drop-shot share (SMART.drop × iq): more when the one who plays the next ball stands deep,
 *  less when they're up at the table. */
function dropBias(c) {
  const back = Math.abs(turnBody(other(c.owner)).z) - HALF_L;
  return SMART.drop * iqOf(c) * clamp((back - SMART.deep) / SMART.span, -1, 1);
}
/** Aim straight at the opponent's body (hard to get out of the way of). */
function aiBodyX(c) {
  const oppBody = turnBody(other(c.owner));
  return clamp(oppBody.x, -0.4, 0.4) + rand(-1, 1) * levelCfg(c).aimError * 0.6;
}
/** Can the opponent reach this (short) shot before its second bounce? */
function opponentCanReach(c, shot) {
  const toward = -c.s;
  if (!shot.land || shot.land.net) return false;
  const meet = landsFor(c, shot) && predictIntercept({ p: { ...ball.p }, v: shot.v, w: shot.w }, toward, 2.5, PLAYER_CFG.minZ);
  return !!meet && toward * meet.z >= PLAYER_CFG.minZ - 0.02;
}

/** Highest point of a shot above the table before its first bounce (m). */
export function arcOf(shot) {
  let h = 0;
  simulate({ p: { ...ball.p }, v: { ...shot.v }, w: { ...shot.w } }, 1.5, (b, ev) => {
    if (ev.table || ev.floor) return true;
    h = Math.max(h, b.p.y - TABLE_TOP);
  });
  return h;
}

/** Solve a CPU stroke: off the net (slower, if the pace can't clear it) and never a lob — a ball
 *  that would float higher than maxArc is hit harder instead (a slow ball from deep, or a stretched
 *  stroke, would otherwise loop up and sit there for a smash). fine: smaller pace steps (a
 *  signature finds the fastest pace that still lands). */
function aimAI(c, target, vh, top, side, maxArc, fine = false) {
  // The ceiling counts from where it meets the ball: a ball met high would otherwise be "too high"
  // already and be hit harder and harder — a 9 m/s drive became a 16 m/s smash with none of a
  // smash's risk (real play, ?log: most of the drives you couldn't reach came off your sidespin).
  maxArc = Math.max(maxArc, ball.p.y - TABLE_TOP + AI_COMMON.arcOver);
  let shot = solveShot(ball.p, target, vh, top, side);
  for (let i = 0; i < (fine ? 12 : 5) && !landsFor(c, shot); i++) {
    vh *= fine ? 0.95 : 0.88;
    shot = solveShot(ball.p, target, vh, top, side);
  }
  for (let i = 0; i < 6 && maxArc < Infinity && landsFor(c, shot) && arcOf(shot) > maxArc; i++) {
    const next = solveShot(ball.p, target, vh * 1.1, top, side);
    if (!landsFor(c, next)) break;
    vh *= 1.1; shot = next;
  }
  return shot;
}
/** Does c's solved shot clear the net and land on the opponent's half? (Too fast a pace for the
 *  contact can't — the solver then returns a ball driven into c's own half.) */
const landsFor = (c, shot) => !!shot.land && shot.land.table && !shot.land.net && c.s * shot.land.z < 0;
function aiShortBall(c, it, mistake) {
  const cfg = levelCfg(c), st = styleCfg(c), toward = -c.s;
  const sig = mistake ? null : it.sig;
  const kind = sig === 'chiquita' ? 'chiquita'
    : it.depth === 'short' || (!it.depth && Math.random() < st.short * 2) ? 'drop'
    : it.spin === 'top' || (!it.spin && Math.random() < st.flick) ? 'flick' : 'push';
  const sp = SHORT_PLAY[kind], sideSign = aiSide(c, it);
  let tx = it.side === 'mid' ? aiBodyX(c) : sideSign * rand(0.3, 0.6) * (kind === 'drop' ? 0.7 : 1) + rand(-1, 1) * cfg.aimError * 0.5;
  let tz = rand(...sp.depth) + rand(-1, 1) * cfg.aimError * 0.3;
  let top = kind === 'flick' || kind === 'chiquita' ? rand(0.8, 1.1) * (60 + 40 * cfg.spin) * st.top
    : -rand(0.8, 1.1) * (70 + 80 * cfg.spin) * st.chopSpin;
  if (it.spin === 'float') top = -rand(5, 15);
  let side = rand(-1, 1) * cfg.spin * 25 * st.side, lean = 0;
  if (kind === 'chiquita') {   // curves away toward the backhand corner
    lean = sideSign; side = -c.s * sideSign * rand(...sp.side); tx = sideSign * rand(0.25, 0.4);
  }
  let time = rand(...sp.time);
  // Mistakes over the table: into the net, long, or a pop-up that sits up for you.
  const miss = mistake ? (Math.random() < 0.35 ? 'net' : Math.random() < 0.5 ? 'long' : 'high') : null;
  if (miss === 'long') { tz = HALF_L + rand(0.06, 0.3); time *= 0.9; }
  if (miss === 'high') time = rand(0.55, 0.65);
  const tgt = { x: tx, z: toward * tz };
  const vh = Math.hypot(tgt.x - ball.p.x, tgt.z - ball.p.z) / time;
  let shot = solveShot(ball.p, tgt, vh, top, side);
  for (let i = 0; !miss && i < 5 && !landsFor(c, shot); i++) shot = solveShot(ball.p, tgt, Math.hypot(tgt.x - ball.p.x, tgt.z - ball.p.z) / (time *= 1.06), top, side);
  if (kind === 'drop' && !miss && !opponentCanReach(c, shot)) return aiShortBall(c, { ...it, depth: 'long' }, false);
  if (miss === 'net') intoNet(shot);
  const shown = it.spin === 'float' ? -rand(0.55, 1) * 100 : top;
  TLOG.note({ kind: 'short-' + kind, err: miss, mistake: mistake ? 1 : 0 });
  aiPlay(c, shot, shown, sig ? 1 : kind === 'flick' ? 0.6 : 0.3);
  noteAIShot(c, { ...it, sig, lean }, tx, top, kind === 'drop');
}
export function aiPlay(c, shot, top, intensity) {
  applyShot(shot);
  c.racket.tilt = clamp(top / 140, -1, 1);
  c.racket.swing = 1;
  c.recoverUntil = simTime + AI_COMMON.recovery;
  if (match.watch) trackFastest(shot);
  registerHit(c.owner, intensity);
}
/** Record a shot's pace for the end-of-match stats; returns it in km/h. */
function trackFastest(shot) {
  const kmh = Math.hypot(shot.v.x, shot.v.y, shot.v.z) * 3.6;
  match.stats.fastest = Math.max(match.stats.fastest, kmh);
  return kmh;
}

/** CPU smash on a ball that sits up: flat and fast (same pace as the player's), into a corner,
 *  played with the same hand error as the player's smash (scaled by level) — so it can miss too.
 *  Stepping back and blocking can return it. */
function aiSmash(c, speedIn, errK = 1) {
  const cfg = levelCfg(c), toward = -c.s;
  let vh = rand(SMASH.minSpeed, SMASH.maxSpeed);
  const tx = (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.62), tz = toward * rand(0.9, 1.25);
  let shot = solveShot(ball.p, { x: tx, z: tz }, vh, SMASH.topspin, 0);
  if (shot.land && shot.land.net) {
    vh *= 0.85;
    shot = solveShot(ball.p, { x: tx, z: tz }, vh, SMASH.topspin, 0);
  }
  const sr = spinRead(c), spinLift = sr.offTop + sr.top * 0.3;   // spin it misread (and some of any heavy spin) lifts / drags it
  const err = strokeError(AIM.smash * cfg.smashError * errK, speedIn, ball.p.y - TABLE_TOP, 0, spinLift, AIM.smashLow);
  shot = handPlay(ball.p, shot, err);
  TLOG.note({ kind: 'smash', err: lr(err.pitch), errBias: lr(err.bias), offTop: Math.round(sr.offTop) });
  applyShot(shot);
  c.racket.tilt = 0.6;
  c.racket.swing = 1;
  c.recoverUntil = simTime + AI_COMMON.recovery * 1.5;
  match.stats[c.owner === 'ai' ? 'cpuSmashes' : 'smashes']++;
  const kmh = match.watch ? trackFastest(shot) : Math.hypot(shot.v.x, shot.v.y, shot.v.z) * 3.6;
  showMessage('SMASH!', `${match.watch ? nameOf(c.owner) + ' · ' : ''}${Math.round(kmh)} km/h`, match.watch ? 'warn' : 'bad', 0.9, 2);
  Sound.smash();
  rally.smashH = ball.p.y - TABLE_TOP;
  registerHit(c.owner, 1.2, true);
  noteAIShot(c, null, tx, SMASH.topspin, false);   // a smash replaces the planned stroke (the pattern waits)
}
