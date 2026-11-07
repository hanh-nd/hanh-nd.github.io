// The three venues (gym, arena, stadium) and their crowd.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand } from '../util.js';
import { COLORS, TABLE_OF_VENUE } from '../config.js';
import { ambLight, hemiLight, scene, sun } from './scene.js';
import { boardMaterial, box, setTableLook, std } from './table.js';
import { wind } from '../physics.js';
import { ball } from './ball.js';
import { home, match, opp } from '../rules.js';
import { $ } from '../ui/hud.js';

/* =====================================================================
   VENUES — three venues built in code, one per kind of event: 'gym'
   (Club Open, Practice), 'arena' (quick matches, Pro Tour) and 'stadium'
   (World Championship). Each is a group with a court part (floor, mat,
   barriers) and a stands part (stands, fans, roof, screens, coaches) that
   Infinite Void hides. A venue is built the first time it is shown.
   The fans are instanced and posed in the vertex shader (FAN_POSE): they
   sit, stand up and jump to cheer, raise their arms or clap, wave flags,
   and turn their heads to follow the ball. Per frame the CPU only sets a
   few uniforms (fanU). Upper tiers use flat "crowd cards" instead.
   ===================================================================== */
const geoBox = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** Merge geometries into one (one draw call). */
const mergeAll = list => mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));
const clampN = (v, m) => Math.max(-m, Math.min(m, v));
const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
const css = c => '#' + new THREE.Color(c).getHexString();
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  if (draw) draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** Paint every vertex of a geometry one colour (for vertexColors materials). */
function tint(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** Uv x of a plane: repeat `rep` times, shifted by `off` (crowd cards, LED ribbons, flags). */
function uvX(g, rep, off = 0) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep + off);
  return g;
}
const _fm = new THREE.Matrix4(), _fc = new THREE.Color(), _fv = new THREE.Vector3();

/* ---------- Fans ---------- */
const FANS = {
  shirts: [0x3a4a6b, 0x6b3a3a, 0x2f5d50, 0x8a7a5a, 0x5a5a66, 0xd9d9d9, 0x2b2b2b, 0x7d5ba6, 0xb08a3e, 0x4f7cac, 0xc9c2b0, 0xe8e4da, 0x1f3b5c],
  skin: [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd4a373],
  hair: [0x16100c, 0x2b1d12, 0x4b3020, 0x6e4a2a, 0xb88b4a, 0x9a9a9a, 0x0d0d0d],
  pants: [0x23272f, 0x2c3a58, 0x3a3a3a, 0x5c513f, 0x18191c, 0x47506a],
  caps: [0xf2f2f2, 0x1c1c1c, 0xc23a3a, 0x2a5aa8, 0xe0b040],
  capShare: 0.18, clapShare: 0.4,
};
/** Who comes, per venue: share in your colour / the rival's, and the share of those with a flag. */
const FAN_MIX = { park: { you: 0.1, rival: 0.1, flags: 0.1 }, gym: { you: 0.15, rival: 0.1, flags: 0.2 }, arena: { you: 0.25, rival: 0.15, flags: 0.4 }, stadium: { you: 0.3, rival: 0.25, flags: 0.55 } };
const fanU = {
  uTime: { value: 0 }, uWave: { value: -1 }, uAtt: { value: 0.35 }, uCheer: { value: new THREE.Vector3() },
  uBall: { value: new THREE.Vector3(0, 1, 0) }, uBallLag: { value: new THREE.Vector3(0, 1, 0) }, uFlash: { value: 0 }, uIdle: { value: 0 },
};
const crowd = { energy: 0, side: null, wave: -1, flash: 0, attendance: 0.35, cheer: new THREE.Vector3(), sets: [] };

