// Match state and the rules: serves, faults, lets, scoring, games; the time scale.
import { clamp, rand } from './util.js';
import { ADAPT, AI_COMMON, AI_LEVELS, AI_STYLES, BARRIER, CHAKRA, COLORS, GAME, JUTSU, META_SLOW, PLAYER_CFG, ROUND_NAMES, SIGNATURES, TIERS } from './config.js';
import { HALF_L, HALF_W, TABLE_TOP, predictBounce, predictIntercept } from './physics.js';
import { setBoardText } from './render/table.js';
import { VENUE_OF_TIER, crowdReact, drawBanners, drawScreens, setAttendance, setCrowdColors, setVenue, startWave, venueFor } from './render/venues.js';
import { ai2Body, ai2Racket, aiBody, aiRacket, allyBody, allyRacket, placeBody, player, playerBody } from './render/racket.js';
import { FX_TEX, ball, fxBurst, fxSprite, marker, serveZone, setBall } from './render/ball.js';
import { input } from './input.js';
import { TLOG } from './log.js';
import { pendingUpgrade, setPendingUpgrade } from './strokes.js';
import { BOTS, DOUBLES, activeBots, adapting, ai, aiOnOpponentHit, aiStartPoint, nearAI, newAdapt, serverBot, serverRacket, turnBot, turnRacket, yourTurn } from './ai.js';
import { armed, chakra, clearDecoys, drainSeals, gainChakra, godHandSave, mirrorCheck, moveRank, resetJutsu, setArmed, startJutsu, strokeLanded, syncChakra, updateFlow } from './jutsu.js';
import { $, beatSignature, hideAllMenus, pointSituation, showMessage, updateHUD } from './ui/hud.js';
import { practice, showEndMenu, syncFastForward, syncPauseButton } from './ui/menus.js';
import { hex, tour, tourRecordResult, tourRecordWatched } from './tournament.js';
import { Sound } from './audio.js';
import { simTime } from './loop.js';

/* =====================================================================
   RULES — serves, faults, lets, scoring, serve rotation, games, match
   ===================================================================== */
export const match = {
  levelKey: 'easy',
  styleKey: 'allround',
  speedKey: 'real',
  mode: 'quick',          // quick | duo (2v2) | tour
  doubles: false,         // 2v2: two players a side, hitting in turn (see DOUBLES)
  serverIdx: 0, receiverIdx: 0,   // which member serves / receives (2v2; always 0 in 1v1)
  watch: null,            // { r, i } while watching tournament match i of round r (CPU vs CPU)
  gamesToWin: 2,          // best of 3 (the tournament final is best of 5)
  gameScores: [],         // finished games, e.g. ['11-7', '9-11']
  state: 'menu',          // menu | serve | toss | rally | pointOver | matchOver
  toss: null,             // { who, charge, strikeY } while the serve toss is in the air
  paused: false,
  points: [0, 0],         // [player, ai]
  games: [0, 0],
  gameStarter: 'player',  // who serves first in the current game
  server: 'player',
  rallyCount: 0,
  timer: 0, after: null,  // delayed transition
  stats: null,
};
export const rally = { live: false, serveStage: 0, lastHitter: null, bounceCount: 0, netTouched: false, lastHitTime: 0,
  smashed: false, smashH: 0, yourSmashes: 0,
  shotW: { x: 0, y: 0, z: 0 }, shotBounces: 0,   // spin the last stroke put on the ball, table bounces since
  expectY: 0.92,                                  // height the player's racket waits at before the bounce
  botShot: null,      // the CPU's last stroke: { by, zone, sig, lean } (adaptation, scouting, signature trail)
  answering: null,    // that stroke while your return of it is in the air (a clean return or a miss?)
  turn: { player: 0, ai: 0 },   // 2v2: which member of each side strikes its next ball
  jutsu: null,        // { id, by }: the jutsu the last stroke fired (see JUTSU)
  pendingJutsu: null, // ...set by a stroke before registerHit makes it live
  jutsuAnswer: null,  // the jutsu the last stroke answered: if it lands, a COUNTER
  cloneRevealAt: Infinity,     // when the Shadow Clone decoys vanish
  fired: { player: false, ai: false },     // one jutsu per side per point
  slow: false,        // your Meta Vision: their balls come in slow motion (timeScale)
  zone: null,         // a CPU side's Meta Vision: it makes no errors
  hand: { player: false, ai: false },   // God Hand, per side, for the rest of the point
  void: null,         // the side whose Infinite Void is up (the other reacts late)
  hidden: false,      // Misdirection: the ball is invisible
  snake: null,        // Boomerang Snake: { t0, T, out, off } the curl it flies on
  barrier: null,      // the side whose Barrier walls its half's side strips (BARRIER)
  charge: { player: null, ai: null },   // a side's Spirit Bomb gathering: { n } balls landed since (SPIRIT)
  mirror: { player: 0, ai: 0 },   // Yata Mirror, per side: 'up' (waiting for their ball), 'primed' (it reflects)
  bind: null,         // the side a Shadow Possession binds (its next stroke floats to the caster)
  held: null,         // a CPU side that just played a possessed stroke (slow to the next ball)
  combo: null,        // the side whose Possession set up the ball now coming at it
  shark: null,        // the side whose Samehada eats the other's seals if it wins the point
  warp: { player: false, ai: false } };      // Flying Thunder God: the side that fired it this point (quick, never an edge)
