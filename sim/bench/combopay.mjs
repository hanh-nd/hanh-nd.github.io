// What each combo (COMBO) is worth in the sim: for your strokes that land, how often the CPU can't
// return the ball or errs on it, by combo and by the stroke that completed it ('you' vs 'mixer').
//   node sim/bench/combopay.mjs [level] ['{tune json}']
import { readFileSync } from 'node:fs';
import { launch } from '../browser.mjs';
const lv = process.argv[2] || 'medium', tune = process.argv[3] ? JSON.parse(process.argv[3]) : null;
const b = await launch();
const F = { real: true, sens: 2, reaction: 0.22, posErr: 0.055, timeErr: 0.015, smashV: 8, smashSl: [8, 15], smashDur: 0.25, smashZ: 1.6, sideSl: [10, 15], sideV: [2, 5], sideDur: 0.15, driveV: [3, 7] };
const res = await Promise.all(['you', 'mixer'].map(async pol => {
  const page = await b.newPage(); page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:8765/index.html?log'); await page.waitForFunction(() => window.PingPong && window.PingPong.test);
  await page.evaluate(readFileSync('sim/bot.js', 'utf8'));
  return page.evaluate(({ F, pol, lv, tune }) => { const T = PingPong.test.TLOG; T.clear();
    const H = pol === 'you' ? { ...F, take: 'drop', dropH: 0.17, takeDepth: 2.0, home: 1.6 } : { ...F, takeDepth: 1.7, home: 1.55 };
    window.runSim({ policy: pol, matches: 30, level: lv, human: H, tune });
    const S = {};
    for (const m of T.data.matches) for (const p of m.points) for (let i = 0; i < p.hits.length; i++) {
      const h = p.hits[i]; if (h.who !== 'you' || h.serve) continue;
      const lands = h.land && h.land.table && h.land.z < 0;
      if (!lands) continue;
      const n = p.hits[i + 1], cpuFail = !n || n.who !== 'cpu' ? 1 : 0;   // the CPU never got it back
      const nn = n && n.who === 'cpu' ? n : null, cpuBad = nn && (nn.err || nn.kind === 'popup') ? 1 : 0;
      const st = (h.stroke || '?').includes('side') ? 'side' : (h.stroke || '?').split('+')[0].replace('(late)', ''); const keys = [st, ...(h.combo ? h.combo.split('+').map(c => 'C:' + c + ':' + st) : ['C:none:' + (st === 'smash' ? 'smash' : 'other')]), ...(h.setKill ? ['C:setKill'] : [])];
      for (const k of keys) { const s = S[k] ||= [0, 0, 0]; s[0]++; s[1] += cpuFail; s[2] += cpuBad; }
    }
    return { pol, S };
  }, { F, pol, lv, tune });
}));
for (const { pol, S } of res) { console.log(pol); for (const [k, [n, f, bad]] of Object.entries(S).sort()) console.log(`  ${k.padEnd(14)} n=${String(n).padStart(4)}  CPU can't return ${(f / n).toFixed(2)}  CPU errs/pops ${(bad / n).toFixed(2)}`); }
await b.close();
