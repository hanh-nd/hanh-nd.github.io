// Combos: your stroke read together with your previous one in the rally (see COMBO), and the
// style weakness that scales each one (AI_STYLES.weak).
import { COMBO } from './config.js';
import { landingOf } from './physics.js';
import { ball, spinShotAt } from './render/ball.js';
import { match, rally } from './rules.js';
import { styleCfg } from './ai.js';
import { TLOG } from './log.js';

/** Your stroke as the CPU sees it leave: pace, spin, where it will land on its side. */
function record() {
  const land = landingOf({ p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } }, false);
  const jt = rally.pendingJutsu || rally.jutsu, on = land && land.table && land.z < 0;
  const smash = !!rally.smashed, spin = spinShotAt === rally.lastHitTime, speed = Math.hypot(ball.v.x, ball.v.z);
  return { t: rally.lastHitTime, smash, spin, jutsu: !!(jt && jt.by === 'player'),
    fast: smash || speed >= COMBO.fast, soft: !smash && speed <= COMBO.soft,
    depth: on ? -land.z : null, x: on ? land.x : null };
}
const short = s => s.depth != null && s.depth < COMBO.short;
const deep = s => s.depth != null && s.depth > COMBO.deep;
const wide = s => (s.x != null && Math.abs(s.x) > COMBO.wide ? Math.sign(s.x) : 0);
const shape = s => (s.smash ? 'S' : s.spin ? 'P' : s.fast ? 'F' : s.soft ? 's' : 'm') + (s.x == null ? '?' : s.x < -0.25 ? 'L' : s.x > 0.25 ? 'R' : 'M');

/** The CPU `c` is about to read your ball: which combos it completes, each with its strength
 *  (1, × the style's weakness), or null. Also called again when a stroke is upgraded after contact
 *  (a late smash or brush): the same stroke, re-read. */
export function comboFor(c) {
  const h = rally.yourStrokes || (rally.yourStrokes = []);
  const cur = record();
  if (h.length && h[h.length - 1].t === cur.t) h[h.length - 1] = cur; else h.push(cur);
  if (h.length > COMBO.read.n) h.shift();
  if (cur.jutsu) return null;   // a jutsu is its own thing
  const prev = h.length > 1 ? h[h.length - 2] : null, weak = styleCfg(c).weak || {}, k = id => weak[id] ?? 1;
  const out = { spin: cur.spin, soft: cur.soft, ids: [] };
  const add = id => { out[id] = k(id); out.ids.push(id); };
  if (prev && !prev.jutsu && !cur.smash) {   // (a smash finishes Set & Kill only)
    if (short(prev) && deep(cur) && cur.fast) add('drawDrive');
    if (wide(prev) && wide(cur) && wide(prev) !== wide(cur)) add('runAround');
    if (!out.drawDrive && ((prev.soft && cur.fast) || (prev.fast && cur.soft))) add('changeUp');
  }
  out.setKill = k('setKill');   // (a pop-up's chance, if this is a brush; see aiHit)
  const sk = shape(cur);
  out.read = !cur.smash && h.length >= COMBO.read.n && h.every(s => shape(s) === sk && !s.jutsu);
  TLOG.amend({ combo: out.ids.join('+') || null, read: out.read ? 1 : 0 });   // (re-read after an upgrade: replaced)
  return out;
}
/** The ball the CPU just hit was a pop-up off your brush: your smash of it is steady (Set & Kill). */
export const poppedUp = () => rally.live && rally.popUpAt === rally.lastHitTime && rally.lastHitter !== 'player';