/** The jutsu on the ball now (in flight from the one who fired it), or null. */
export const liveJutsu = () => (rally.live && rally.jutsu && rally.lastHitter === rally.jutsu.by ? rally.jutsu : null);
/** The jutsu coming at `side` (to be answered by its next stroke), as its id. */
export const incomingJutsu = side => { const j = liveJutsu(); return j && j.by !== side ? j.id : null; };
export const idx = who => (who === 'player' ? 0 : 1);
export const other = who => (who === 'player' ? 'ai' : 'player');
/** The opponent: 'CPU' in a quick match, a named player in the tournament. */
export const opp = { name: 'CPU', short: 'CPU', flag: '', color: COLORS.ai };
/** The near end: you, or the player you're watching there. */
export const YOU_FLAG = '🇻🇳';
export const home = { name: 'You', short: 'You', flag: YOU_FLAG, color: COLORS.player };
export const isYou = who => who === 'player' && !match.watch;   // your side (in 2v2: your team)
export const nameOf = who => (who === 'player' ? home.short : opp.short);
export const isPlaying = () => ['serve', 'toss', 'rally', 'pointOver'].includes(match.state);

function newStats() {
  return { pointsWon: [0, 0], longestRally: 0, winners: 0, errors: 0, serveFaults: [0, 0], aces: 0, fastest: 0, serves: 0, smashes: 0, cpuSmashes: 0,
    touches: 0, spinWins: 0, patterns: {}, sigSeen: 0, sigBeaten: 0, jutsu: 0, counters: 0, flows: 0 };
}

/** Set who you play: a quick-match CPU (level + style) or a tournament entrant. */
export function setOpponent(o) {
  Object.assign(opp, { name: o.name, short: o.short || o.name, flag: o.flag || '', color: o.color });
  match.levelKey = ai.level = o.level; match.styleKey = ai.style = o.style;
  ai.name = o.name;
  aiRacket.setColor(o.color);
  document.documentElement.style.setProperty('--cpu', hex(o.color));
  setCrowdColors('ai', o.color);
  drawBanners();
}
/** Who plays the near end: you (null), or a tournament entrant when watching. */
export function setHome(e) {
  Object.assign(home, e ? { name: e.name, short: e.short, flag: e.flag, color: e.color } : { name: 'You', short: 'You', flag: match.mode === 'tour' ? YOU_FLAG : '', color: COLORS.player });   // your flag: tournament only
  if (e) { nearAI.level = e.level; nearAI.style = e.style; }
  nearAI.name = e ? e.name : '';
  player.setColor(home.color);
  document.documentElement.style.setProperty('--player', e ? hex(e.color) : '');
  setCrowdColors('player', home.color);
  drawBanners();
}

