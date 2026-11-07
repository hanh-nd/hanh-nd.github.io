// Ball Machine: a robot at the far end feeds you ball after ball, wave after wave (MACHINE). Every
// ball you land on its half scores, one in the lit target scores more; miss MACHINE.lives times
// and it's over. The rally rules do the judging (rules.js hands a landed return to machineScored
// and a lost ball to machineMiss); the far CPU sits out and its racket is hidden.
import * as THREE from 'three';
import { clamp, rand } from './util.js';
import { MACHINE } from './config.js';
import { HALF_L, TABLE_TOP, keepReachable, solveShot } from './physics.js';
import { scene } from './render/scene.js';
import { aiRacket, player } from './render/racket.js';
import { ball, fxBurst, marker, setBall } from './render/ball.js';
import { crowdReact } from './render/venues.js';
import { applyShot } from './strokes.js';
import { endMatch, match, rally, registerHit, schedule, setHome, setOpponent, startMatch } from './rules.js';
import { $, showMessage, store, updateHUD } from './ui/hud.js';
import { Sound } from './audio.js';

/** This run: score, lives, the wave and how far into it, times round all waves (cycle), the lit
 *  target, and the stats for the end screen. */
export const mach = { score: 0, lives: 0, wave: 0, inWave: 0, cycle: 0, zone: { x: 0, z: 0 }, side: 1, deep: false,
  returned: 0, targets: 0, streak: 0, bestStreak: 0, best: 0, fed: 0, faults: 0 };   // fed / faults: balls fed, and fed balls that didn't land (sim checks)
const BEST = 'pp3d.machineBest';

/* --- The machine and its target, built once, shown only in this mode --- */
const machine = new THREE.Group();
{
  const body = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.55, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.4, metalness: 0.2 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.34), body);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.2, 20, 1, true), trim);
  hopper.position.y = 0.23;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.26, 16), trim);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, 0.24);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.62, 10), body);
  stand.position.y = -0.44;
  machine.add(box, hopper, barrel, stand);
  machine.position.set(0, TABLE_TOP + MACHINE.mouth.y - 0.02, -(HALF_L + MACHINE.mouth.z + 0.2));
  machine.visible = false;
  scene.add(machine);
}
const target = new THREE.Mesh(new THREE.PlaneGeometry(MACHINE.zone.w, MACHINE.zone.l),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.42, depthWrite: false }));
target.rotation.x = -Math.PI / 2; target.visible = false;
scene.add(target);

/** Show or hide the machine (and the far CPU's racket, which it replaces). */
export function showMachine(on) {
  machine.visible = on;
  target.visible = on;
  aiRacket.mesh.visible = !on;
}

/** Ball Machine from the Tournament screen. Play Again goes through startMatch too. */
export function startMachine() {
  Sound.init();
  match.mode = 'machine';
  match.venue = 'gym';
  match.watch = null;
  match.doubles = false;
  match.gamesToWin = Infinity;
  setHome(null);
  setOpponent({ name: 'Ball Machine', short: 'Machine', flag: '', color: 0xff8c1a, level: 'medium', style: 'allround' });
  startMatch();
}

/** startMatch, in this mode: a fresh run, then the first ball. */
export function beginMachine() {
  Object.assign(mach, { score: 0, lives: MACHINE.lives, wave: 0, inWave: 0, cycle: 0, side: 1, deep: false,
    returned: 0, targets: 0, streak: 0, bestStreak: 0, best: store.get(BEST, 0), fed: 0, faults: 0 });
  showMachine(true);
  aiRacket.pos.set(0, -5, -3);   // (its racket is out of the way: nothing on the far side can touch the ball)
  rally.live = false;
  match.state = 'pointOver';
  match.server = 'ai';
  marker.visible = false;
  setBall({ x: 0, y: TABLE_TOP + MACHINE.mouth.y, z: -(HALF_L + MACHINE.mouth.z) });
  moveTarget();
  syncBoard();
  const w = MACHINE.waves[0];
  showMessage('Ball Machine', `Wave 1 · ${w.name} · ${w.tip}`, 'neutral', 2.2, 3);
  schedule(2.4, feed);
}

const wave = () => MACHINE.waves[mach.wave];
/** One ball's numbers: its wave's, or (a mixed wave) a random other wave's. */
function ballSpec() {
  const w = wave();
  if (!w.mix) return w;
  const pool = MACHINE.waves.filter(x => !x.mix && x.place !== 'mid');
  return pool[Math.floor(Math.random() * pool.length)];
}
/** Where on your half (z > 0) the ball lands. */
function placeFor(place) {
  if (place === 'mid') return { x: rand(-0.2, 0.2), z: rand(0.85, 1.1) };
  if (place === 'alt') { mach.side = -mach.side; return { x: mach.side * rand(0.45, 0.62), z: rand(0.8, 1.15) }; }
  if (place === 'shortLong') { mach.deep = !mach.deep; return { x: rand(-0.5, 0.5), z: mach.deep ? rand(1.02, 1.2) : rand(0.35, 0.5) }; }
  if (place === 'body') return { x: clamp(player.pos.x, -0.6, 0.6), z: rand(0.9, 1.15) };
  return { x: rand(-0.6, 0.6), z: rand(0.55, 1.15) };
}

