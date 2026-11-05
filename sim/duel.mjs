// Jutsu duel, CPU vs CPU (watch mode), stepped headlessly like run.mjs (no wall clock, no rendering).
// Each point one random side gets 1–3 seals (the other none, unless foeSeals) and a random kit, and
// fires whenever it can. Reports the win rate of the points each jutsu was fired in, vs points with
// no jutsu (~50%). Ported from the old .agent-kit/sim5.mjs, which played in real time.
//   node sim/duel.mjs '{"level":"medium","points":600}' ['{...}' ...]
// opts: level · points · style (both sides; default random per match) · only: [jutsu ids] (the
// firer's kit is built from these where it can) · foeSeals: true (the other side gets 0–3 seals
// too, so Samehada and Copy Wheel have something to work on) · tune (as in run.mjs)
// iq: { ai, player } — smart vs plain instead: ordinary matches (chakra earned, jutsu fired as the
// CPUs choose), each end's iq overridden (null: its level's). Reports each end's point and game share
// and jutsu per point. Run it with the iqs swapped too, so the ends' own bias cancels out.
import { launch, gameUrl } from './browser.mjs';

const runs = process.argv.slice(2).map(a => JSON.parse(a));
if (!runs.length) runs.push({ level: 'medium', points: 600 });
const browser = await launch();

await Promise.all(runs.map(async (opts, i) => {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(`[${i}] pageerror`, e.message));
  await page.goto(gameUrl());
  await page.waitForFunction(() => window.PingPong && window.PingPong.test && window.PingPong.test.STYLE_KIT);
  const t0 = Date.now();
  const r = await page.evaluate(duel, opts);
  console.log(JSON.stringify({ run: opts, secs: +((Date.now() - t0) / 1000).toFixed(1), ...r }));
  await page.close();
}));
await browser.close();