export function startMatch() {
  const levelKey = match.levelKey;
  match.points = [0, 0];
  match.games = [0, 0];
  match.gameScores = [];
  match.gameStarter = 'player';
  match.paused = false;
  syncPauseButton();
  match.stats = newStats();
  for (const c of BOTS) { c.adapt = newAdapt(); c.sigShown = false; Object.assign(c.racket, { windTarget: 0, glowColor: null, lean: 0 }); }
  resetJutsu();
  match.after = null; match.timer = 0;
  hideAllMenus();
  $('topbar').classList.remove('hidden');
  const d = match.doubles;
  allyRacket.mesh.visible = ai2Racket.mesh.visible = d;
  for (const r of [player, aiRacket, allyRacket, ai2Racket]) r.setGhost(false);
  player.pos.set(d ? 0.35 : 0, PLAYER_CFG.restY, 1.8);
  aiRacket.pos.set(AI_COMMON.home.x, AI_COMMON.home.y, AI_COMMON.home.z);
  allyRacket.pos.set(-0.5, PLAYER_CFG.restY, 2.2);
  ai2Racket.pos.set(0.5, AI_COMMON.home.y, -2.2);
  placeBody(playerBody, player.pos.x, 1.8);
  placeBody(aiBody, AI_COMMON.home.x, AI_COMMON.home.z);
  placeBody(allyBody, -0.5, 2.2); placeBody(ai2Body, 0.5, -2.2);
  input.target.x = player.pos.x; input.target.z = 1.8;
  TLOG.matchStart();
  setupServe(true);
  const tag = p => (p.flag ? p.flag + ' ' : '') + p.short.toUpperCase();
  $('opp-name').textContent = d ? 'CPU ×2' : tag(opp);
  $('cpu-level').textContent = `(${AI_LEVELS[levelKey].label.toLowerCase()})`;
  $('you-name').textContent = d ? 'YOU + ALLY' : tag(home);
  $('you-level').textContent = match.watch ? `(${AI_LEVELS[nearAI.level].label.toLowerCase()})` : '';
  $('btn-ff').classList.toggle('hidden', !match.watch);
  syncFastForward();
  const bo = match.gamesToWin * 2 - 1, style = AI_STYLES[match.styleKey].label;
  if (match.mode === 'tour') {
    const r = match.watch ? match.watch.r : tour.round, round = ROUND_NAMES[r], tier = TIERS[tour.tier];
    $('sb-head').textContent = `${match.watch ? '▶ ' : ''}${tier.label} · ${round}`;
    setVenue(VENUE_OF_TIER[tour.tier]);
    setAttendance(tier.crowd[r]);
    setBoardText(tier.label);
    showMessage(round, match.watch ? `${home.flag} ${home.short} vs ${opp.flag} ${opp.short}` : `vs ${opp.flag} ${opp.name}`, 'neutral', 2.2, 3);
    crowdReact(null, 0.9);
  } else {
    const prac = match.mode === 'practice';
    $('sb-head').textContent = prac ? 'Practice · no limit' : `${d ? '2v2' : '1v1'} · Best of ${bo}`;
    setVenue(venueFor(match.mode));
    setAttendance(d ? 0.5 : prac ? 0.15 : 0.35);
    setBoardText(d ? 'Doubles' : prac ? 'Practice' : 'Open');
    showMessage(prac ? 'Practice' : d ? '2v2' : 'Game 1', d ? 'Take turns · serve diagonal' : `vs ${opp.flag} ${opp.short} · ${AI_LEVELS[levelKey].label} · ${style}`, 'neutral', 1.8, 3);
    crowdReact(null, 0.5);
  }
  drawScreens();
}

/** Server rotation: every 2 points, every point once both reach 10 (deuce). In 2v2 the serve
 *  also moves round the four players (DOUBLES.rotation), one step further each game. */