// Per fan (instanced): aFan = phase, enthusiasm, team (0 you, 1 rival, 2 neutral), wave
// order; aFan2 = attendance threshold (present when below uAtt), style (> .6 claps, else raises arms).
// Parts are modelled around the hip, facing +z; the instance matrix places the seat.
const FAN_GLSL = /* glsl */`
attribute vec4 aFan;
attribute vec2 aFan2;
uniform float uTime, uWave, uAtt;
uniform vec3 uCheer, uBall, uBallLag;
vec3 fRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
vec3 fRotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 fRotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
`;
const FAN_POSE = /* glsl */`
  float fPh = aFan.x;
  float fC = aFan.z < .5 ? uCheer.x : aFan.z < 1.5 ? uCheer.y : uCheer.z;
  float fW = clamp(fC * aFan.y, 0., 1.);
  if (uWave >= 0.) { float d = aFan.w - mod(uWave, 1.2); fW = max(fW, exp(-d * d / .004)); }
  float fS = smoothstep(.22, .55, fW);
  float fHip = mix(.45, .86, fS) + fS * fW * .12 * abs(sin(uTime * 7.5 + fPh));
  float fRaise = smoothstep(.3, .75, fW) * (.85 + .15 * sin(uTime * 11. + fPh));
  float fSway = .035 * sin(uTime * 1.3 + fPh) * (1. - fS);
  vec3 fDir = transpose(mat3(instanceMatrix)) * (mix(uBall, uBallLag, fract(fPh * 1.7)) - (instanceMatrix * vec4(0., fHip + .66, 0., 1.)).xyz);
  float fYaw = clamp(atan(fDir.x, fDir.z), -1.1, 1.1);
  float fPitch = clamp(atan(-fDir.y, length(fDir.xz)), -.25, .45) * .7;
  float fHere = step(aFan2.x, uAtt);
`;
const FAN_SWAY = 'fP = fRotZ(fP, fSway); fN = fRotZ(fN, fSway);';
function fanArm(fore) {
  return `{ float sd = sign(fP.x); vec3 sh = vec3(sd * .19, .45, 0.), el = vec3(sd * .19, .22, 0.);
    float up0 = mix(-.22, -.06, fS), bend0 = mix(-1.3, -.3, fS), ux, uz = 0., uy = 0., bend;
    if (aFan2.y > .6) { ux = mix(up0, -1., fRaise); bend = mix(bend0, -.75, fRaise); uy = -sd * fRaise * (.35 + .2 * sin(uTime * 16. + fPh)); }
    else { ux = up0 * (1. - fRaise); uz = sd * fRaise * 2.55; bend = bend0 * (1. - fRaise) - fRaise * .6 * (.5 + .5 * sin(uTime * 11. + fPh)); }
    vec3 q = fP - sh, m = fN;
    ${fore ? 'q = (el - sh) + fRotX(fP - el, bend); m = fRotX(fN, bend);' : ''}
    fP = fRotY(fRotZ(fRotX(q, ux), uz), uy) + sh; fN = fRotY(fRotZ(fRotX(m, ux), uz), uy); }` + FAN_SWAY;
}
const FAN_PART = {
  torso: FAN_SWAY,
  // Head, hair and cap brim turn (and tilt) about the neck to follow the ball.
  head: `{ vec3 pv = vec3(0., .53, 0.); fP = fRotY(fRotX(fP - pv, fPitch), fYaw) + pv; fN = fRotY(fRotX(fN, fPitch), fYaw); }` + FAN_SWAY,
  // Upper arms and forearms (both sides in one mesh each: the side comes from x). Seated, the
  // forearms rest forward on the lap; cheering arms go up and out with a pumping elbow, or forward
  // and together (clappers).
  upper: fanArm(false),
  fore: fanArm(true),
  // Thighs swing from forward (seated) to down (standing); shins stay upright below the knee.
  legs: `{ float th = -1.5708 * (1. - fS);
    if (fP.y < -.415) { vec3 k = vec3(fP.x, -.42, 0.); fP = fRotX(k, th) + (fP - k); }
    else { fP = fRotX(fP, th); fN = fRotX(fN, th); } }`,
  // A flag in the raised right hand: it grows in as they raise it, waves, and the cloth flutters.
  flag: `{ float up = smoothstep(.08, .4, fRaise);
    if (fP.x > .02) fP.z += .07 * sin(uTime * 9. + fP.x * 10. + fPh) * fP.x * 2.2;
    float tilt = -.25 + .45 * sin(uTime * 5. + fPh);
    fP = fRotZ(fP * up, tilt); fN = fRotZ(fN, tilt);
    fP += vec3(.2, .45, 0.) + fRotZ(vec3(0., -.46, 0.), 2.55 * fRaise); }` + FAN_SWAY,
};
function fanMaterial(part, opts = {}) {
  const m = new THREE.MeshLambertMaterial(opts);
  m.onBeforeCompile = sh => {
    for (const k of ['uTime', 'uWave', 'uAtt', 'uCheer', 'uBall', 'uBallLag']) sh.uniforms[k] = fanU[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FAN_GLSL)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${FAN_POSE}\nvec3 fP = position, fN = objectNormal;\n${FAN_PART[part]}\nfP.y += fHip; fP.z -= .05; fP *= fHere;\nobjectNormal = fN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = fP;');
  };
  m.customProgramCacheKey = () => 'fan-' + part;
  return m;
}
const FAN_GEO = {
  torso: new THREE.CapsuleGeometry(0.15, 0.24, 2, 6).scale(1, 1, 0.72).translate(0, 0.25, 0),
  head: new THREE.SphereGeometry(0.1, 8, 5).scale(1, 1.12, 1).translate(0, 0.63, 0),
  hair: new THREE.SphereGeometry(0.108, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(-0.3).translate(0, 0.65, -0.01),
  brim: geoBox(0.17, 0.014, 0.12, 0, 0.69, 0.1),
  upper: mergeAll([-1, 1].map(s => geoBox(0.075, 0.25, 0.08, s * 0.19, 0.335, 0))),
  fore: mergeAll([-1, 1].map(s => geoBox(0.062, 0.25, 0.066, s * 0.19, 0.1, 0))),
  legs: mergeAll([-1, 1].flatMap(s => [geoBox(0.12, 0.44, 0.13, s * 0.085, -0.18, 0), geoBox(0.1, 0.43, 0.11, s * 0.085, -0.645, 0)])),
  flag: mergeAll([tint(geoBox(0.02, 0.8, 0.02, 0, 0.3, 0), 0x2a2a2a), tint(new THREE.PlaneGeometry(0.46, 0.3, 6, 1).translate(0.25, 0.54, 0), 0xffffff)]),
  chair: mergeAll([geoBox(0.44, 0.06, 0.4, 0, 0.42, 0.02), geoBox(0.44, 0.42, 0.05, 0, 0.66, -0.2)]),
};
const FAN_MAT = {
  torso: fanMaterial('torso'), upper: fanMaterial('upper'), fore: fanMaterial('fore'), legs: fanMaterial('legs'),
  head: fanMaterial('head'), hair: fanMaterial('head'), brim: fanMaterial('head'),
  flag: fanMaterial('flag', { vertexColors: true, side: THREE.DoubleSide }),
};
const chairMat = new THREE.MeshLambertMaterial();
const TEAM_IDX = { player: 0, ai: 1, n: 2 };

/** Fans in these seats ({ x, y, z, yaw, fill } where y is the floor under their feet). A seat may
 *  fix its team, colours, enthusiasm or wave order (coaches). */
function makeCrowd(seats, parent, mix) {
  const people = seats.map(s => {
    const r = Math.random(), team = s.team || (r < mix.you ? 'player' : r < mix.you + mix.rival ? 'ai' : 'n');
    const flag = !s.team && team !== 'n' && Math.random() < mix.flags;
    const cap = !s.team && Math.random() < FANS.capShare;
    return {
      team, flag, cap, sleeves: Math.random() < 0.55,
      shirt: s.shirt ?? (team === 'player' ? COLORS.player : team === 'ai' ? COLORS.ai : pickOf(FANS.shirts)),
      skin: pickOf(FANS.skin), hair: s.hair ?? (cap ? pickOf(FANS.caps) : pickOf(FANS.hair)), pants: s.pants ?? pickOf(FANS.pants),
      matrix: new THREE.Matrix4().makeRotationY(s.yaw).setPosition(s.x, s.y, s.z),
      a: [rand(0, 6.28), s.enth ?? rand(0.55, 1.1), TEAM_IDX[team], s.order ?? (Math.atan2(s.x, -s.z) + Math.PI / 2) / Math.PI],
      b: [s.fill ?? Math.random(), flag ? 0 : Math.random() < FANS.clapShare ? 1 : 0],
    };
  });
  const add = (part, list, color, kind) => {
    if (!list.length) return;
    const g = FAN_GEO[part].clone(), n = list.length, a = new Float32Array(n * 4), b = new Float32Array(n * 2);
    const m = new THREE.InstancedMesh(g, FAN_MAT[part], n);
    list.forEach((p, k) => { a.set(p.a, k * 4); b.set(p.b, k * 2); m.setMatrixAt(k, p.matrix); m.setColorAt(k, _fc.set(color(p))); });
    g.setAttribute('aFan', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aFan2', new THREE.InstancedBufferAttribute(b, 2));
    m.frustumCulled = false;
    parent.add(m);
    crowd.sets.push({ mesh: m, list, color, kind });
  };
  add('torso', people, p => p.shirt, 'team');
  add('upper', people, p => p.shirt, 'team');
  add('fore', people, p => (p.sleeves ? p.shirt : p.skin), 'team');
  add('legs', people, p => p.pants);
  add('head', people, p => p.skin);
  add('hair', people, p => p.hair);
  add('brim', people.filter(p => p.cap), p => p.hair);
  add('flag', people.filter(p => p.flag), p => p.shirt, 'team');
}
function addChairs(seats, parent, colorOf) {
  const m = new THREE.InstancedMesh(FAN_GEO.chair, chairMat, seats.length);
  seats.forEach((s, i) => { m.setMatrixAt(i, _fm.makeRotationY(s.yaw).setPosition(s.x, s.y, s.z)); m.setColorAt(i, _fc.set(colorOf(s)).multiplyScalar(rand(0.9, 1.05))); });
  parent.add(m);
}
/** Phone camera flashes in the crowd: a burst after big points (uFlash), a few now and then (uIdle). */
let flashMat = null;
function addFlashes(V, seats, n) {
  flashMat ||= new THREE.ShaderMaterial({
    uniforms: { uTime: fanU.uTime, uAtt: fanU.uAtt, uFlash: fanU.uFlash, uIdle: fanU.uIdle },
    vertexShader: /* glsl */`attribute vec2 aSeed; uniform float uTime, uAtt, uFlash, uIdle; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
        float ph = fract(uTime * (.35 + aSeed.x * .9) + aSeed.x * 17.);
        float on = step(ph, .05) * step(fract(aSeed.x * 31.7), max(uFlash, uIdle)) * step(aSeed.y, uAtt);
        vA = on * (1. - ph / .05);
        gl_PointSize = on * 240. / -mv.z;
      }`,
    fragmentShader: /* glsl */`varying float vA;
      void main() { float a = smoothstep(.5, 0., length(gl_PointCoord - .5)) * vA; gl_FragColor = vec4(vec3(1., .97, .92) * 4., a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const s = pickOf(seats); pos.set([s.x, s.y + 1.25, s.z], i * 3); seed.set([Math.random(), s.fill], i * 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const p = new THREE.Points(g, flashMat); p.frustumCulled = false;
  V.stands.add(p);
}
/** Crowd cards: a painted row of 36 fans, for the upper tiers. They bob when the crowd cheers and
 *  thin out with the attendance (per column). */
let cardMat = null;
function crowdCardMaterial() {
  if (cardMat) return cardMat;
  const tex = canvasTex(1024, 128, (g, W, H) => {
    const n = 36, w = W / n;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * w + rand(-3, 3), y = H * rand(0.38, 0.46);
      g.fillStyle = css(Math.random() < 0.3 ? pickOf([COLORS.player, COLORS.ai]) : pickOf(FANS.shirts));
      g.beginPath(); g.ellipse(x, y + H * 0.5, w * 0.42, H * 0.36, 0, Math.PI, 0); g.fill();
      g.fillRect(x - w * 0.42, y + H * 0.5, w * 0.84, H);
      g.fillStyle = css(pickOf(FANS.skin)); g.beginPath(); g.arc(x, y, w * 0.25, 0, 7); g.fill();
      g.fillStyle = css(pickOf(FANS.hair)); g.beginPath(); g.arc(x, y - 1, w * 0.27, Math.PI * 1.02, Math.PI * 1.98); g.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  cardMat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
  cardMat.onBeforeCompile = sh => {
    for (const k of ['uTime', 'uAtt', 'uCheer']) sh.uniforms[k] = fanU[k];
    sh.fragmentShader = 'uniform float uTime, uAtt;\nuniform vec3 uCheer;\n' + sh.fragmentShader.replace('#include <map_fragment>', /* glsl */`
      { vec2 uv = vMapUv; float h = fract(sin(floor(uv.x * 36.) * 12.9898 + 4.1) * 43758.5453);
        if (fract(h * 7.31) > uAtt * 1.05) discard;
        uv.y -= uCheer.z * h * .22 * abs(sin(uTime * 7.5 + h * 6.28));
        diffuseColor *= texture2D(map, uv); }`);
  };
  return cardMat;
}

/* ---------- Screens, banners ---------- */
// The big screens (score) and the fans' banners are canvases shared by
// every venue; drawScreens / drawBanners repaint them.
const screenTex = canvasTex(512, 256);
const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.5, 1.5, 1.5), fog: false });
const bannerTex = [0, 1].map(() => canvasTex(512, 128));
const VENUE_LABEL = { park: 'Riverside Park', gym: 'City TT Club', arena: 'Ping Pong 3D Arena', stadium: 'World Championship' };
let screenKey = '';
function fitText(g, text, maxW, size, weight = 900) {
  do g.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`; while (g.measureText(text).width > maxW && (size -= 2) > 12);
}
export function drawScreens() {
  const strip = s => s.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim().toUpperCase();
  const menu = match.state === 'menu', label = menu ? (venue ? VENUE_LABEL[venue.key] : '') : $('sb-head').textContent;
  const rows = [[strip($('you-name').textContent), match.games[0], match.points[0], match.doubles ? COLORS.player : home.color],
                [strip($('opp-name').textContent), match.games[1], match.points[1], match.doubles ? COLORS.ai : opp.color]];
  const key = JSON.stringify([menu, label, rows]);
  if (key === screenKey) return;
  screenKey = key;
  const g = screenTex.image.getContext('2d');
  g.fillStyle = '#04060b'; g.fillRect(0, 0, 512, 256);
  g.textBaseline = 'middle';
  if (menu) {
    g.textAlign = 'center';
    g.fillStyle = '#ffd23f'; fitText(g, 'PING PONG 3D', 470, 66); g.fillText('PING PONG 3D', 256, 112);
    g.fillStyle = '#ff4d5e'; fitText(g, label.toUpperCase(), 470, 28, 800); g.fillText(label.toUpperCase(), 256, 170);
  } else {
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 512, 46);
    g.fillStyle = '#10131a'; g.textAlign = 'left'; fitText(g, label.toUpperCase(), 480, 26); g.fillText(label.toUpperCase(), 16, 24);
    rows.forEach(([name, games, pts, color], i) => {
      const y = 98 + i * 90;
      g.fillStyle = css(color); g.fillRect(16, y - 30, 12, 60);
      g.fillStyle = '#ffffff'; g.textAlign = 'left'; fitText(g, name, 290, 40); g.fillText(name, 42, y);
      g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(340, y - 30, 56, 60);
      g.fillStyle = '#c9d1dc'; g.textAlign = 'center'; fitText(g, String(games), 50, 36, 800); g.fillText(games, 368, y + 2);
      g.fillStyle = '#ffd23f'; fitText(g, String(pts), 90, 58); g.fillText(pts, 458, y + 3);
    });
  }
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let y = 0; y < 256; y += 3) g.fillRect(0, y, 512, 1);   // LED rows
  screenTex.needsUpdate = true;
}
/** Home-made banners on the stands: one for each side, in its colour. */
export function drawBanners() {
  const you = home.short === 'You';
  [[you ? 'YOU GOT THIS!' : `GO ${home.short.toUpperCase()}!`, home.color], [opp.short === 'CPU' ? "LET'S GO!" : `GO ${opp.short.toUpperCase()}!`, opp.color]].forEach(([text, color], k) => {
    const g = bannerTex[k].image.getContext('2d');
    g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = css(color); g.lineWidth = 10; g.strokeRect(9, 9, 494, 110);
    g.fillStyle = css(color); g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, text, 460, 64); g.font = 'italic ' + g.font; g.fillText(text, 256, 68);
    bannerTex[k].needsUpdate = true;
  });
}

/* ---------- Building blocks ---------- */
const VENUES = {};
export let venue = null;
export const VENUE_OF_TIER = { club: 'gym', pro: 'arena', world: 'stadium' };
function newVenue(key, c) {
  const V = { key, root: new THREE.Group(), court: new THREE.Group(), stands: new THREE.Group(), parts: {},
    mats: {
      metal: std(0x2a2e36, { metalness: 0.6, roughness: 0.4 }), dark: std(0x15181e, { roughness: 0.7 }), towel: std(0xf2f2f2, { roughness: 1 }),
      screen: screenMat, banner0: std(0xffffff, { map: bannerTex[0], roughness: 0.9 }), banner1: std(0xffffff, { map: bannerTex[1], roughness: 0.9 }),
      ...c.mats,
    },
    bg: c.bg, fog: c.fog, light: c.light, idle: c.idle, tick: null };
  V.root.add(V.court, V.stands); V.root.visible = false;
  scene.add(V.root);
  VENUES[key] = V;
  return V;
}
const putPart = (V, key, g) => (V.parts[key] ||= []).push(g);
/** Merge each kind of part into one mesh. */
function finishParts(V) {
  for (const [key, list] of Object.entries(V.parts)) V.stands.add(new THREE.Mesh(mergeAll(list), V.mats[key]));
  V.parts = {};
}
/** Floor, the playing area's mat and the advertising barriers around it. */
function addCourt(V, c) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(c.floorW || 90, c.floorD || 90), c.floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(7, 12), std(c.mat, { roughness: 0.9 }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.002; mat.receiveShadow = true;
  V.court.add(floor, mat);
  const endMat = boardMaterial(1), sideMat = boardMaterial(12 / 7);
  for (const z of [-6, 6]) V.court.add(box(7, 0.7, 0.05, endMat, 0, 0.35, z));
  for (const x of [-3.5, 3.5]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.7), sideMat);
    b.position.set(x * 0.993, 0.35, 0); b.rotation.y = -Math.sign(x) * Math.PI / 2;
    V.court.add(b, box(0.05, 0.7, 12, std(0x10141c), x, 0.35, 0));
  }
}
/** A raked stand: rows along local x, row 0 at the front (local z = 0), rising backwards (-z). It is
 *  turned by `yaw` and moved to (x, z); seats face local +z. With `cards`, the rows are crowd cards
 *  instead of seats and fans. Parts go to V.parts, seats to `seats`. */
