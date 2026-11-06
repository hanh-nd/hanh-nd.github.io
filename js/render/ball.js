// The ball: mesh, shadow, spin marker, trail, and the jutsu effects drawn around it.
import * as THREE from 'three';
import { clamp, rand } from '../util.js';
import { COLORS, JUTSU, PHYS, SIGNATURES } from '../config.js';
import { HALF_L, HALF_W, TABLE_TOP, makeBallState } from '../physics.js';
import { ambLight, hemiLight, scene, sun } from './scene.js';
import { std } from './table.js';
import { venue } from './venues.js';
import { turnRacket } from '../ai.js';
import { liveJutsu, rally } from '../rules.js';

/* =====================================================================
   BALL — mesh with a marker dot (to show spin), blob shadow, bounce marker
   ===================================================================== */
export const ball = makeBallState();
export const ballPrev = { ...ball.p };   // previous physics position (render interpolation + swept hits)
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(PHYS.radius, 24, 16),
  std(COLORS.ball, { roughness: 0.35, emissive: 0x2a1000 })
);
ballMesh.castShadow = true;
for (const sx of [-1, 1]) {   // two dark dots make the rotation visible
  const dot = new THREE.Mesh(new THREE.SphereGeometry(PHYS.radius * 0.3, 8, 6), std(0x5a2500));
  dot.position.set(sx * PHYS.radius * 0.82, 0, 0);
  ballMesh.add(dot);
}
scene.add(ballMesh);

// Blob shadow: always visible, gives strong depth cues on top of the shadow map.
const blob = new THREE.Mesh(
  new THREE.CircleGeometry(PHYS.radius * 1.5, 24),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
);
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

// Predicted bounce marker on the player's half (toggle with H).
export const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.03, 0.045, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false })
);
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);

// Motion trail, shown for fast balls (smashes).
export let spinShotAt = -1;   // rally.lastHitTime of your last sidespin stroke (its trail); -1: none
const TRAIL_N = 14;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 }));
trail.frustumCulled = false;
trail.visible = false;
scene.add(trail);
function updateTrail(p) {
  trailPos.copyWithin(3, 0, (TRAIL_N - 1) * 3);
  trailPos[0] = p.x; trailPos[1] = p.y; trailPos[2] = p.z;
  trailGeo.attributes.position.needsUpdate = true;
  // Fast balls (smashes) trail orange; a signature shot trails in its own color.
  const bs = rally.botShot, sig = rally.live && bs && bs.sig && rally.lastHitter === bs.by ? SIGNATURES[bs.sig] : null;
  // Your sidespin stroke trails cyan, so you can see it hook.
  const hook = rally.live && rally.lastHitter === 'player' && rally.lastHitTime === spinShotAt;
  const lj = liveJutsu(), jt = lj && !JUTSU[lj.id].decoys && JUTSU[lj.id].fx.trail !== 'none' && JUTSU[lj.id].speed ? lj : null;   // a clone leaves no trail: it would give the real ball away
  if (jt && JUTSU[jt.id].fx.trail === 'zigzag') {   // lightning: the trail crackles
    for (let i = 1; i < TRAIL_N; i++) { trailPos[i * 3] += rand(-1, 1) * 0.012; trailPos[i * 3 + 1] += rand(-1, 1) * 0.012; }
  }
  const fast = !rally.hidden && (jt || sig || hook || (rally.live && !lj && Math.hypot(ball.v.x, ball.v.y, ball.v.z) > 9.5));
  if (fast && !trail.visible) for (let i = 3; i < TRAIL_N * 3; i++) trailPos[i] = trailPos[i % 3];   // restart cleanly
  trail.material.color.setHex(jt ? JUTSU[jt.id].color : sig ? sig.color : hook ? 0x5ad1ff : 0xffb347);
  trail.visible = !!fast;
}

/** Jutsu glow around the ball: an additive sprite, one drawing per jutsu look (JUTSU.fx.aura), tinted
 *  in its color and spun. Drawn once into canvases, white on transparent. */
function auraTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), C = 64;
  const glow = (a, r = 64) => { const gr = g.createRadialGradient(C, C, 2, C, C, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.35, `rgba(255,255,255,${a * 0.45})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); };
  g.strokeStyle = g.fillStyle = 'rgba(255,255,255,.9)'; g.lineCap = 'round';
  if (kind === 'swirl') {   // Rasengan: spiral arms
    glow(1);
    for (let k = 0; k < 4; k++) { g.lineWidth = 5; g.beginPath(); for (let t = 0; t < 1; t += 0.04) { const a = k * Math.PI / 2 + t * 4.5, r = 10 + t * 48; g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r); } g.stroke(); }
  } else if (kind === 'spark') {   // Black Flash: jagged bolts
    glow(0.8, 40);
    g.lineWidth = 3;
    for (let k = 0; k < 7; k++) { let a = k * 0.9, r = 8; g.beginPath(); g.moveTo(C, C); while (r < 60) { r += 9; a += (Math.random() - 0.5) * 0.9; g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r); } g.stroke(); }
  } else if (kind === 'ring') {   // Zero-Shiki, Snake: a spinning ring with a gap
    glow(0.6, 26);
    g.lineWidth = 6; g.beginPath(); g.arc(C, C, 40, 0.4, Math.PI * 2 - 0.4); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(C, C, 52, 2.2, 2.2 + Math.PI * 1.2); g.stroke();
  } else if (kind === 'smoke') {   // Misdirection: a pale ghostly haze
    for (let k = 0; k < 7; k++) { const a = k * 0.9, x = C + Math.cos(a) * 22, y = C + Math.sin(a) * 22, gr = g.createRadialGradient(x, y, 1, x, y, 30); gr.addColorStop(0, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  } else if (kind === 'clock') {   // Time Stop: a clock face, twelve ticks and two hands
    glow(0.7, 30);
    g.lineWidth = 4; g.beginPath(); g.arc(C, C, 46, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, r0 = k % 3 ? 38 : 32; g.lineWidth = k % 3 ? 2 : 4; g.beginPath(); g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); g.lineTo(C + Math.cos(a) * 44, C + Math.sin(a) * 44); g.stroke(); }
    g.lineWidth = 4; g.beginPath(); g.moveTo(C, C); g.lineTo(C, C - 30); g.moveTo(C, C); g.lineTo(C + 20, C + 8); g.stroke();
  } else if (kind === 'eye') {   // Copy Wheel: three tomoe round a pupil
    g.lineWidth = 4; g.beginPath(); g.arc(C, C, 44, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(C, C, 10, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 3; k++) { const a = k * 2.094, x = C + Math.cos(a) * 28, y = C + Math.sin(a) * 28; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(x, y - 7); g.quadraticCurveTo(x + 14, y - 2, x + 4, y + 12); g.lineTo(x, y); g.fill(); }
  } else if (kind === 'mirror') {   // Yata Mirror: an eight-sided mirror, a bright rim and a sheen
    glow(0.35, 50);
    const oct = (r) => { g.beginPath(); for (let k = 0; k <= 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r); } };
    g.lineWidth = 6; oct(52); g.stroke();
    g.lineWidth = 2; oct(42); g.stroke();
    g.lineWidth = 5; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(C - 26, C + 10); g.lineTo(C + 6, C - 24); g.stroke(); g.globalAlpha = 1;
  } else glow(1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const AURA_TEX = {};
const auraMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const aura = new THREE.Sprite(auraMat);
aura.visible = false;
scene.add(aura);
/** One-off effects: a burst (a flat flash that grows and fades, at any point), table marks (a
 *  ripple left where a jutsu bounced), the God Hand behind a racket and the Flying Thunder God's
 *  seal under one. */
export const FX_TEX = { burst: auraTexture('glow'), ring: auraTexture('ring') };
const fxPool = [];
export function fxSprite(tex, color, x, y, z, size, life, grow = 2) {
  let f = fxPool.find(o => !o.alive);
  if (!f) { f = { s: new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })) }; scene.add(f.s); fxPool.push(f); }
  Object.assign(f, { alive: true, t: 0, life, size, grow });
  f.s.material.map = tex; f.s.material.color.setHex(color); f.s.material.needsUpdate = true;
  f.s.position.set(x, y, z); f.s.scale.setScalar(size); f.s.visible = true;
}
export const fxBurst = (x, y, z, color, size) => fxSprite(FX_TEX.burst, color, x, y, z, size, 0.35);
const markMeshes = [0, 1, 2].map(() => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: FX_TEX.ring, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return { m, t: 0, life: 0, size: 0, grow: 0 };
});
let markNext = 0;
/** A quick ring on the table where a jutsu bounced. */
export function fxMark(x, z, color) {
  const k = markMeshes[markNext++ % markMeshes.length];
  k.m.material.color.setHex(color);
  k.m.position.set(x, TABLE_TOP + 0.003, z);
  Object.assign(k, { t: 0, life: 0.45, size: 0.08, grow: 4 });
  k.m.visible = true;
}
/** God Hand: a big golden hand behind the racket of each side that has one up (and in the catch).
 *  Flying Thunder God: a spinning seal under the racket. */
function handTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath(); g.ellipse(64, 80, 30, 34, 0, 0, Math.PI * 2); g.fill();                          // palm
  [[-26, 0.5], [-10, 0.15], [7, -0.1], [23, -0.4]].forEach(([dx, a]) => {                       // fingers
    g.save(); g.translate(64 + dx, 56); g.rotate(a * 0.4); g.beginPath(); g.roundRect(-7, -44, 14, 48, 7); g.fill(); g.restore();
  });
  g.save(); g.translate(30, 86); g.rotate(-0.9); g.beginPath(); g.roundRect(-7, -30, 14, 34, 7); g.fill(); g.restore();   // thumb
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export const HAND_TEX = handTexture();
const handFx = ['player', 'ai'].map(() => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: HAND_TEX, color: JUTSU.godhand.color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.visible = false; scene.add(sp); return sp;
});
const warpFx = ['player', 'ai'].map(() => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: auraTexture('ring'), color: JUTSU.hiraishin.color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return m;
});
/** Yata Mirror: an eight-sided mirror in front of the racket while it is up (brighter, primed).
 *  Shadow Possession: a dark ring round the bound racket. */
const mirrorFx = ['player', 'ai'].map(() => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTexture('mirror'), color: JUTSU.mirror.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.visible = false; scene.add(sp); return sp;
});
const bindFx = ['player', 'ai'].map(() => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTexture('ring'), color: JUTSU.possession.color, transparent: true, opacity: 0.9, depthWrite: false }));
  sp.visible = false; scene.add(sp); return sp;
});
function updateFx(dt) {
  for (const f of fxPool) if (f.alive) {
    f.t += dt;
    const u = f.t / f.life;
    if (u >= 1) { f.alive = false; f.s.visible = false; continue; }
    f.s.scale.setScalar(f.size * (1 + u * f.grow)); f.s.material.opacity = 1 - u;
  }
  for (const k of markMeshes) if (k.m.visible) {
    k.t += dt;
    const u = k.t / k.life;
    if (u >= 1) { k.m.visible = false; continue; }
    k.m.scale.setScalar(k.size * (1 + u * k.grow)); k.m.material.opacity = (1 - u) * (k.life > 1 ? 0.9 : 1);
  }
  ['player', 'ai'].forEach((side, i) => {
    const on = rally.live && rally.hand[side], r = turnRacket(side);
    handFx[i].visible = !!on;
    if (on) { handFx[i].position.set(r.pos.x, r.pos.y + 0.12, r.pos.z + (side === 'player' ? 0.08 : -0.08)); handFx[i].scale.setScalar(0.62 + 0.03 * Math.sin(performance.now() / 160)); }
    const w = warpFx[i];
    w.visible = !!(rally.live && rally.warp[side]);
    if (w.visible) { w.position.set(r.pos.x, (Math.abs(r.pos.z) < HALF_L ? TABLE_TOP : 0) + 0.006, r.pos.z); w.scale.setScalar(0.42); w.rotation.z += dt * 3; }
    const mi = mirrorFx[i], ms = rally.live && rally.mirror[side];
    mi.visible = !!ms;
    if (ms) {
      const t = performance.now() / 1000, primed = ms === 'primed';
      mi.position.set(r.pos.x, r.pos.y + 0.04, r.pos.z + (side === 'player' ? -0.12 : 0.12));
      mi.scale.setScalar((primed ? 0.42 : 0.3) + 0.02 * Math.sin(t * 6));
      mi.material.opacity = primed ? 0.85 : 0.45;
    }
    const bf = bindFx[i];
    bf.visible = !!(rally.live && rally.bind === side);
    if (bf.visible) { bf.position.set(r.pos.x, r.pos.y + 0.04, r.pos.z); bf.scale.setScalar(0.36); bf.material.rotation -= dt * 2.5; }
  });
  document.body.classList.toggle('timestop', !!(rally.live && rally.stop));
  updateVoid(dt);
}
/** Infinite Void: the arena gives way to a starfield, the lights drop and the ball glows — deeper
 *  when it is the CPU's domain (on you). Fades in and out. */
const voidSky = (() => {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#05030f'); gr.addColorStop(0.5, '#140a3a'); gr.addColorStop(1, '#05030f');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${200 + Math.random() * 55},${200 + Math.random() * 55},255,${Math.random()})`; g.fillRect(Math.random() * 1024, Math.random() * 512, Math.random() < 0.06 ? 2 : 1, Math.random() < 0.06 ? 2 : 1); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, transparent: true, opacity: 0 }));
  m.visible = false; scene.add(m); return m;
})();
const voidState = { k: 0 };
function updateVoid(dt) {
  const target = rally.live && rally.void ? (rally.void === 'player' ? 0.75 : 1) : 0;
  voidState.k += clamp(target - voidState.k, -dt * 2.5, dt * 2.5);
  const k = voidState.k;
  if (venue) {
    const dim = 1 - k * 0.6;
    ambLight.intensity = venue.light.amb * dim; hemiLight.intensity = venue.light.hemi * dim; sun.intensity = venue.light.sun * dim;
    venue.stands.visible = k < 0.5;
    // Pull the fog in to hide the arena, but keep its start (near) in front of its end (far), past
    // the court: with near beyond far, the whole scene was fogged out — table and ball too.
    scene.fog.near = venue.fog[1] - k * (venue.fog[1] - 8);
    scene.fog.far = venue.fog[2] - k * (venue.fog[2] - 14);
  }
  voidSky.visible = k > 0.01; voidSky.material.opacity = k;
  ballMesh.material.emissive.setHex(k > 0.01 ? 0xff7a1a : 0x2a1000); ballMesh.material.emissiveIntensity = 1 + k * 1.5;
}
/** Shadow Clone decoys: copies of the ball mesh flying their own (physical) paths, no shadow. */
export const decoys = [-1, 1].map(() => { const m = ballMesh.clone(); m.visible = false; m.castShadow = false; scene.add(m); return { mesh: m, b: null }; });
/** 2v2 serve: the half of the table the serve must land on (diagonal) glows. */
export const serveZone = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W, HALF_L),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, depthWrite: false }));
serveZone.rotation.x = -Math.PI / 2; serveZone.visible = false;
scene.add(serveZone);