function currentServer() {
  const [p, a] = match.points, total = p + a;
  const turn = (p >= GAME.pointsToWin - 1 && a >= GAME.pointsToWin - 1)
    ? (GAME.pointsToWin - 1) + (total - 2 * (GAME.pointsToWin - 1))
    : Math.floor(total / GAME.servesPerTurn);
  if (match.doubles) {
    const [side, si, , ri] = DOUBLES.rotation[(turn + match.games[0] + match.games[1]) % 4];
    match.serverIdx = si; match.receiverIdx = ri;
    return side;
  }
  match.serverIdx = match.receiverIdx = 0;
  return turn % 2 === 0 ? match.gameStarter : other(match.gameStarter);
}

function setupServe(first = false) {
  if (match.mode === 'practice' && practice.refill) { chakra.player = CHAKRA.max; syncChakra(); }
  match.server = currentServer();
  match.state = 'serve';
  match.rallyCount = 0;
  TLOG.pointStart();
  Object.assign(rally, { live: false, serveStage: 0, lastHitter: null, bounceCount: 0, netTouched: false, shotBounces: 0, botShot: null, answering: null,
    turn: { [match.server]: match.serverIdx, [other(match.server)]: match.receiverIdx }, jutsu: null, pendingJutsu: null, jutsuAnswer: null, cloneRevealAt: Infinity, fired: { player: false, ai: false }, slow: false, zone: null, warp: { player: false, ai: false }, hand: { player: false, ai: false }, void: null, hidden: false, snake: null, stop: null,
    mirror: { player: 0, ai: 0 }, bind: null, held: null, combo: null, shark: null, barrier: null, charge: { player: null, ai: null },
    smashed: false, smashH: 0, yourSmashes: 0, byYou: false, yourStrokes: [], popUpAt: -1 });   // the last stroke was a smash · your smashes this point (ADAPT.smash)
  clearDecoys();
  syncChakra();   // a new point: seals spent last point are usable again
  match.toss = null;
  for (const c of BOTS) { c.plan = null; c.recoverUntil = 0; }
  for (const c of activeBots()) aiStartPoint(c);
  setPendingUpgrade(null);
  marker.visible = false;
  input.charging = false;
  const bot = serverBot();
  if (bot) {
    bot.serveX = match.doubles ? bot.s * rand(0.2, 0.5) : rand(-0.4, 0.4);   // 2v2: from its right half
    bot.serveAt = simTime + rand(1.1, 1.8);
  }
  if (match.doubles) {   // the receiver's right half glows: the serve must land there
    const sx = match.server === 'player' ? -1 : 1;
    serveZone.position.set(sx * HALF_W / 2, TABLE_TOP + 0.002, sx * HALF_L / 2);
  }
  holdBallForServe();
  updateHUD();
}

export function holdBallForServe() {
  const r = serverRacket();
  // Pin the racket inside the serving area so an instant release can't serve from far away.
  const sgn = match.server === 'player' ? 1 : -1;
  r.pos.x = match.doubles ? sgn * clamp(sgn * r.pos.x, DOUBLES.serveMinX, PLAYER_CFG.serveMaxX)   // 2v2: its right half
    : clamp(r.pos.x, -PLAYER_CFG.serveMaxX, PLAYER_CFG.serveMaxX);
  r.pos.z = sgn * clamp(sgn * r.pos.z, PLAYER_CFG.serveMinZ, PLAYER_CFG.serveMaxZ);
  const bob = Math.sin(simTime * 3) * 0.015;
  setBall({ x: r.pos.x, y: r.pos.y + 0.13 + bob, z: r.pos.z });
}

/** Can `who` legally strike the ball now? Only after it has bounced once on their half. */
export function canHit(who) {
  return rally.live && rally.serveStage === 0 && rally.lastHitter !== who && rally.bounceCount === 1;
}

/** smash: this stroke is a smash (the receiving CPU may read it: SMASH_D). stroke: false for a ball
 *  a jutsu played for you (a possessed float, a God Hand save) — not a stroke of yours for COMBO. */