/** The next ball: out of the barrel, aimed at your half, always reachable (keepReachable). */
function feed() {
  if (match.mode !== 'machine' || match.state === 'matchOver') return;
  const b = ballSpec(), pace = 1 + MACHINE.ramp * mach.cycle;
  const start = { x: rand(-0.12, 0.12), y: TABLE_TOP + MACHINE.mouth.y, z: -(HALF_L + MACHINE.mouth.z) };
  const aim = placeFor(b.place), top = rand(...b.top), side = b.side ? rand(...b.side) * (Math.random() < 0.5 ? -1 : 1) : 0;
  let v = rand(...b.speed) * pace, shot = null;
  for (let i = 0; i < 8; i++, v *= 0.92) {   // the pace that lands it (a slow chop may need less)
    shot = solveShot(start, aim, v, top, side);
    if (shot.land && shot.land.table && !shot.land.net && shot.land.z > 0) break;
  }
  setBall(start);
  applyShot(keepReachable(start, shot, 1));
  machine.rotation.y = Math.atan2(aim.x - start.x, aim.z - start.z) * 0.5;
  Object.assign(rally, { live: true, serveStage: 0, bounceCount: 0, netTouched: false });
  match.state = 'rally';
  mach.fed++;
  registerHit('ai', 0.45);
}

/** A new spot for the lit target on the machine's half. */
function moveTarget() {
  const Z = MACHINE.zone, pick = a => a[Math.floor(Math.random() * a.length)];
  let x, z;
  do { x = pick(Z.xs); z = pick(Z.zs); } while (x === mach.zone.x && z === mach.zone.z);
  mach.zone = { x, z };
  target.position.set(x, TABLE_TOP + 0.003, -z);
}

/** Your return landed on its half (rules.onTableBounce): score it, then the next ball. */
export function machineScored(x) {
  const z = -ball.p.z, Z = MACHINE.zone;
  const hit = Math.abs(x - mach.zone.x) <= Z.w / 2 && Math.abs(z - mach.zone.z) <= Z.l / 2;
  rally.live = false;
  match.state = 'pointOver';
  mach.returned++; mach.streak++; mach.bestStreak = Math.max(mach.bestStreak, mach.streak);
  mach.score += hit ? MACHINE.target : 1;
  if (hit) {
    mach.targets++;
    fxBurst(ball.p.x, TABLE_TOP + 0.02, ball.p.z, 0xffd23f, 0.3);
    showMessage(`Target! +${MACHINE.target}`, '', 'good', 0.8, 1);
    crowdReact('player', 0.6);
    moveTarget();
  } else if (mach.streak % 10 === 0) {
    showMessage(`${mach.streak} in a row`, '', 'good', 0.9, 1);
    crowdReact('player', 0.5);
  }
  Sound.point(true);
  let gap = wave().gap;
  if (++mach.inWave >= wave().n) gap = nextWave();
  syncBoard();
  schedule(gap / (1 + MACHINE.ramp * mach.cycle), feed);
}
/** The wave is done: the next one (after the last, round again, faster). Returns the pause before its first ball. */
function nextWave() {
  mach.inWave = 0;
  if (++mach.wave >= MACHINE.waves.length) { mach.wave = 0; mach.cycle++; }
  const w = wave(), no = mach.cycle * MACHINE.waves.length + mach.wave + 1;
  showMessage(`Wave ${no} · ${w.name}`, mach.cycle ? `${w.tip} · faster` : w.tip, 'neutral', 1.8, 2);
  crowdReact(null, 0.5);
  return 2;
}

/** A ball lost (rules.endPoint): yours costs a life; one the machine itself put out (a net clip)
 *  is just fed again. */
export function machineMiss(winner, why) {
  rally.live = false;
  match.state = 'pointOver';
  marker.visible = false;
  if (winner === 'player') { mach.faults++; return schedule(0.8, feed); }
  mach.lives--;
  mach.streak = 0;
  rally.heat = rally.heatHits = 0;
  Sound.point(false);
  syncBoard();
  if (mach.lives <= 0) return schedule(1.2, finish);
  showMessage('Missed', `${why} · ${mach.lives} ${mach.lives === 1 ? 'life' : 'lives'} left`, 'bad', 1.3, 3);
  schedule(1.6, feed);
}

/** Out of lives: keep the best, then the end screen (rules.endMatch → showEndMenu). */
function finish() {
  if (mach.score > mach.best) { mach.best = mach.score; store.set(BEST, mach.score); mach.newBest = true; } else mach.newBest = false;
  mach.waveNo = mach.cycle * MACHINE.waves.length + mach.wave + 1;
  endMatch('player');
}

/** The scorebug: your score, the lives left; the header: the wave and your best. */
function syncBoard() {
  match.points[0] = mach.score;
  match.points[1] = mach.lives;
  const no = mach.cycle * MACHINE.waves.length + mach.wave + 1;
  $('sb-head').textContent = `Ball Machine · Wave ${no} · Best ${Math.max(mach.best, mach.score)}`;
  updateHUD();
}