export function setBall(p, v = { x: 0, y: 0, z: 0 }, w = { x: 0, y: 0, z: 0 }) {
  Object.assign(ball.p, p); Object.assign(ball.v, v); Object.assign(ball.w, w);
  Object.assign(ballPrev, ball.p);
}

const _spinQ = new THREE.Quaternion(), _axis = new THREE.Vector3();
export function renderBall(alpha, dt) {
  ballMesh.position.set(
    ballPrev.x + (ball.p.x - ballPrev.x) * alpha,
    ballPrev.y + (ball.p.y - ballPrev.y) * alpha,
    ballPrev.z + (ball.p.z - ballPrev.z) * alpha
  );
  const wm = Math.hypot(ball.w.x, ball.w.y, ball.w.z);
  if (wm > 0.01) {   // integrate visual rotation (slowed so it reads as motion, not noise)
    _axis.set(ball.w.x / wm, ball.w.y / wm, ball.w.z / wm);
    _spinQ.setFromAxisAngle(_axis, Math.min(wm * dt, 0.6));
    ballMesh.quaternion.premultiply(_spinQ);
  }
  const p = ballMesh.position;
  updateTrail(p);
  // Its jutsu's aura (none on a clone: it would give the real ball away; none while it is hidden).
  const lj = liveJutsu(), fx = lj && JUTSU[lj.id].fx, jt = lj && fx.aura !== 'none' && !rally.hidden ? lj : null;
  aura.visible = !!jt;
  if (jt) {
    aura.position.copy(p);
    aura.scale.setScalar((fx.size || 0.12) * (1 + 0.12 * Math.sin(performance.now() / 40)));
    auraMat.map = AURA_TEX[fx.aura] || (AURA_TEX[fx.aura] = auraTexture(fx.aura)); auraMat.needsUpdate = true;
    auraMat.color.setHex(JUTSU[jt.id].color);
    auraMat.rotation -= dt * (fx.spin || 4);
    if (fx.aura === 'spark' && Math.random() < 0.3) auraMat.map = AURA_TEX.spark = auraTexture('spark');   // the bolts flicker
  }
  ballMesh.scale.setScalar(jt && fx.big ? 1.5 : 1);
  ballMesh.visible = blob.visible = !rally.hidden;   // Misdirection
  updateFx(dt);
  for (const d of decoys) {
    d.mesh.visible = !!d.b;
    if (d.b) { d.mesh.position.set(d.b.p.x, d.b.p.y, d.b.p.z); d.mesh.quaternion.copy(ballMesh.quaternion); }
  }
  const overTable = Math.abs(p.x) <= HALF_W && Math.abs(p.z) <= HALF_L && p.y >= TABLE_TOP;
  const groundY = overTable ? TABLE_TOP + 0.002 : 0.004;
  const h = Math.max(0, p.y - PHYS.radius - groundY);
  blob.position.set(p.x, groundY, p.z);
  blob.scale.setScalar(1 + h * 1.6);
  blob.material.opacity = clamp(0.5 - h * 0.35, 0.08, 0.5);
}

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setSpinShotAt(v) { return (spinShotAt = v); }