export function registerHit(who, intensity, smash = false, stroke = true) {
  const self = turnBot(who), youHit = isYou(who) && rally.turn[who] === 0;   // before the turn passes
  rally.smashed = smash;   // (its contact height, rally.smashH, is set by the smash itself)
  rally.byYou = youHit && stroke;    // your stroke (not your 2v2 partner's, not a watched CPU's): combos (COMBO)
  // Jutsu: the one this stroke answered (if it lands, a counter) and the one it fired.
  rally.jutsuAnswer = rally.jutsu && rally.jutsu.by !== who ? rally.jutsu : null;
  rally.jutsu = rally.pendingJutsu;
  rally.pendingJutsu = null;
  clearDecoys();
  if (rally.jutsu) startJutsu(rally.jutsu);
  rally.lastHitter = who;
  rally.bounceCount = 0;
  rally.netTouched = false;
  rally.lastHitTime = simTime;
  TLOG.hit(who);
  if (rally.mirror[other(who)] === 'up') mirrorCheck(other(who));   // their Yata Mirror: primed or shattered
  if (rally.combo === who) rally.combo = null;
  rally.shotW = { ...ball.w };
  rally.shotBounces = 0;
  match.rallyCount++;
  if (match.doubles) rally.turn[who] ^= 1;   // partners alternate (the serve counts too)
  Sound.hit(intensity);
  if (rally.warp[who]) { const r = turnRacket(who); fxBurst(r.pos.x, r.pos.y, r.pos.z, JUTSU.hiraishin.color, 0.3); fxSprite(FX_TEX.ring, JUTSU.hiraishin.color, r.pos.x, TABLE_TOP + 0.01, r.pos.z, 0.2, 0.4, 2); }
  const opponent = turnBot(other(who));
  if (self) self.plan = null;
  if (youHit) rally.answering = rally.botShot;   // your return of the CPU's last stroke
  if (opponent) aiOnOpponentHit(opponent);
  if (who === 'player') {
    marker.visible = false;
  } else {
    // The bounce hint is for you only, and a Shadow Clone hides it.
    const m = yourTurn() && !(rally.jutsu && JUTSU[rally.jutsu.id].decoys) ? predictBounce(ball, 1) : null;
    marker.visible = !!m;
    if (m) marker.position.set(m.x, TABLE_TOP + 0.003, m.z);
    const meet = predictIntercept(ball, 1, 2.5, PLAYER_CFG.minZ);
    rally.expectY = meet ? meet.y : PLAYER_CFG.restY;
  }
  updateHUD();
}

export function onTableBounce(side, x) {
  const server = match.server, receiver = other(server);
  if (rally.serveStage === 1) {
    if (side === server) rally.serveStage = 2;
    else serveFault('Bad serve');
  } else if (rally.serveStage === 2) {
    if (side === receiver) {
      if (rally.netTouched) return callLet();
      // 2v2: the serve has to land on the receiver's right half (the centre line counts).
      if (match.doubles && x * (receiver === 'player' ? 1 : -1) < -DOUBLES.centre) return serveFault('Not diagonal');
      rally.serveStage = 0;
      rally.bounceCount = 1;
    } else {
      serveFault(rally.netTouched ? 'Serve in net' : 'Bad serve');
    }
  } else if (side === rally.lastHitter) {
    endPoint(other(side), rally.netTouched ? 'Net' : 'Own side', 'error');
  } else {
    // Their Barrier: a ball landing on its walled side strip is out.
    if (rally.bounceCount === 0 && rally.barrier === side && Math.abs(x) > HALF_W - BARRIER.w) return endPoint(side, 'Barrier', 'error');
    rally.bounceCount++;
    if (rally.bounceCount === 1) strokeLanded(rally.lastHitter);
    if (rally.bounceCount === 1 && rally.answering) returnedClean(rally.answering);
    if (rally.bounceCount >= 2) endPoint(rally.lastHitter, 'Double bounce', 'miss');
  }
}

/** Your return of a CPU stroke landed: that zone counts as handled (adaptation), and a returned
 *  signature shot counts as beaten. */
function returnedClean(shot) {
  rally.answering = null;
  const w = ai.adapt.zoneMiss;
  if (w[shot.zone]) w[shot.zone] = Math.max(0, w[shot.zone] - ADAPT.returned);
  if (shot.sig) beatSignature(ai, shot.sig);
}

