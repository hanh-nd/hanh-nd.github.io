// Determinism check for refactors: plays a fixed set of matches with Math.random seeded and the
// page's own frame loop off, hashing the ball and both players every physics step. Two builds that
// behave the same print the same fingerprint, line for line.
//   node sim/fingerprint.mjs > a.txt; (change the code) node sim/fingerprint.mjs > b.txt; diff a.txt b.txt
//   SIM_URL=http://localhost:8765/sim/_baseline/index.html node sim/fingerprint.mjs   (an older build)
import { readFileSync } from 'node:fs';
import { launch, gameUrl } from './browser.mjs';

const bot = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
const F = { real: true, sens: 2, reaction: 0.22, posErr: 0.055, timeErr: 0.015, smashV: 8, smashSl: [8, 15], smashDur: 0.25, smashZ: 1.6, sideSl: [10, 15], sideV: [2, 5], sideDur: 0.15, driveV: [3, 7] };
const SCEN = [
  { name: 'you-medium', run: { policy: 'you', matches: 2, level: 'medium', human: { ...F, take: 'drop', dropH: 0.17, takeDepth: 2.0, home: 1.6 } } },
  { name: 'spin-hard', run: { policy: 'youSpin', matches: 2, level: 'hard', human: { ...F, takeDepth: 1.7, home: 1.55 } } },
  { name: 'block-easy', run: { policy: 'youBlock', matches: 2, level: 'easy', human: { ...F, takeDepth: 1.6, home: 1.5 } } },
  { name: 'mixed-hard', run: { policy: 'mixed', matches: 2, level: 'hard' } },
  { name: 'jutsu', run: { policy: 'mixed', matches: 2, level: 'medium', jutsu: { kit: ['clone', 'rasengan', 'samehada'], tier: 'max' } } },
  { name: 'doubles', run: { policy: 'mixed', matches: 1, level: 'medium', doubles: true } },
  { name: 'watch', watch: true },
  { name: 'log', log: true, run: { policy: 'you', matches: 1, level: 'hard', human: { ...F, take: 'drop', dropH: 0.17, takeDepth: 2.0, home: 1.6 } } },
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

const browser = await launch();
for (const sc of SCEN) {
  if (only && !only.includes(sc.name)) continue;
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    let s = 1;   // mulberry32, reseeded right before the scenario so load-time draws don't matter
    Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    window.__reseed = n => { s = n; };
    window.requestAnimationFrame = () => 0;   // no frame loop: only the sim steps the game
  });
  const url = gameUrl() + (sc.log ? (gameUrl().includes('?') ? '&log' : '?log') : '');
  await page.goto(url);
  await page.waitForFunction(() => window.PingPong && window.PingPong.test);
  await page.evaluate(bot);
  const r = await page.evaluate(sc => {
    const P = window.PingPong, T = P.test, { ball } = P;
    let h = 2166136261, steps = 0;
    const mix = v => { const x = Math.round(v * 1e6); h = Math.imul(h ^ (x & 0xffff), 16777619); h = Math.imul(h ^ (x >>> 16), 16777619); };
    const step = T.fixedUpdate;
    T.fixedUpdate = dt => {
      step(dt); steps++;
      mix(ball.p.x); mix(ball.p.y); mix(ball.p.z); mix(ball.w.x);
      mix(P.player.pos.x); mix(P.player.pos.z); if (P.ai.pos) { mix(P.ai.pos.x); mix(P.ai.pos.z); }
    };
    window.__reseed(12345);
    let out;
    if (sc.watch) {
      P.newTournament('world');
      for (const e of P.tour.entrants) if (e.level) e.level = 'hard';
      P.watchTourMatch(0, 0); P.match.paused = true;
      for (let i = 0; i < 240 * 600 && P.match.state !== 'matchOver'; i++) T.fixedUpdate(1 / 240);
      out = { state: P.match.state, games: [...P.match.games], pts: [...P.match.stats.pointsWon] };
    } else {
      const r = window.runSim(sc.run);
      out = { ptWin: r.ptWin, won: r.won, rallies: r.rallies, strokes: r.strokes, why: r.why, smashes: r.smashes, cpuSmash: r.cpuSmash, jutsu: r.jutsu };
    }
    if (sc.log) { const j = JSON.stringify(T.TLOG.data.matches.map(m => m.points)); let g = 0; for (let i = 0; i < j.length; i++) g = Math.imul(g ^ j.charCodeAt(i), 16777619); out.log = { points: T.TLOG.data.matches.reduce((a, m) => a + m.points.length, 0), chars: j.length, hash: (g >>> 0).toString(16) }; }
    return { steps, hash: (h >>> 0).toString(16), ...out };
  }, sc);
  console.log(sc.name.padEnd(11), JSON.stringify(r));
  if (errs.length) console.log(sc.name.padEnd(11), 'PAGE ERRORS', JSON.stringify([...new Set(errs)]));
  await page.close();
}
await browser.close();
