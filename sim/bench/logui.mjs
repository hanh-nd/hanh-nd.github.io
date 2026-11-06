// Screenshot of the play log's tools in the pause menu at iPhone size: node sim/bench/logui.mjs out.png
import { launch, gameUrl } from '../browser.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(gameUrl().replace(/\?.*/, '') + '?log');
await page.waitForFunction(() => window.PingPong && window.PingPong.test);
await page.evaluate(() => { PingPong.startQuick(); for (let i = 0; i < 240 * 3; i++) PingPong.test.fixedUpdate(1 / 240); });
await page.evaluate(() => document.getElementById('btn-pause').click());
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2] || 'logui.png' });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