function addStand(V, seats, o) {
  const { x = 0, z = 0, yaw = 0, width, rows, depth = 0.85, rise = 0.42, base = 0.6, gap = 0.56, aisle = 12 } = o;
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  const put = (key, g) => putPart(V, key, g.applyMatrix4(m));
  const n = Math.floor(width / gap);
  for (let r = 0; r < rows; r++) {
    const top = base + r * rise, rz = -r * depth;
    put(o.stepKey || 'step', geoBox(width, top, depth, 0, top / 2, rz));
    if (o.bench) put('bench', geoBox(width, 0.05, 0.3, 0, top + 0.42, rz + 0.02));
    if (o.cards) {
      put('cards', uvX(new THREE.PlaneGeometry(width, 0.95).translate(0, top + 0.8, rz - 0.05), width / (36 * gap), Math.random() * 8));
      put('strip', geoBox(width, 0.42, 0.42, 0, top + 0.21, rz - 0.14));
      continue;
    }
    for (let i = 0; i < n; i++) {
      const lx = -width / 2 + gap * (i + 0.5);
      if (aisle && i % aisle === aisle >> 1) { if (!o.bench) put('aisle', geoBox(gap * 0.92, 0.03, depth + 0.01, lx, top + 0.015, rz)); continue; }
      _fv.set(lx + rand(-0.03, 0.03), top, rz).applyMatrix4(m);
      seats.push({ x: _fv.x, y: _fv.y, z: _fv.z, yaw, row: r, fill: Math.random() * 0.75 + r * 0.03 + Math.abs(lx) / width * 0.15 });
    }
  }
  const front = depth / 2 + 0.05;
  if (o.fascia !== false) put(o.fasciaKey || 'fascia', geoBox(width, base + 0.5, 0.1, 0, (base + 0.5) / 2, front));
  if (o.led) put('led', uvX(new THREE.PlaneGeometry(width, o.led).translate(0, base + 0.45 - o.led / 2, front + 0.055), width / o.led / 10.24));
  if (o.wall) put('wall', geoBox(width + 2, o.wall, 0.3, 0, o.wall / 2, -(rows - 0.5) * depth - 0.15));
  for (const b of o.banners || []) put('banner' + b.k, new THREE.PlaneGeometry(2.1, 0.56).rotateZ(rand(-0.035, 0.035)).translate(b.at * width / 2, base + 0.17, front + 0.06));
}
/** Towel boxes at the court's corners and a coach's chair for each side. Returns the coaches' seats
 *  (they stand and cheer for their player). */
