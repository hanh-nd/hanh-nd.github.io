// Microbench: your stroke from set contacts (z depth, h height, incoming speed and spin) — where it
// goes and how high it sits up on the far side. STROKE env: block (default) | drive | push.
//   node sim/bench/stroke.mjs
import { launch, gameUrl } from '../browser.mjs';
const browser = await launch(); const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(gameUrl()); await page.waitForFunction(() => window.PingPong && window.PingPong.test);
const out = await page.evaluate((stroke) => {
  const P = window.PingPong, T = P.test, TT = 0.76, { ball, rally, match, swing } = P;
  T.setOpponent({ ...T.ROSTER[0], level: 'hard' }); P.startMatch(); match.paused = true;
  const sf = { block: 0, drive: 2.5, push: -1 }[stroke];
  const rows = [];
  for (const z of [1.1, 1.3, 1.6, 2.0]) for (const h of [0.12, 0.2, 0.3, 0.45]) for (const sp of [6, 9, 13]) for (const top of [0, 130, -110]) {
    let n = 0, sumTop = 0, up = 0, vh = 0, arcs = 0, ok = 0;
    for (let k = 0; k < 8; k++) {
      Object.assign(ball.p, { x: 0.2, y: TT + h, z }); Object.assign(ball.v, { x: 0, y: -0.5, z: sp });
      const w = { x: top, y: 0, z: 0 };
      Object.assign(ball.w, w); rally.shotW = w; rally.lastHitTime = P.simTime; rally.shotBounces = 0; rally.botShot = null;
      Object.assign(P.player.pos, { x: 0.2, y: TT + h, z });
      P.input.tilt = 0;
      Object.assign(swing, { vx: 0, vf: 0, peak: 0, peakAt: -9, sl: 0, sf, strokeAt: P.simTime });
      T.playerHit(0.02);
      let bounced = false, top2 = 0, arc = 0, land = null;
      T.simulate({ p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } }, 3, (b, ev) => {
        if (ev.floor) return true;
        if (ev.table) { if (bounced) return true; bounced = true; land = { ...ev.table }; return undefined; }
        const hh = b.p.y - TT; if (!bounced) arc = Math.max(arc, hh); else { top2 = Math.max(top2, hh); if (b.v.y <= 0) return true; }
      });
      n++; vh += Math.hypot(ball.v.x, ball.v.z); arcs += arc;
      if (land && land.z < 0) { ok++; sumTop += top2; if (top2 > 0.38) up++; }
    }
    rows.push([z, h, sp, top, ok / n, vh / n, arcs / n, sumTop / Math.max(1, ok), up / Math.max(1, ok)]);
  }
  return rows;
}, process.env.STROKE || 'block');
console.log('z    h     in  spin   ok   vh   arc  bounceTop sitsUp');
for (const r of out) console.log(r.map((v, i) => i < 4 ? String(v).padStart(4) : v.toFixed(2)).join(' '));
await browser.close();