function duel(opts) {
  const P = window.PingPong, T = P.test, dt = 1 / 240, { match, rally, chakra } = P;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const merge = (dst, src) => { for (const k in src) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k]) merge(dst[k], src[k]); else dst[k] = src[k]; } };
  if (opts.tune) for (const k in opts.tune) if (T[k]) merge(T[k], opts.tune[k]);
  for (const l in P.JUTSU_AI) P.JUTSU_AI[l].use = 1;
  const level = opts.level || 'medium', N = opts.points || 600;
  const pool = slot => { const all = P.JUTSU_POOL[slot], only = opts.only ? all.filter(id => opts.only.includes(id)) : []; return only.length ? only : all; };
  const randKit = () => ['block', 'drive', 'smash'].map(k => pick(pool(k)));
  const R = { by: {}, none: [0, 0], points: 0, fizzle: 0 };
  if (opts.iq) return iqDuel();

  function newMatch() {
    P.newTournament('pro');
    for (const e of P.tour.entrants) if (!e.you) e.level = level;
    const st = opts.style || pick(['allround', 'blocker', 'defender', 'wizard', 'attacker']), m = P.tour.rounds[0][0];
    P.tour.entrants[m.a].style = P.tour.entrants[m.b].style = st;
    P.watchTourMatch(0, 0);
    match.paused = true;
    match.gamesToWin = 1;
  }
  newMatch();
  let prev = '', pts = [0, 0], firer = null, fired = null, seals = 0, foe = 0, steps = 0;
  while (R.points < N && steps < 240 * 60 * 60 * 2) {
    steps++;
    if (match.state === 'serve' && prev !== 'serve') {   // a new point: who fires, with what
      pts = [...match.points]; firer = Math.random() < 0.5 ? 'player' : 'ai'; fired = null;
      seals = 1 + Math.floor(Math.random() * 3); foe = opts.foeSeals ? Math.floor(Math.random() * 4) : 0;
      P.ai.kit = randKit(); P.nearAI.kit = randKit();
      const f = P.flow; f.player = f.ai = false; f.deep.player = f.deep.ai = false; f.streak.player = f.streak.ai = 0;
    }
    prev = match.state;
    const o = firer === 'player' ? 'ai' : 'player';
    if (firer && match.state === 'serve') { chakra[firer] = seals * 100; chakra[o] = foe * 100; }   // then they play it out
    if (firer && !opts.foeSeals) chakra[o] = Math.min(chakra[o], 99);   // the other side never fires
    if (firer && !fired) { const j = rally.pendingJutsu || rally.jutsu; if (j && j.by === firer) fired = j.id; else if (rally.fired[firer]) fired = 'fizzle'; }
    T.fixedUpdate(dt);
    if (match.state === 'pointOver' && prev !== 'pointOver' && firer) {
      R.points++;
      const won = (match.points[0] > pts[0] ? 'player' : 'ai') === firer ? 1 : 0;
      const b = fired ? (R.by[fired] ||= [0, 0]) : R.none;
      b[0]++; b[1] += won;
      firer = null;
    }
    if (match.state === 'matchOver') { newMatch(); prev = ''; }
  }
  function iqDuel() {
    const Q = { pts: [0, 0], games: [0, 0], fired: [0, 0], clutchFired: [0, 0], points: 0, by: [{}, {}] };
    const setIq = () => { P.nearAI.iq = opts.iq.player ?? undefined; P.ai.iq = opts.iq.ai ?? undefined; };
    newMatch(); match.gamesToWin = 2; setIq();
    let steps = 0, prev = '', firedNow = [false, false], clutch = false, before = [0, 0];
    while (Q.points < N && steps < 240 * 60 * 60 * 3) {
      steps++;
      if (match.state === 'serve' && prev !== 'serve') { firedNow = [false, false]; clutch = Math.max(...match.points) >= 10; before = [...match.stats.pointsWon]; }
      prev = match.state;
      T.fixedUpdate(dt);
      if (rally.live) ['player', 'ai'].forEach((s, i) => {
        for (const jt of [rally.pendingJutsu, rally.jutsu]) if (jt && jt.by === s && !firedNow[i]) firedNow[i] = jt.id;
        if (rally.fired[s] && !firedNow[i]) firedNow[i] = 'other';
      });
      if (match.state === 'pointOver' && prev !== 'pointOver') {
        Q.points++;
        const w = match.stats.pointsWon[0] > before[0] ? 0 : 1;
        for (const i of [0, 1]) if (firedNow[i]) { Q.fired[i]++; if (clutch) Q.clutchFired[i]++; const e = Q.by[i][firedNow[i]] ||= [0, 0]; e[0]++; if (w === i) e[1]++; }
      }
      if (match.state === 'matchOver') {
        Q.pts[0] += match.stats.pointsWon[0]; Q.pts[1] += match.stats.pointsWon[1];
        Q.games[0] += match.games[0]; Q.games[1] += match.games[1];
        newMatch(); match.gamesToWin = 2; setIq(); prev = '';
      }
    }
    const tot = Q.pts[0] + Q.pts[1] || 1, g = Q.games[0] + Q.games[1] || 1;
    return { simMin: +(steps / 240 / 60).toFixed(1), points: Q.points, playerPts: +(Q.pts[0] / tot).toFixed(3), playerGames: +(Q.games[0] / g).toFixed(3), games: Q.games,
      jutsuPerPt: Q.fired.map(f => +(f / Q.points).toFixed(3)), clutchFired: Q.clutchFired, by: Q.by };
  }
  const by = {};
  for (const k in R.by) by[k] = { n: R.by[k][0], rate: +(R.by[k][1] / R.by[k][0]).toFixed(2) };
  return { steps, simMin: +(steps / 240 / 60).toFixed(1), points: R.points, none: { n: R.none[0], rate: +(R.none[1] / Math.max(1, R.none[0])).toFixed(2) }, by };
}