function addOfficials(V) {
  const put = (k, g) => putPart(V, k, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bx = sx * 3.05, bz = sz * 5.45;
    put('dark', geoBox(0.38, 0.55, 0.3, bx, 0.275, bz));
    put('towel', geoBox(0.34, 0.03, 0.32, bx, 0.565, bz));
    put('towel', geoBox(0.34, 0.22, 0.02, bx, 0.47, bz + sz * 0.16));
  }
  const coaches = [-0.9, -3.1].map((z, i) => ({ x: 4.8, y: 0, z, yaw: -Math.PI / 2, team: i ? 'ai' : 'player', fill: -1, enth: 1.3, order: -9 }));
  addChairs(coaches, V.stands, () => 0x23262d);
  return coaches;
}

/* ---------- The venues ---------- */
const VENUE_CFG = {
  gym: { bg: 0xc9ccd0, fog: [0xc9ccd0, 30, 80], light: { amb: 0.5, hemi: 0.65, sun: 2.3 }, idle: 0,
    mats: {
      bleacher: std(0x8e6238, { roughness: 0.75 }), bench: std(0xc08850, { roughness: 0.6 }), fascia: std(0x2d5b8c, { roughness: 0.8 }),
      wallUp: std(0xe4ddcc, { roughness: 0.95 }), wallLow: std(0x2d5b8c, { roughness: 0.9 }), ceiling: std(0xc9ccd0, { roughness: 1 }),
      steel: std(0x50565f, { metalness: 0.5, roughness: 0.5 }), tube: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.3) }),
      window: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 1.0, 1.25) }), board: std(0xf4f4f4, { roughness: 0.4 }),
      boardLine: std(0xd0382b), rim: std(0xe0601c, { metalness: 0.4, roughness: 0.4 }),
      net: new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 }),
      tableTop: std(COLORS.table, { roughness: 0.45 }),
    } },
  park: { bg: 0x9cc4e4, fog: [0xb9d3e6, 26, 70], light: { amb: 0.6, hemi: 0.9, sun: 2.8 }, idle: 0 },
  arena: { bg: 0x141920, fog: [0x141920, 18, 50], light: { amb: 0.45, hemi: 0.6, sun: 2.3 }, idle: 0.02,
    floor: 0x262a31, mat: 0x6b2b2b, endZ: 7.3, sideX: 5.9, endRows: 10, sideRows: 6, upper: 8, roof: 17, fixY: 12,
    screen: [6.4, 3.2], screenY: 8.8, flashes: 160, seat: s => (s.row < 2 ? 0x7c1f2c : 0x203c74),
    mats: { step: std(0x2a303b, { roughness: 0.95 }), aisle: std(0x404754, { roughness: 0.9 }), strip: std(0x24427a, { roughness: 0.7 }) } },
  stadium: { bg: 0x121426, fog: [0x121426, 20, 64], light: { amb: 0.45, hemi: 0.6, sun: 2.3 }, idle: 0.06,
    floor: 0x23252f, mat: 0x5a1c2e, endZ: 7.6, sideX: 6.2, endRows: 10, sideRows: 7, upper: 10, roof: 21, fixY: 14,
    screen: [9, 4.5], screenY: 11, flashes: 260, seat: s => (s.row < 2 ? 0xb08a2a : 0x7d1a24),
    mats: { step: std(0x2a2c38, { roughness: 0.95 }), aisle: std(0x433d4c, { roughness: 0.9 }), strip: std(0x7a1e2a, { roughness: 0.7 }) } },
};
/** Arena and stadium: a lower bowl of seated fans on all four sides, an upper tier of crowd cards
 *  behind an LED ribbon, a roof with a truss and floodlights, and big screens at both ends. */
