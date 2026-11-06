// Microbench: your smash — how often it lands, by contact height, incoming pace and spin.
//   node sim/bench/smash.mjs ['{"AIM":{...}}' tune]
import { launch, gameUrl } from '../browser.mjs';
const tune = process.argv[2] ? JSON.parse(process.argv[2]) : null;
const browser = await launch(); const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(gameUrl()); await page.waitForFunction(() => window.PingPong && window.PingPong.test);
const out = await page.evaluate((tune) => {
  const P = window.PingPong, T = P.test, TT = 0.76, { ball, rally, match, swing } = P;
  if (tune) for (const k in tune) Object.assign(T[k], tune[k]);
  T.setOpponent({ ...T.ROSTER[0], level: 'hard' }); P.startMatch(); match.paused = true;
  const rows = [];
  for (const h of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.55]) {
    const row = { h };
    for (const [name, sp, top] of [['slow', 4, 40], ['mid', 7, 80], ['chop', 5, -110]]) {
      let ok = 0, N = 150;
      for (let k = 0; k < N; k++) {
        Object.assign(ball.p, { x: 0.2, y: TT + h, z: 1.7 }); Object.assign(ball.v, { x: 0, y: -0.3, z: sp });
        const w = { x: top, y: 0, z: 0 };
        Object.assign(ball.w, w); rally.shotW = w; rally.lastHitTime = P.simTime; rally.shotBounces = 0; rally.botShot = null;
        Object.assign(P.player.pos, { x: 0.2, y: TT + h, z: 1.7 }); P.input.tilt = 0;
        Object.assign(swing, { vx: 0.5, vf: 3.4, peak: 3.4, peakAt: P.simTime, sl: 0, sf: 3.4, strokeAt: P.simTime });
        T.playerHit(0.02);
        const land = T.simulate({ p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } }, 3, (b, ev) => ev.floor ? 'out' : ev.table ? (ev.table.z < 0 && Math.abs(ev.table.x) <= 0.7625 ? 'in' : 'out') : undefined);
        if (land === 'in') ok++;
      }
      row[name] = +(ok / N).toFixed(2);
    }
    rows.push(row);
  }
  return rows;
}, tune);
for (const r of out) console.log(JSON.stringify(r));
await browser.close();
