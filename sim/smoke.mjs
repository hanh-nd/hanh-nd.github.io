// Smoke test of the modes the bot sim doesn't play: CPU vs CPU (watch), 2v2, and a 1v1 through the
// real menus' start path. Steps the game headlessly and reports page errors and how far each got.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(process.env.SIM_URL || 'http://localhost:8765/index.html');
await page.waitForFunction(() => window.PingPong && window.PingPong.test);
const out = await page.evaluate(() => {
  const P = PingPong, T = P.test, dt = 1 / 240, res = {};
  const run = (secs) => { for (let i = 0; i < secs * 240 && P.match.state !== 'matchOver'; i++) {
    if (P.match.state === 'serve' && T.youServe()) T.beginToss('player', 0.4);   // you serve; you never return
    T.fixedUpdate(dt);
  } };
  // CPU vs CPU: a World Championship match watched (both ends bots, Hard).
  P.newTournament('world');
  const t = P.tour;
  for (const e of t.entrants) if (e.level) e.level = 'hard';
  P.watchTourMatch(0, 0); P.match.paused = true;
  run(900);
  res.watch = { state: P.match.state, games: [...P.match.games], pts: [...P.match.stats.pointsWon], cpuSmashes: P.match.stats.cpuSmashes, aiAnti: P.ai.adapt.anti, nearAnti: P.nearAI.adapt.anti };
  // 2v2 (you + ally vs two CPUs): you never hit, so points go by — checks the 4-bot paths.
  P.match.watch = null;
  P.startDuo(); P.match.paused = true;
  run(240);
  res.duo = { state: P.match.state, pts: [...P.match.stats.pointsWon], rally: P.match.stats.longestRally };
  // 1v1 Hard via the quick-match start, Mozart owner (signature serve) — you don't play.
  P.startQuick(); P.match.paused = true;
  run(120);
  res.quick = { state: P.match.state, pts: [...P.match.stats.pointsWon] };
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors');
await browser.close();