function buildBowl(key) {
  const c = VENUE_CFG[key], V = newVenue(key, c), seats = [];
  Object.assign(V.mats, {
    fascia: std(0x1e232c, { roughness: 0.6 }), wall: std(0x181c24, { roughness: 1 }), cards: crowdCardMaterial(), led: boardMaterial(1),
    roof: new THREE.MeshBasicMaterial({ color: 0x0d0f15 }), fixture: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.8) }),
  });
  addCourt(V, { floorMat: std(c.floor, { roughness: 0.9 }), mat: c.mat });
  const reach = c.sideX + c.sideRows * 0.85, endW = 2 * reach;
  const banners = [{ at: -0.3, k: 0 }, { at: 0.3, k: 1 }, { at: -0.66, k: 1 }, { at: 0.66, k: 0 }];
  for (const s of [-1, 1]) {
    // Behind you (only seen from the menus): painted crowd cards, which cost far less than fans.
    addStand(V, seats, { z: s * c.endZ, yaw: s < 0 ? 0 : Math.PI, width: endW, rows: c.endRows, banners, cards: s > 0 });
    addStand(V, seats, { x: s * c.sideX, yaw: -s * Math.PI / 2, width: 2 * c.endZ - 0.9, rows: c.sideRows, banners: banners.slice(0, 2) });
  }
  // Upper tier, on all four sides, above a concourse with an LED ribbon.
  const fz = c.endZ + c.endRows * 0.85 + 0.6, fx = reach + 0.6, uw = c.upper * 0.85;
  const ubE = 0.6 + c.endRows * 0.42 + 1.4, ubS = 0.6 + c.sideRows * 0.42 + 1.4, wall = c.roof + 1;
  for (const s of [-1, 1]) {
    addStand(V, null, { z: s * fz, yaw: s < 0 ? 0 : Math.PI, width: 2 * (fx + uw), rows: c.upper, base: ubE, cards: true, led: 0.7, wall });
    addStand(V, null, { x: s * fx, yaw: -s * Math.PI / 2, width: 2 * fz - 0.9, rows: c.upper, base: ubS, cards: true, led: 0.7, wall });
  }
  // Roof: a dark ceiling, a truss grid, and floodlights over the court.
  const span = 2 * (fz + uw) + 4, roofY = c.roof;
  putPart(V, 'roof', new THREE.PlaneGeometry(span, span).rotateX(Math.PI / 2).translate(0, roofY, 0));
  for (let k = -12; k <= 12; k += 4) {
    putPart(V, 'metal', geoBox(0.3, 0.5, span, k, roofY - 1.6, 0));
    putPart(V, 'metal', geoBox(span, 0.5, 0.3, 0, roofY - 1.6, k));
  }
  for (const x of [-2.4, 2.4]) for (const z of [-4.4, -1.6, 1.2]) {
    putPart(V, 'fixture', geoBox(0.9, 0.22, 0.9, x, c.fixY, z));
    putPart(V, 'metal', geoBox(0.05, roofY - 1.6 - c.fixY, 0.05, x, (roofY - 1.6 + c.fixY) / 2, z));
  }
  // Big screens hanging in front of each upper tier.
  for (const s of [-1, 1]) {
    const [w, h] = c.screen, sz = s * (fz - 1), hang = roofY - 1.6 - c.screenY - h / 2;
    putPart(V, 'dark', geoBox(w + 0.35, h + 0.35, 0.3, 0, c.screenY, sz + s * 0.16));
    putPart(V, 'screen', new THREE.PlaneGeometry(w, h).rotateY(s < 0 ? 0 : Math.PI).translate(0, c.screenY, sz));
    for (const hx of [-w / 3, w / 3]) putPart(V, 'metal', geoBox(0.06, hang, 0.06, hx, c.screenY + h / 2 + hang / 2, sz + s * 0.16));
  }
  addChairs(seats, V.stands, c.seat);
  addFlashes(V, seats, c.flashes);
  makeCrowd([...seats, ...addOfficials(V)], V.stands, FAN_MIX[key]);
  if (key === 'stadium') stadiumExtras(V, fz, uw, roofY);
  finishParts(V);
  return V;
}
/** World Championship: the flags of the nations hanging above the upper tier. */
function stadiumExtras(V, fz, uw, roofY) {
  const flags = [[0xc8102e, 0xffffff, 0x002395], [0x009246, 0xffffff, 0xce2b37], [0x000000, 0xdd0000, 0xffce00], [0x003893, 0xffffff, 0xcf2027],
    [0xff883e, 0xffffff, 0x009b3a], [0x0055a4, 0xffd700, 0x0055a4], [0xd52b1e, 0xffd700, 0xd52b1e], [0x002b7f, 0xfcd116, 0xce1126]];
  const tex = canvasTex(1024, 256, g => flags.forEach((f, i) => {
    const vert = i % 2 === 0;
    f.forEach((col, k) => {
      g.fillStyle = css(col);
      if (vert) g.fillRect(i * 128 + (k * 128) / 3, 0, 128 / 3 + 1, 256); else g.fillRect(i * 128, (k * 256) / 3, 128, 256 / 3 + 1);
    });
  }));
  V.mats.nations = std(0xffffff, { map: tex, roughness: 0.9, side: THREE.DoubleSide });
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
    const g = uvX(new THREE.PlaneGeometry(1.6, 3.2), 1 / 8, i / 8);
    if (s > 0) g.rotateY(Math.PI);
    putPart(V, 'nations', g.translate(-10.5 + i * 3, roofY - 4, s * (fz + uw * 0.5)));
  }
}
/** Club Open and Practice: a school sports hall — wooden floor with court lines, bleachers along the
 *  walls, basketball hoops, tube lights, high windows, folded tables in the corners. */
