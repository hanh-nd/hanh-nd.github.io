// Headless balance runs: loads index.html in headless Chromium, injects sim/bot.js and plays
// scripted matches against the CPU through the real game code.
//   node sim/run.mjs '{"policy":"smash","matches":4,"level":"hard"}' ['{...}' ...]
// Needs a local server on :8765 (python3 -m http.server 8765) and `npm install` in sim/.
import { readFileSync } from 'node:fs';
import { launch, gameUrl } from './browser.mjs';

const runs = process.argv.slice(2).map(a => JSON.parse(a));
const browser = await launch();
const bot = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
const url = gameUrl();

await Promise.all(runs.map(async (opts, i) => {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(`[${i}] pageerror`, e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.PingPong && window.PingPong.test);
  await page.evaluate(bot);
  const t0 = Date.now();
  const r = await page.evaluate(o => window.runSim(o), opts);
  console.log(JSON.stringify({ run: opts, secs: Math.round((Date.now() - t0) / 1000), ...r }));
  await page.close();
}));
await browser.close();
