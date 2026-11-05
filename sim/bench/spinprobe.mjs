// What spin reaches the CPU from each bot style (DEBUG log of spinRead): node sim/bench/spinprobe.mjs POLICY
import { readFileSync } from 'node:fs';
import { launch, gameUrl } from '../browser.mjs';
const browser = await launch(); const page = await browser.newPage();
await page.goto(gameUrl()); await page.waitForFunction(() => window.PingPong && window.PingPong.test);
await page.evaluate(readFileSync(new URL('../bot.js', import.meta.url), 'utf8'));
const pol = process.argv[2] || 'spin';
const r = await page.evaluate(pol => { window.PingPong.debug.on = true; window.PingPong.debug.log.length = 0;
  window.runSim({ policy: pol, matches: 3, level: 'hard', human: { reaction: 0.15, posErr: 0.025, timeErr: 0.012, takeDepth: pol === 'chop' ? 2.4 : 1.9, take: pol === 'chop' ? 'drop' : undefined } });
  return window.PingPong.debug.log.filter(e => e.spin); }, pol);
const q = a => { a.sort((x, y) => x - y); return [0.1, 0.25, 0.5, 0.75, 0.9].map(f => a[Math.floor(f * (a.length - 1))]); };
console.log(pol, 'n', r.length, 'top q', q(r.map(e => e.top)), 'side q', q(r.map(e => e.side)));
await browser.close();