function buildGym() {
  const c = VENUE_CFG.gym, V = newVenue('gym', c), seats = [], W = 12, D = 16, H = 9;
  const P = (k, g) => putPart(V, k, g);
  const floor = canvasTex(2048, 2048, (g, S) => {
    const px = S / (2 * W), pz = S / (2 * D);
    g.fillStyle = '#6b4a2a'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 7) {
      let z = -Math.random() * 300;
      while (z < S) { const len = rand(120, 320); g.fillStyle = `hsl(${rand(28, 34)}, ${rand(45, 58)}%, ${rand(52, 62)}%)`; g.fillRect(x, z, 6.4, len - 1.2); z += len; }
    }
    g.save(); g.translate(S / 2, S / 2); g.scale(px, pz);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 0.06;
    g.strokeRect(-7.5, -14, 15, 28);
    g.beginPath(); g.moveTo(-7.5, 0); g.lineTo(7.5, 0); g.stroke();
    for (const s of [-1, 1]) {
      const ky = s > 0 ? 14 - 5.8 : -14;
      g.fillStyle = 'rgba(45,91,140,.55)'; g.fillRect(-2.45, ky, 4.9, 5.8); g.strokeRect(-2.45, ky, 4.9, 5.8);
      g.beginPath(); g.arc(0, s * 8.2, 1.8, 0, Math.PI * 2); g.stroke();
      // Three-point line: straight from the baseline, then the arc round the basket.
      const a = Math.asin(6.6 / 6.75), cy = s * 12.43, yEnd = cy - s * 6.75 * Math.cos(a);
      g.beginPath(); g.moveTo(-6.6, s * 14); g.lineTo(-6.6, yEnd);
      if (s > 0) g.arc(0, cy, 6.75, Math.PI + (Math.PI / 2 - a), 2 * Math.PI - (Math.PI / 2 - a));
      else g.arc(0, cy, 6.75, Math.PI - (Math.PI / 2 - a), Math.PI / 2 - a, true);
      g.lineTo(6.6, s * 14); g.stroke();
    }
    g.restore();
  });
  addCourt(V, { floorMat: new THREE.MeshStandardMaterial({ map: floor, roughness: 0.45 }), floorW: 2 * W, floorD: 2 * D, mat: 0x8a2f2f });
  // Walls (painted band below), ceiling, steel beams, tube lights, high windows.
  for (const s of [-1, 1]) {
    P('wallUp', geoBox(0.3, H, 2 * D, s * (W + 0.15), H / 2, 0)); P('wallLow', geoBox(0.32, 1.4, 2 * D, s * (W + 0.14), 0.7, 0));
    P('wallUp', geoBox(2 * W, H, 0.3, 0, H / 2, s * (D + 0.15))); P('wallLow', geoBox(2 * W, 1.4, 0.32, 0, 0.7, s * (D + 0.14)));
  }
  P('ceiling', geoBox(2 * W, 0.2, 2 * D, 0, H + 0.1, 0));
  for (let z = -D + 2; z < D; z += 4) {
    P('steel', geoBox(2 * W, 0.55, 0.22, 0, H - 0.3, z));
    for (const x of [-7.5, -2.5, 2.5, 7.5]) { P('tube', geoBox(1.5, 0.07, 0.2, x, H - 1.1, z + 2)); P('steel', geoBox(0.02, 0.5, 0.02, x, H - 0.8, z + 2)); }
  }
  for (let z = -D + 2.5; z < D - 1; z += 3.4) for (const s of [-1, 1]) P('window', geoBox(0.05, 1.7, 2.3, s * (W - 0.02), 6.4, z));
  // Hoops at both ends.
  for (const s of [-1, 1]) {
    const z = s * (D - 1.2), f = z - s * 0.03;
    P('board', geoBox(1.8, 1.05, 0.04, 0, 3.45, z));
    for (const [w, h, x, y] of [[0.59, 0.04, 0, 3.47], [0.59, 0.04, 0, 3.05], [0.04, 0.45, -0.275, 3.26], [0.04, 0.45, 0.275, 3.26]]) P('boardLine', geoBox(w, h, 0.01, x, y, f));
    P('rim', new THREE.TorusGeometry(0.23, 0.012, 6, 20).rotateX(Math.PI / 2).translate(0, 3.05, z - s * 0.3));
    P('net', new THREE.CylinderGeometry(0.23, 0.14, 0.4, 12, 2, true).translate(0, 2.84, z - s * 0.3));
    P('steel', geoBox(0.12, 0.12, 1.2, 0, 3.6, s * (D - 0.6)));
  }
  // Wall scoreboard and the club's sign on the far wall.
  P('dark', geoBox(3.5, 1.9, 0.12, 0, 5.7, -D + 0.06));
  P('screen', new THREE.PlaneGeometry(3.2, 1.6).translate(0, 5.7, -D + 0.13));
  V.mats.clubSign = std(0xffffff, { roughness: 0.8, map: canvasTex(1024, 160, (g, w, h) => {
    g.fillStyle = '#1d3f6e'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd23f'; g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'CITY TABLE TENNIS CLUB', w - 80, 86); g.fillText('CITY TABLE TENNIS CLUB', w / 2, h / 2 - 4);
  }) });
  P('clubSign', new THREE.PlaneGeometry(7, 1.1).translate(0, 7.6, -D + 0.02));
  // Folded tables in the far corners.
  for (const s of [-1, 1]) {
    const x = s * 9.4, z = -D + 0.9;
    for (const dz of [-0.06, 0.06]) P('tableTop', geoBox(1.525, 1.37, 0.03, x, 0.75 + 0.685, z + dz));
    for (const dx of [-0.6, 0.6]) P('metal', geoBox(0.04, 0.75, 0.3, x + dx, 0.375, z));
  }
  // Bleachers along both side walls and the far end; a row of chairs for the players at the far end.
  const bleacher = { depth: 0.7, rise: 0.36, base: 0.3, gap: 0.56, aisle: 0, bench: true, stepKey: 'bleacher' };
  for (const s of [-1, 1]) addStand(V, seats, { ...bleacher, x: s * 8, yaw: -s * Math.PI / 2, width: 2 * D - 6, rows: 4, banners: [{ at: -0.25, k: 0 }, { at: 0.3, k: 1 }] });
  addStand(V, seats, { ...bleacher, z: -9, width: 14, rows: 5, banners: [{ at: -0.45, k: 1 }, { at: 0.45, k: 0 }] });
  const waiting = [];
  for (let x = -5.1; x <= 5.1; x += 0.6) waiting.push({ x, y: 0, z: -7.1, yaw: 0, row: 0, fill: Math.random() * 0.6 });
  addChairs(waiting, V.stands, () => 0x2a2e36);
  makeCrowd([...seats, ...waiting, ...addOfficials(V)], V.stands, FAN_MIX.gym);
  finishParts(V);
  return V;
}

