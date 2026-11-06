// The play log (?log): every stroke and point of real play, shared from the pause and end menus.
import { ARM, BLOCK, CHOP, PLAYER_CFG, REACH, SMASH, SPIN } from './config.js';
import { HALF_L, TABLE_TOP, landingOf, simulate } from './physics.js';
import { aiBody, aiRacket, player, playerBody } from './render/racket.js';
import { ball } from './render/ball.js';
import { input, swing, touchLast, touchSens } from './input.js';
import { topspinOf, unreadSpin } from './strokes.js';
import { arcOf } from './ai.js';
import { yourReach } from './jutsu.js';
import { canHit, match, opp, rally, timeScale } from './rules.js';
import { simTime } from './loop.js';

/** Optional diagnostics (enable from the console: PingPong.debug.on = true). */
export const DEBUG = { on: false, log: [] };

/** Play log, for tuning the game from real play (off unless the game is opened with ?log; ?log=off
 *  turns it off again). Every stroke — yours and the CPU's — with the swipe that made it (the
 *  finger's path around contact), the ball it met, what the stroke became and how near it came to
 *  another stroke, and every point's end, including how close your racket came to a ball you
 *  missed. Kept in the browser (the last LOG_MATCHES matches), exported from the pause and end
 *  menus (Share / Copy). In log mode each of your strokes is named on screen for a moment. */
