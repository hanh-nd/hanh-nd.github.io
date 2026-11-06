// The bot plays with the play log on (?log), and the log is saved like a real one, so real and bot play
// go through the same analysis (sim/bench/logstats.py).   node sim/bench/botlog.mjs '{run opts}' out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { launch, gameUrl } from '../browser.mjs';
const opts = JSON.parse(process.argv[2]), out = process.argv[3] || 'botlog.json';
const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(gameUrl().replace(/\?.*/, '') + '?log');
await page.waitForFunction(() => window.PingPong && window.PingPong.test);
await page.evaluate(() => { localStorage.removeItem('pp3d.log'); PingPong.test.TLOG.clear(); });
await page.evaluate(readFileSync(new URL('../bot.js', import.meta.url), 'utf8'));
const r = await page.evaluate(o => window.runSim(o), opts);
const log = await page.evaluate(() => PingPong.test.TLOG.json());
writeFileSync(out, log);
console.log(JSON.stringify({ ptWin: r.ptWin, matches: r.matches }), '→', out);
await browser.close();