/** The park: a concrete table on a concrete pad in the grass, trees, a chain-link fence, benches
 *  with a few locals, flats behind, and a flag and blowing leaves that show the point's wind. */
function buildPark() {
  const c = VENUE_CFG.park, V = newVenue('park', c), seats = [];
  const P = (k, g) => putPart(V, k, g);
  Object.assign(V.mats, {
    concrete: std(0x9a9c9c, { roughness: 1 }), trunk: std(0x5a3d26, { roughness: 1 }),
    leaf: std(0x3f7a3a, { roughness: 0.9 }), leaf2: std(0x5c8f3c, { roughness: 0.9 }),
    fence: new THREE.MeshBasicMaterial({ color: 0x8a9096, wireframe: true, transparent: true, opacity: 0.55 }),
    post: std(0x6d737a, { metalness: 0.5, roughness: 0.5 }), wood: std(0x8a5a32, { roughness: 0.8 }),
    flats: std(0xd8c8b0, { roughness: 1, map: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#d8c8b0'; g.fillRect(0, 0, w, h);
      for (let y = 10; y < h; y += 32) for (let x = 10; x < w; x += 28) { g.fillStyle = Math.random() < 0.3 ? '#f4e2a0' : '#5d6f80'; g.fillRect(x, y, 14, 18); }
    }) }),
    flag: std(0xffffff, { roughness: 0.8, side: THREE.DoubleSide, map: canvasTex(128, 80, (g, w, h) => {
      g.fillStyle = '#e63946'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.fillRect(0, h / 3, w, h / 3);
    }) }),
  });
  // Grass (mown stripes) and the asphalt pad.
  const grass = canvasTex(1024, 1024, (g, S) => {
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#5f9a45' : '#56903f'; g.fillRect(0, i * S / 16, S, S / 16); }
    for (let i = 0; i < 9000; i++) { g.fillStyle = `hsla(${rand(85, 110)}, 45%, ${rand(28, 45)}%, .5)`; g.fillRect(Math.random() * S, Math.random() * S, 2, 3); }
  });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(6, 6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(8, 13), std(0x4a4e55, { roughness: 1 }));   // asphalt, so the concrete table stands out
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.003; pad.receiveShadow = true;
  V.court.add(floor, pad);
  // Chain-link fence round the pad's far half and behind you.
  for (const z of [-7, 7]) { P('fence', new THREE.PlaneGeometry(9, 2.4, 36, 10).translate(0, 1.2, z)); for (let x = -4.5; x <= 4.5; x += 3) P('post', geoBox(0.06, 2.5, 0.06, x, 1.25, z)); }
  // Trees.
  const tree = (x, z, s) => {
    P('trunk', new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 2.4 * s, 7).translate(x, 1.2 * s, z));
    P(Math.random() < 0.5 ? 'leaf' : 'leaf2', new THREE.IcosahedronGeometry(1.5 * s, 1).translate(x, 3.1 * s, z));
    P('leaf', new THREE.IcosahedronGeometry(1.1 * s, 1).translate(x + 0.6 * s, 3.8 * s, z - 0.3 * s));
  };
  for (const [x, z, sc] of [[-7, -9, 1.3], [-10, -3, 1.1], [8, -10, 1.4], [11, -2, 1.2], [-9, 5, 1], [9, 6, 1.1], [-3, -14, 1.5], [4, -15, 1.3], [-14, -12, 1.6], [15, -13, 1.5]]) tree(x, z, sc);
  // Flats behind the trees.
  for (const [x, z, w, h] of [[-12, -26, 10, 14], [0, -30, 12, 18], [13, -25, 9, 12], [-24, -18, 8, 10], [25, -18, 8, 11]]) P('flats', geoBox(w, h, 6, x, h / 2, z));
  // Benches at both sides, a few locals on them and standing by the fence.
  for (const sx of [-1, 1]) for (const z of [-3.2, 0.6]) {
    P('wood', geoBox(0.45, 0.05, 1.8, sx * 5.2, 0.45, z)); P('wood', geoBox(0.05, 0.4, 1.8, sx * 5.42, 0.7, z));
    for (const dz of [-0.75, 0.75]) P('concrete', geoBox(0.4, 0.43, 0.08, sx * 5.2, 0.215, z + dz));
    for (const dz of [-0.5, 0.1, 0.6]) seats.push({ x: sx * 5.25, y: 0.02, z: z + dz, yaw: sx * -Math.PI / 2, row: 0, fill: Math.random() * 0.8 });
  }
  const chairs = [];
  for (let x = -3.6; x <= 3.6; x += 0.7) chairs.push({ x, y: 0, z: -7.6, yaw: 0, row: 0, fill: Math.random() * 0.9 + 0.1 });
  addChairs(chairs, V.stands, () => 0x3a6e9a);
  // A small flip scoreboard on a post, and the flag that shows the wind.
  P('post', geoBox(0.08, 1.6, 0.08, -4.6, 0.8, -1.5)); P('dark', geoBox(1.3, 0.75, 0.08, -4.6, 1.9, -1.5));
  P('screen', new THREE.PlaneGeometry(1.2, 0.6).rotateY(Math.PI / 2).translate(-4.55, 1.9, -1.5));
  P('post', new THREE.CylinderGeometry(0.03, 0.045, 3, 8).translate(3.4, 1.5, -6.8));
  const flagGeo = new THREE.PlaneGeometry(0.9, 0.56, 12, 4).translate(0.45, -0.28, 0);
  const flag = new THREE.Mesh(flagGeo, V.mats.flag); flag.position.set(3.4, 2.92, -6.8); flag.castShadow = true;
  V.stands.add(flag);
  const flagRest = flagGeo.attributes.position.array.slice();
  // Leaves blowing with the wind (none when calm).
  const N = 70, lp = new Float32Array(N * 3), lv = [];
  for (let i = 0; i < N; i++) { lp.set([rand(-9, 9), rand(0.2, 3), rand(-8, 1)], i * 3); lv.push(rand(0.6, 1.4)); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const leaves = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0x8a6a2a, size: 0.05, sizeAttenuation: true }));
  V.stands.add(leaves);
  let sway = 0;
  V.tick = (dt, t) => {
    const ws = Math.hypot(wind.x, wind.z), k = Math.min(1, ws / 2.6);
    // The flag points downwind and flaps harder with the wind; calm, it hangs.
    const yaw = Math.atan2(-wind.z, wind.x);
    sway += (yaw - sway) * Math.min(1, dt * 3);
    flag.rotation.y = ws > 0.1 ? sway : 0;
    const a = flagGeo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = flagRest[i], f = x / 0.9;
      a[i] = x * (0.35 + 0.65 * k); a[i + 1] = flagRest[i + 1] - (1 - k) * x * 0.8;
      a[i + 2] = Math.sin(t * (4 + 6 * k) - x * 5) * f * (0.04 + 0.12 * k);
    }
    flagGeo.attributes.position.needsUpdate = true;
    leaves.visible = ws > 0.1;
    if (!leaves.visible) return;
    for (let i = 0; i < N; i++) {
      const j = i * 3, s = lv[i];
      lp[j] += wind.x * s * dt * 1.6; lp[j + 2] += wind.z * s * dt * 1.6; lp[j + 1] += Math.sin(t * 2 + i) * dt * 0.4;
      if (Math.abs(lp[j]) > 10 || lp[j + 2] < -9 || lp[j + 2] > 1.5) {   // blown out: back in on the upwind edge
        const ux = wind.x / ws, uz = wind.z / ws, r = rand(-8, 8);
        lp[j] = clampN(-ux * 9.5 - uz * r, 9.5); lp[j + 1] = rand(0.2, 3); lp[j + 2] = clampN(-uz * 5 + ux * r, 4.5) - 3.5;   // (kept away from the camera)
      }
    }
    lg.attributes.position.needsUpdate = true;
  };
  makeCrowd([...seats, ...chairs], V.stands, FAN_MIX.park);
  finishParts(V);
  return V;
}