export function onFloor() {
  if (rally.serveStage > 0) {
    serveFault(rally.netTouched ? 'Serve in net' : 'Serve out');
  } else if (rally.bounceCount === 0) {
    const why = rally.netTouched ? 'Net' : Math.abs(ball.p.x) > HALF_W ? 'Wide' : 'Long';
    endPoint(other(rally.lastHitter), why, 'error');
  } else {
    endPoint(rally.lastHitter, 'Missed', 'miss');
  }
}

export function serveFault(why) {
  match.stats.serveFaults[idx(match.server)]++;
  endPoint(other(match.server), why, 'fault');
}

function callLet() {
  rally.live = false;
  clearDecoys();
  showMessage('Let', 'Serve again', 'warn', 1.3, 3);
  schedule(GAME.pointDelay, setupServe);
}

/** What `who` did, in a word or two: "CPU · Long". */
const say = (who, what) => `${nameOf(who)} · ${what}`;

/** why: what the loser did, in a word or two ("Long", "Net").
 *  kind: 'error' (loser hit out/net), 'miss' (loser failed to return), 'fault' (serve fault). */
export function endPoint(winner, why, kind) {
  if (!rally.live) return;
  if (kind !== 'fault' && rally.hand[other(winner)]) return godHandSave(other(winner));
  TLOG.pointEnd(winner, why, kind);
  rally.live = false;
  for (const c of BOTS) c.plan = null;
  clearDecoys();
  marker.visible = false;
  match.state = 'pointOver';
  const loser = other(winner), s = match.stats;
  match.points[idx(winner)]++;
  s.pointsWon[idx(winner)]++;
  s.longestRally = Math.max(s.longestRally, match.rallyCount);
  if (winner === 'player' && kind === 'miss') s.winners++;
  if (loser === 'player' && kind === 'error') s.errors++;
  if (winner === match.server && kind === 'miss' && match.rallyCount === 1) s.aces++;
  if (adapting(ai) && !match.doubles) adaptAfterPoint(ai, winner, kind);

  const youWon = winner === 'player';
  const tone = match.watch ? 'neutral' : youWon ? 'good' : 'bad';
  // Beaten by a signature shot (or a jutsu): the point message names it and its counter.
  const bs = rally.botShot, beatBy = !match.watch && winner === 'ai' && kind !== 'fault' && bs && bs.sig && bs.by === 'ai' ? SIGNATURES[bs.sig] : null;
  const jt = !match.watch && rally.jutsu && rally.jutsu.by === winner && kind !== 'fault' ? JUTSU[rally.jutsu.id] : null;
  const title = isYou(winner) ? 'Your point' : `${nameOf(winner)}'s point`;
  if (kind === 'fault') showMessage('Fault', say(loser, why), tone, 1.5, 3);
  else if (jt) showMessage(title, youWon ? `${jt.name}!` : `${jt.name} · ${jt.counter.toLowerCase()}`, tone, 2, 3);
  else if (beatBy) showMessage(title, `★ ${beatBy.name} · ${beatBy.counter}`, tone, 2.2, 3);
  else showMessage(title, say(loser, why), tone, 1.5, 3);
  Sound.point(youWon);
  gainChakra(winner, CHAKRA.win);
  gainChakra(loser, CHAKRA.lose);
  if (rally.shark === winner) drainSeals(winner);   // Samehada: it won, it eats
  updateFlow(winner);
  // The crowd: long rallies and big points get them more excited.
  const big = pointSituation() ? 0.25 : 0;
  const excite = clamp(0.3 + match.rallyCount / 12 + big, 0.3, 1);
  crowdReact(winner, excite * (youWon ? 1 : 0.75));
  updateHUD();
  schedule(GAME.pointDelay, afterPoint);
}

/** Adaptation, after each point vs you: miss weights fade; a point you lost on the CPU's stroke
 *  (you didn't return it, or your return went out / into the net) counts against its zone. A
 *  target is held for a few points, then it switches to another zone or rests — so it never just
 *  hammers your worst shot. */
