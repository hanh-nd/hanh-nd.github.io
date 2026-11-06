// Serves: the CPU's, yours, and the toss.
import { clamp, rand } from './util.js';
import { PHYS, TOSS_HEIGHT } from './config.js';
import { solveServe, stepBall } from './physics.js';
import { player } from './render/racket.js';
import { ball, ballPrev, setBall } from './render/ball.js';
import { input } from './input.js';
import { applyShot, strokeSwipe } from './strokes.js';
import { levelCfg, noteAIShot, serverBot, serverRacket, styleCfg } from './ai.js';
import { match, rally, registerHit } from './rules.js';
import { updateHUD } from './ui/hud.js';
import { stepEvents } from './loop.js';

export function aiServeCharge(c) {
  const cfg = levelCfg(c);
  if (Math.random() < cfg.mistakeRate * 0.4) return rand(0.97, 1.0);   // serve fault: long
  return clamp(0.35 + cfg.power * 0.35 + rand(-0.08, 0.08), 0.05, 0.9);
}

function aiServe(c, charge) {
  const cfg = levelCfg(c), st = styleCfg(c), si = c.serveIntent || {};
  const sideSign = si.side === 'bh' ? c.s : si.side === 'fh' ? -c.s : Math.random() < 0.5 ? -1 : 1;
  let tx = sideSign * (0.2 + 0.4 * (1 - cfg.aimError));
  const fault = charge >= 0.95;   // a rolled serve fault (aiServeCharge) still happens
  if (!fault && si.long) charge = rand(0.72, 0.78);
  if (!fault && si.short) charge = rand(0.1, 0.18);
  const back = si.back ?? Math.random() < st.serveBack;
  let top = (back ? -st.chopSpin : st.top) * rand(0.5, 1) * (40 + 120 * cfg.spin);
  let side = cfg.spin * rand(-1, 1) * 40 * st.side;
  let shown = top;
  if (si.sig === 'mozart-serve') {   // half-long, heavy sidespin the way the racket leaned
    if (!fault) charge = rand(0.2, 0.3);
    top = -rand(20, 40); side = si.lean * rand(150, 175); tx = -si.lean * rand(0.25, 0.4);
    shown = top;
  }
  if (si.sig === 'ghost-serve') {    // heavy spin, and the racket face shows the opposite
    if (!fault) charge = rand(0.3, 0.45);
    top = si.hidden === 'top' ? rand(140, 170) : -rand(160, 190); side = rand(-1, 1) * 30;
    shown = -Math.sign(top) * 120;
  }
  if (match.doubles) tx = -c.s * rand(0.15, 0.5);   // diagonal: onto the receiver's right half
  c.racket.tilt = clamp(shown / 140, -1, 1);
  doServe(c.owner, charge, top, side, tx);
  noteAIShot(c, si, tx, top, !!si.short);
}

/** Player serve, struck as the tossed ball falls. The swipe while it falls sets the spin:
 *  forward = topspin, pull back = backspin, sideways = sidespin (plus wheel tilt). */
export function playerServe(charge) {
  const { sl, sf } = strokeSwipe();
  const tx = match.doubles ? -clamp(0.35 - player.pos.x * 0.2 - sl * 0.05, 0.15, 0.6)   // diagonal, see onTableBounce
    : clamp(player.pos.x * 0.7 + sl * 0.05, -0.6, 0.6);
  const top = clamp(input.tilt * 90 + (sf > 0 ? sf * 40 : sf * 70), -150, 120);
  doServe('player', charge, top, clamp(sl * 8, -40, 40), tx);
}
export function beginToss(who, charge) {
  match.state = 'toss';
  match.toss = { who, charge, strikeY: ball.p.y };
  setBall(ball.p, { x: 0, y: Math.sqrt(2 * PHYS.gravity * TOSS_HEIGHT), z: 0 });
  updateHUD();
}
export function stepToss(dt) {
  Object.assign(ballPrev, ball.p);
  const ev = stepEvents;
  ev.net = false; ev.table = null; ev.floor = null;
  stepBall(ball, dt, ev);
  if (ball.v.y < 0 && ball.p.y <= match.toss.strikeY) {
    const bot = serverBot();
    if (bot) aiServe(bot, match.toss.charge); else playerServe(match.toss.charge);
  }
}

/** Serve: ball must bounce once on the server's half, then on the receiver's half.
 *  Charge sets depth (and therefore pace); too much and the serve goes long. */
function doServe(who, charge, top, side, tx) {
  const dir = who === 'player' ? -1 : 1;
  const tz = dir * (0.45 + charge * 1.05);   // charge above ~0.88 lands past the end line
  const shot = solveServe({ ...ball.p }, { x: tx, z: tz }, top, side);
  applyShot(shot);
  serverRacket().swing = 1;
  match.state = 'rally';
  rally.live = true;
  rally.serveStage = 1;
  if (who === 'player') match.stats.serves++;
  registerHit(who, 0.3 + charge * 0.4);
}