/** Switch venue (built the first time): its stands, fog and light levels. */
export function setVenue(key) {
  if (venue && venue.key === key) return;
  venue = VENUES[key] || (key === 'gym' ? buildGym() : key === 'park' ? buildPark() : buildBowl(key));
  setTableLook(TABLE_OF_VENUE[key]);
  for (const v of Object.values(VENUES)) v.root.visible = v === venue;
  venue.stands.visible = true;
  scene.background.setHex(venue.bg);
  scene.fog.color.setHex(venue.fog[0]); scene.fog.near = venue.fog[1]; scene.fog.far = venue.fog[2];
  ambLight.intensity = venue.light.amb; hemiLight.intensity = venue.light.hemi; sun.intensity = venue.light.sun;
  fanU.uIdle.value = venue.idle;
  screenKey = '';
}
/** The venue for a mode (and tournament tier). */
export const venueFor = (mode, tier) => (mode === 'tour' ? VENUE_OF_TIER[tier] : mode === 'practice' ? 'gym' : 'arena');

/** How full the venue is (0..1). Seats fill front rows (and the middle) first. */
export function setAttendance(a) { crowd.attendance = fanU.uAtt.value = a; }
/** Each player's fans ('player' | 'ai') wear their colour (shirts, sleeves, flags). */
export function setCrowdColors(team, color) {
  for (const s of crowd.sets) {
    if (s.kind !== 'team') continue;
    s.list.forEach((p, k) => { if (p.team === team) { p.shirt = color; s.mesh.setColorAt(k, _fc.set(s.color(p))); } });
    s.mesh.instanceColor.needsUpdate = true;
  }
}
/** The crowd reacts: side = who they cheer for ('player' | 'ai' | null = everyone), amount 0..1.
 *  Big moments set off phone flashes. */
export function crowdReact(side, amount) {
  crowd.side = side;
  crowd.energy = Math.max(crowd.energy * 0.5, amount);
  if (amount >= 0.85) crowd.flash = 1.6;
}
export function startWave() { crowd.wave = 0; }
export function updateCrowd(dt, t) {
  crowd.energy *= Math.exp(-0.55 * dt);
  crowd.flash = Math.max(0, crowd.flash - dt * 0.6);
  if (crowd.wave >= 0) { crowd.wave += dt / 2.6; if (crowd.wave > 2.4) crowd.wave = -1; }
  const k = 1 - Math.exp(-7 * dt), e = crowd.energy, s = crowd.side, c = crowd.cheer;
  const fav = team => (!s || team === 'n' ? 0.75 : team === s ? 1 : 0.12);
  c.x += (e * fav('player') - c.x) * k; c.y += (e * fav('ai') - c.y) * k; c.z += (e * fav('n') - c.z) * k;
  fanU.uCheer.value.copy(c);
  fanU.uTime.value = t % 1000;
  fanU.uWave.value = crowd.wave;
  fanU.uFlash.value = Math.min(1, crowd.flash);
  fanU.uBall.value.set(ball.p.x, ball.p.y, ball.p.z);
  fanU.uBallLag.value.lerp(fanU.uBall.value, 1 - Math.exp(-2.5 * dt));
  if (venue && venue.tick) venue.tick(dt, t % 1000);
}