const LOG_MATCHES = 8;
export const TLOG = (() => {
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  let on = false;
  try {
    const q = new URLSearchParams(location.search).get('log');
    if (q != null) ls.set('pp3d.logOn', !(q === 'off' || q === '0'));
    on = ls.get('pp3d.logOn', false) === true;
  } catch { /* off */ }
  const r2 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : v);
  const v3 = v => [r2(v.x), r2(v.y), r2(v.z)];
  const L = { on, chase: null, data: null, cur: null, pt: null, ctx: null, last: null, trace: [], after: null, miss: null, trying: 'normal' };
  const load = () => {
    L.data = ls.get('pp3d.log', null);
    if (!L.data || L.data.v !== 1) L.data = { v: 1, matches: [] };
    L.trying = ls.get('pp3d.logTrying', 'normal');
  };
  const save = () => {
    const d = L.data;
    d.device = { ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: input.touch, sens: r2(touchSens.mult) };
    d.cfg = { driveFwd: PLAYER_CFG.driveFwd, pushMin: PLAYER_CFG.pushMin, ARM, touchZ: PLAYER_CFG.touchZ,
      strokeWindow: PLAYER_CFG.strokeWindow, smashMin: SMASH.minSwing, smashWindow: SMASH.window, sideMin: SPIN.minSwing, touchSmash: PLAYER_CFG.touchSmash,
      blockZ: r2(HALF_L + BLOCK.table), BLOCK, CHOP };
    d.saved = new Date().toISOString();
    while (d.matches.length > LOG_MATCHES) d.matches.shift();
    while (!ls.set('pp3d.log', d) && d.matches.length > 1) d.matches.shift();   // storage full: drop the oldest
  };
  if (on) load();
  const live = () => L.on && !match.watch && L.cur;
  L.json = () => JSON.stringify(L.data);
  L.count = () => (L.data ? L.data.matches.reduce((n, m) => n + m.points.length, 0) : 0);
  L.setTrying = t => { L.trying = t; ls.set('pp3d.logTrying', t); if (L.pt) L.pt.trying = t; };
  L.clear = () => { L.data = { v: 1, matches: [] }; if (L.cur) { L.cur.points = []; L.data.matches.push(L.cur); } save(); };
  L.setOn = v => { L.on = v; ls.set('pp3d.logOn', v); if (v && !L.data) load(); };

  L.matchStart = () => {
    L.cur = null; L.pt = null;
    if (!L.on || match.watch) return;
    L.cur = { at: new Date().toISOString(), mode: match.mode, level: match.levelKey, style: match.styleKey, opp: match.doubles ? 'CPU ×2' : opp.name,
      doubles: !!match.doubles, speed: match.speedKey, sens: r2(touchSens.mult), touch: input.touch ? 1 : 0, points: [] };
    L.data.matches.push(L.cur);
  };
  L.pointStart = () => {
    if (!live()) return;
    L.pt = { n: L.cur.points.length + 1, score: [...match.points], games: [...match.games], server: match.server === 'player' ? 'you' : 'cpu',
      trying: L.trying, t0: simTime, hits: [] };
    L.miss = null; L.last = null;
  };
  /** Every sim step of yours (from trackSwing): the finger's path, and how near your racket comes
   *  to a ball you have to play. */
  L.step = (r, ts) => {
    if (!L.on) return;
    L.trace.push([simTime, input.target.x, input.target.z, swing.tvx * ts, -swing.tvz * ts, r.vel.x * ts, -r.vel.z * ts, touchLast ? 1 : 0]);
    while (L.trace.length && simTime - L.trace[0][0] > 0.6) L.trace.shift();
    if (L.chase) L.chaseStep();
    if (L.after && simTime - L.after.t >= 0.2) { L.after.rec.after = L.path(L.after.t, L.after.t + 0.2, L.after.t); L.after = null; }
    if (live() && L.pt && canHit('ai')) {
      const q = aiRacket.pos, dx = ball.p.x - q.x, dy = ball.p.y - q.y, dz = ball.p.z - q.z, d = Math.hypot(dx, dy * PLAYER_CFG.yWeight, dz);
      if (!L.cpuMiss || d < L.cpuMiss.d) L.cpuMiss = { d: r2(d), dx: r2(dx), dy: r2(dy), dz: r2(dz), ball: v3(ball.p), racket: v3(q), body: [r2(aiBody.x), r2(aiBody.z)], t: r2(simTime - L.pt.t0) };
    }
    if (live() && L.pt && canHit('player')) {
      const dx = ball.p.x - r.pos.x, dy = (ball.p.y - r.pos.y) * PLAYER_CFG.yWeight, dz = ball.p.z - r.pos.z, d = Math.hypot(dx, dy, dz);
      if (!L.miss || d < L.miss.d) L.miss = { d: r2(d), dx: r2(dx), dy: r2(ball.p.y - r.pos.y), dz: r2(dz), ball: v3(ball.p), racket: v3(r.pos),
        body: [r2(playerBody.x), r2(playerBody.z)], reach: r2(yourReach()), finger: touchLast ? 1 : 0, t: r2(simTime - L.pt.t0) };
    }
  };
  /** The finger's path, sim s from..to, every ~1/40 s: [s from t0, x, z, finger sideways, forward, racket sideways, forward (real m/s), finger down]. */
  L.path = (from, to, t0) => {
    const out = []; let next = -Infinity;
    for (const s of L.trace) if (s[0] >= from && s[0] <= to + 1e-9 && s[0] >= next) { out.push([r2(s[0] - t0), ...s.slice(1, 7).map(r2), s[7]]); next = s[0] + 0.025; }
    return out;
  };
  /** Who plays the ball for side `who`: 'you', your 2v2 partner ('ally', whose turn it is), or 'cpu'. */
  const whoOf = who => (who !== 'player' ? 'cpu' : match.doubles && rally.turn && rally.turn.player === 1 ? 'ally' : 'you');
  /** The ball as `who` meets it, before the stroke changes it. */
  L.contact = who => {
    if (!live()) return;
    const me = whoOf(who);
    if (me === 'you') L.endChase('hit');
    const w = unreadSpin();
    L.ctx = { who: me, t: simTime, pos: v3(ball.p), h: r2(ball.p.y - TABLE_TOP), vin: v3(ball.v),
      speedIn: r2(Math.hypot(ball.v.x, ball.v.y, ball.v.z)), rising: ball.v.y > 0 ? 1 : 0, topIn: Math.round(topspinOf(w, ball.v)),
      sideIn: Math.round(w.y * Math.sign(ball.v.z || 1)), ts: r2(timeScale()) };
    if (me === 'you') {
      const ts = timeScale();
      Object.assign(L.ctx, { racket: v3(player.pos), body: [r2(playerBody.x), r2(playerBody.z)], bodyV: [r2(playerBody.vx * ts), r2(playerBody.vz * ts)],
        finger: touchLast ? 1 : 0, before: L.path(simTime - 0.4, simTime, simTime) });
    }
  };
  L.note = o => { if (L.ctx) Object.assign(L.ctx, o); };
  /** The CPU has read your stroke (aiOnOpponentHit): how long until it moves (again, after an upgrade). */
  L.cpuPlan = c => {
    if (!live() || !L.last || L.last.who !== 'you' || c.owner !== 'ai') return;
    if (L.last.cpuReact != null) L.last.cpuReplan = 1;
    L.last.cpuReact = r2(c.plan.readyAt - simTime);
  };
  /** The stroke is played (registerHit): what came of it, as the ball leaves. */
  L.hit = who => {
    const me = whoOf(who);
    if (!live() || !L.pt) { L.ctx = null; return; }
    const c = L.ctx && L.ctx.who === me ? L.ctx : { who: me, serve: 1, t: simTime, pos: v3(ball.p) };
    L.ctx = null;
    c.t = r2(c.t - L.pt.t0); c.n = match.rallyCount;
    L.outcome(c);
    if (rally.jutsu && rally.jutsu.by === who) c.jutsu = rally.jutsu.id;
    L.pt.hits.push(c);
    L.last = c; L.miss = null; L.cpuMiss = null;
    if (me === 'you') c.cpu = { racket: v3(aiRacket.pos), body: [r2(aiBody.x), r2(aiBody.z)] };   // where the CPU stood when you hit
    if (me === 'you' && !c.serve) { L.after = { t: simTime, rec: c }; L.show(c); }
    L.endChase(null);
    if (me === 'cpu' && !match.doubles) L.startChase(c);
  };
  /** Your chase of a CPU ball, from its hit to your contact (or the point's end): where you stood,
   *  how soon you moved, your path, and whether the ball was reachable at all — the time to spare
   *  with an instant start (slack: footwork at PLAYER_CFG.bodySpeed / bodyAccel, the racket an
   *  arm's reach from the body). Times are sim s (real s = sim / ts). */
  L.startChase = c => {
    const b = playerBody, r = player.pos, ch = c.chase = {
      from: { body: [r2(b.x), r2(b.z)], racket: [r2(r.x), r2(r.z)], finger: [r2(input.target.x), r2(input.target.z)], down: touchLast ? 1 : 0 },
      react: null, path: [], end: null };
    const vmax = PLAYER_CFG.bodySpeed, a = PLAYER_CFG.bodyAccel, need = d => (d < vmax * vmax / (2 * a) ? Math.sqrt(2 * d / a) : d / vmax + vmax / (2 * a));
    let best = null, bounced = false;
    const win = [Infinity, -Infinity];   // when it is playable
    simulate({ p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } }, 3, (q, ev, t) => {
      if (ev.floor) return true;
      if (ev.table) { if (bounced) return true; if (ev.table.z > 0) bounced = true; return; }
      const h = q.p.y - TABLE_TOP;   // playable: over the table top (racketMinY), within reach
      if (!bounced || h < 0.03 || h > 1 || q.p.z < PLAYER_CFG.minZ || q.p.z > PLAYER_CFG.maxZ || Math.abs(q.p.x) > -PLAYER_CFG.minX + REACH.armX) return;
      win[0] = Math.min(win[0], t); win[1] = Math.max(win[1], t);
      const d = Math.hypot(Math.max(0, Math.abs(q.p.x - b.x) - REACH.armX), Math.max(0, Math.abs(q.p.z - b.z) - REACH.armZ)), slack = t - need(d);
      if (!best || slack > best.slack) best = { slack, t, d, at: [q.p.x, q.p.y - TABLE_TOP, q.p.z] };
    });
    ch.reach = best ? { slack: r2(best.slack), t: r2(best.t), run: r2(best.d), at: best.at.map(r2), window: win.map(r2) } : null;   // null: never playable (long / net)
    L.chase = { ch, t0: simTime, next: simTime, fx: input.target.x, fz: input.target.z, bx: b.x, bz: b.z };
  };
  L.chaseStep = () => {
    const k = L.chase, ch = k.ch, t = simTime - k.t0;
    if (ch.react == null && Math.hypot(input.target.x - k.fx, input.target.z - k.fz) > 0.03) ch.react = r2(t);
    if (ch.bodyMove == null && Math.hypot(playerBody.x - k.bx, playerBody.z - k.bz) > 0.03) ch.bodyMove = r2(t);
    if (simTime >= k.next) {
      k.next = simTime + 0.05;
      ch.path.push([r2(t), r2(playerBody.x), r2(playerBody.z), r2(player.pos.x), r2(player.pos.z), r2(input.target.x), r2(input.target.z), touchLast ? 1 : 0]);
    }
    if (t > 3) L.endChase('timeout');
  };
  /** why: 'hit' (you met it), 'point' (the point ended first), 'timeout'. */
  L.endChase = why => {
    if (!L.chase) return;
    if (why) L.chase.ch.end = { why, t: r2(simTime - L.chase.t0) };
    L.chase = null;
  };
  L.outcome = c => {
    const land = landingOf({ p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } }, false);
    c.vout = v3(ball.v); c.wout = v3(ball.w);
    c.speedOut = r2(Math.hypot(ball.v.x, ball.v.y, ball.v.z));
    c.topOut = Math.round(topspinOf(ball.w, ball.v));
    c.apex = r2(arcOf({ v: ball.v, w: ball.w }));   // highest over the table before it lands
    c.land = land ? { x: r2(land.x), z: r2(land.z), table: land.table ? 1 : 0, net: land.net ? 1 : 0 } : null;
  };
  /** Your stroke changed after contact (a smash or a sidespin upgrade). */
  L.amend = o => {
    const c = L.last;
    if (!live() || !c || c.who !== 'you') return;
    Object.assign(c, o);
    L.outcome(c);
    L.show(c);
  };
  L.pointEnd = (winner, why, kind) => {
    if (!live() || !L.pt) return;
    L.endChase('point');
    const p = L.pt;
    p.end = { winner: winner === 'player' ? 'you' : 'cpu', why, kind, rally: match.rallyCount, t: r2(simTime - p.t0) };
    if (winner !== 'player' && kind === 'miss' && L.miss) p.end.yourMiss = L.miss;   // the ball you didn't reach
    if (winner === 'player' && kind === 'miss' && L.cpuMiss) p.end.cpuMiss = L.cpuMiss;   // ...and the CPU's
    delete p.t0;
    L.cur.points.push(p);
    L.pt = null; L.miss = null; L.ctx = null;
    save();
  };
  L.matchEnd = () => {
    if (!live()) return;
    L.cur.games = [...match.games]; L.cur.gameScores = [...match.gameScores]; L.cur.stats = match.stats;
    save();
  };
  /** On screen: the stroke you just played, and how far it was from the others. */
  let hudT = 0;
  L.show = c => {
    const el = document.getElementById('tlog-hud');
    if (!el) return;
    const bits = [`<b>${c.stroke || '?'}</b>`];
    if (c.fwd != null) bits.push(`fwd ${c.fwd} <small>(drive ≥${PLAYER_CFG.driveFwd})</small>`);
    if (c.arm != null) bits.push(`arm ${c.arm}`);
    if (c.flick != null) bits.push(`flick ${c.flick}<small>/${SMASH.minSwing}</small>`);
    if (c.sideFlick) bits.push(`side ${c.sideFlick}<small>/${SPIN.minSwing}</small>`);
    bits.push(`z ${c.pos[2]}${c.stroke === 'push' ? ` <small>(chop ≥${CHOP.z})</small>` : c.stroke === 'drive' || c.stroke === 'block' ? ` <small>(block ≤${r2(HALF_L + BLOCK.table)})</small>` : ''}`,
      `h ${c.h}`, `→ apex ${c.apex}`);
    el.innerHTML = bits.join(' · ');
    el.classList.remove('hidden');
    clearTimeout(hudT); hudT = setTimeout(() => el.classList.add('hidden'), 2500);
  };
  L.r2 = r2;
  return L;
})();
export const lr = TLOG.r2;   // (log rounding)
