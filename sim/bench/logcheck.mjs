// Play log (?log) check: the bot plays a match with the log on; prints what the log caught.
//   node sim/bench/logcheck.mjs [policy] [level]
import { readFileSync } from 'node:fs';
import { launch, gameUrl } from '../browser.mjs';
const [policy = 'mixed', level = 'medium'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(gameUrl().replace(/\?.*/, '') + '?log');
await page.waitForFunction(() => window.PingPong && window.PingPong.test);
await page.evaluate(() => localStorage.removeItem('pp3d.log'));
await page.evaluate(readFileSync(new URL('../bot.js', import.meta.url), 'utf8'));
await page.evaluate(o => window.runSim(o), { policy, matches: 1, level });
const out = await page.evaluate(() => {
  const L = PingPong.test.TLOG, d = L.data, m = d.matches[d.matches.length - 1], strokes = {}, cpu = {}, ends = {};
  for (const p of m.points) {
    for (const h of p.hits) {
      if (h.serve) continue;
      if (h.who === 'you') strokes[h.stroke] = (strokes[h.stroke] || 0) + 1; else cpu[h.kind] = (cpu[h.kind] || 0) + 1;
    }
    const k = `${p.end.winner}:${p.end.why}`; ends[k] = (ends[k] || 0) + 1;
  }
  const sample = m.points.find(p => p.hits.some(h => h.who === 'you' && !h.serve));
  return { on: L.on, matches: d.matches.length, points: m.points.length, kb: Math.round(L.json().length / 1024), strokes, cpu, ends,
    stored: Math.round((localStorage.getItem('pp3d.log') || '').length / 1024), samplePoint: sample };
});
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors');
await browser.close();