function adaptAfterPoint(c, winner, kind) {
  const a = c.adapt, shot = rally.botShot;
  adaptToSmash(a, rally.yourSmashes, winner !== c.owner && kind === 'miss' && rally.smashed);
  for (const z in a.zoneMiss) a.zoneMiss[z] *= ADAPT.decay;
  if (winner === c.owner && kind !== 'fault' && shot && shot.by === c.owner) a.zoneMiss[shot.zone] = (a.zoneMiss[shot.zone] || 0) + 1;
  a.heldPoints++;
  if (a.target && a.heldPoints < a.hold) return;
  if (!a.target && a.rest > 0) { a.rest--; return; }
  const best = Object.entries(a.zoneMiss).filter(([z, w]) => z !== a.target && w >= ADAPT.minWeight).sort((x, y) => y[1] - x[1])[0];
  const was = a.target;
  a.heldPoints = 0;
  if (best) {
    a.target = best[0];
    a.hold = ADAPT.hold[0] + Math.floor(Math.random() * (ADAPT.hold[1] - ADAPT.hold[0] + 1));
  } else if (was) {
    a.target = null;
    a.rest = ADAPT.rest;
  }
}

/** Your smash habit (ADAPT.smash): smashes this point and whether one won it (a winner, not an
 *  error of the CPU's) build up `anti`; without them it fades. */
function adaptToSmash(a, smashes, won) {
  const S = ADAPT.smash;
  a.smashUse = a.smashUse * S.decay + smashes;
  a.smashWon = a.smashWon * S.decay + (won ? 1 : 0);
  const want = clamp(a.smashUse * S.use + a.smashWon * S.won, 0, 1);
  a.anti = want > a.anti ? Math.min(want, a.anti + S.rise) : Math.max(want, a.anti - S.fall);
}

function afterPoint() {
  const [p, a] = match.points;
  const gameOver = (p >= GAME.pointsToWin || a >= GAME.pointsToWin) && Math.abs(p - a) >= GAME.winBy;
  if (!gameOver) return setupServe();
  const winner = p > a ? 'player' : 'ai';
  match.games[idx(winner)]++;
  match.gameScores.push(`${p}-${a}`);
  updateHUD();
  if (match.games[idx(winner)] >= match.gamesToWin) return endMatch(winner);
  const gameNo = match.games[0] + match.games[1];
  showMessage(isYou(winner) ? `Game ${gameNo} · yours` : `Game ${gameNo} · ${nameOf(winner)}`,
    `${p} – ${a}`, match.watch ? 'neutral' : winner === 'player' ? 'good' : 'bad', 2.4, 3);
  Sound.fanfare(winner === 'player');
  crowdReact(winner, 1);
  setTimeout(startWave, 900);
  schedule(GAME.gameDelay, () => {
    match.points = [0, 0];
    match.gameStarter = other(match.gameStarter);   // alternate first server each game
    setupServe();
    showMessage(`Game ${match.games[0] + match.games[1] + 1}`, '', 'neutral', 1.2, 3);
  });
}

export function endMatch(winner) {
  match.state = 'matchOver';
  TLOG.matchEnd();
  setArmed(0);
  syncChakra();
  match.rankMove = match.watch ? null : moveRank(winner === 'player');
  Sound.fanfare(winner === 'player');
  crowdReact(winner, 1);
  startWave();
  if (match.watch) tourRecordWatched(winner);
  else if (match.mode === 'tour') tourRecordResult(winner === 'player');
  showEndMenu(winner);
}

function schedule(delay, fn) { match.timer = delay; match.after = fn; }

/** Simulation speed factor chosen in the menu. */
export const timeScale = () => GAME.speeds[match.speedKey].scale * (match.watch ? watchSpeed : 1)
  * (rally.slow && rally.live && rally.lastHitter !== 'player' ? META_SLOW : 1);   // Meta Vision: their balls in slow motion

/** Fast-forward while watching CPU vs CPU (the ⏩ button); remembered between matches. */
export const WATCH_SPEEDS = [1, 2, 4];

export let watchSpeed = 2;

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setWatchSpeed(v) { return (watchSpeed = v); }
