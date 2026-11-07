// The table, the net and the scoreboard around the court.
import * as THREE from 'three';
import { COLORS, TABLE } from '../config.js';
import { NET_HALF, NET_TOP } from '../physics.js';
import { scene } from './scene.js';

/* =====================================================================
   TABLE — floor, table top, lines, legs, net and posts
   ===================================================================== */
export function std(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts }); }
export function box(w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

/** Advertising boards: one canvas, drawn by setBoardText, shared by every board texture. */
const boardCanvas = document.createElement('canvas');
boardCanvas.width = 1024; boardCanvas.height = 100;
const boardTextures = [];
export function boardMaterial(repeat) {
  const tex = new THREE.CanvasTexture(boardCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(repeat, 1);
  boardTextures.push(tex);
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.7 });
}
export function setBoardText(title) {
  const g = boardCanvas.getContext('2d'), W = boardCanvas.width, H = boardCanvas.height;
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#0f2a4d'); grad.addColorStop(0.5, '#173a66'); grad.addColorStop(1, '#0f2a4d');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.font = '900 46px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  const parts = [[title.toUpperCase(), '#ffffff'], ['  ●  ', '#ffd23f'], ['PING PONG 3D', '#ff4d5e'], ['  ●  ', '#ffd23f']];
  let x = 18;
  while (x < W) for (const [t, c] of parts) { g.fillStyle = c; g.fillText(t, x, H / 2 + 2); x += g.measureText(t).width; }
  for (const t of boardTextures) t.needsUpdate = true;
}

function makeNetTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(240,240,240,0.95)';
  g.lineWidth = 1;
  for (let x = 0.5; x <= 256; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 32); g.stroke(); }
  for (let y = 0.5; y <= 32; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** How each table looks (TABLES has how it plays). Lines are white on all of them. */
const LOOKS = {
  arena: { top: COLORS.table, rough: 0.45, legs: 'steel' },
  club: { top: 0x1f5a3d, rough: 0.7, apron: 0x6b4527, legs: 'wood' },                 // old green club table, wooden edge
  pro: { top: 0x0d2f5e, rough: 0.4, apron: 0x101216, legs: 'chassis' },               // deep blue, black frame, heavy chassis
  park: { top: 0x8e9398, rough: 0.95, slab: 0.07, paint: 0x174f59, legs: 'concrete', net: 'plate' },   // concrete slab with a painted petrol-teal top (the orange ball's opposite: it pops), steel plate net
};
const tables = {};

function buildTable(key) {
  const look = LOOKS[key] || LOOKS.arena;
  const { width: W, length: L, height: H, thickness: T } = TABLE;
  const g = new THREE.Group();

  // The top (a park slab is thicker, downward: the playing surface stays at H).
  const slab = look.slab || T;
  g.add(box(W, slab, L, std(look.top, { roughness: look.rough }), 0, H - slab / 2, 0));
  if (look.paint) g.add(box(W - 0.004, 0.0006, L - 0.004, std(look.paint, { roughness: 0.8 }), 0, H + 0.0003, 0, false));   // the painted playing surface
  if (look.apron) {   // a frame round the top's edge
    const ap = std(look.apron, { roughness: 0.6 }), a = 0.012, ah = T + 0.03;
    for (const sx of [-1, 1]) g.add(box(a, ah, L + 2 * a, ap, sx * (W / 2 + a / 2), H - ah / 2 + 0.001, 0));
    for (const sz of [-1, 1]) g.add(box(W, ah, a, ap, 0, H - ah / 2 + 0.001, sz * (L / 2 + a / 2)));
  }

  // White lines: two side lines, two end lines, center line (doubles line).
  const lineMat = std(look.slab ? 0xe8e8e2 : 0xffffff, { roughness: look.slab ? 0.9 : 0.5 });
  const lw = TABLE.lineWidth, ly = H + 0.0008;
  g.add(box(lw, 0.0015, L, lineMat, -(W / 2 - lw / 2), ly, 0, false));
  g.add(box(lw, 0.0015, L, lineMat, (W / 2 - lw / 2), ly, 0, false));
  g.add(box(W, 0.0015, lw, lineMat, 0, ly, -(L / 2 - lw / 2), false));
  g.add(box(W, 0.0015, lw, lineMat, 0, ly, (L / 2 - lw / 2), false));
  g.add(box(0.004, 0.0015, L, lineMat, 0, ly, 0, false));

  // Legs.
  const legH = H - slab;
  if (look.legs === 'steel' || look.legs === 'wood') {
    const m = look.legs === 'wood' ? std(0x5a3a22, { roughness: 0.75 }) : std(0x2d3138, { metalness: 0.5, roughness: 0.4 });
    const t = look.legs === 'wood' ? 0.07 : 0.05;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(t, legH, t, m, sx * (W / 2 - 0.12), legH / 2, sz * (L / 2 - 0.25)));
    for (const sz of [-1, 1]) g.add(box(W - 0.24, 0.04, 0.04, m, 0, legH - 0.06, sz * (L / 2 - 0.25)));
    g.add(box(0.04, 0.04, L - 0.5, m, 0, 0.18, 0));
  } else if (look.legs === 'chassis') {   // two heavy black frames on wheels, one under each half
    const m = std(0x15171b, { metalness: 0.4, roughness: 0.45 }), acc = std(0x2f80ed, { roughness: 0.4, metalness: 0.3 });
    for (const sz of [-1, 1]) {
      const z = sz * L / 4;
      g.add(box(W - 0.3, 0.06, 0.08, m, 0, legH - 0.05, z));
      for (const sx of [-1, 1]) {
        g.add(box(0.08, legH - 0.1, 0.08, m, sx * (W / 2 - 0.25), legH / 2, z));
        g.add(box(0.1, 0.02, 0.7, m, sx * (W / 2 - 0.25), 0.07, z));
        for (const dz of [-0.3, 0.3]) g.add(box(0.05, 0.05, 0.05, std(0x0a0a0a), sx * (W / 2 - 0.25), 0.025, z + dz));
        g.add(box(0.084, 0.03, 0.084, acc, sx * (W / 2 - 0.25), legH * 0.6, z));
      }
    }
  } else if (look.legs === 'concrete') {   // two concrete pedestals
    const m = std(0x7d8186, { roughness: 1 });
    for (const sz of [-1, 1]) g.add(box(W * 0.55, legH, 0.22, m, 0, legH / 2, sz * L / 4));
  }

  // Net: a textured transparent mesh with a white tape, or (park) a perforated steel plate.
  const netH = TABLE.netHeight;
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(NET_HALF * 2, netH),
    look.net === 'plate'
      ? new THREE.MeshStandardMaterial({ map: makePlateTexture(), transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 })
      : new THREE.MeshStandardMaterial({ map: makeNetTexture(), transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.9 })
  );
  net.position.set(0, H + netH / 2, 0);
  net.castShadow = true;
  g.add(net);
  g.add(box(NET_HALF * 2, 0.012, 0.006, std(look.net === 'plate' ? 0x5c6168 : 0xffffff, look.net === 'plate' ? { metalness: 0.6 } : {}), 0, NET_TOP - 0.006, 0));
  const postMat = std(0x111418, { metalness: 0.6, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, netH + 0.02, 16), postMat);
    post.position.set(sx * NET_HALF, H + (netH + 0.02) / 2, 0);
    post.castShadow = true;
    g.add(post);
    g.add(box(0.03, 0.05, 0.05, postMat, sx * (NET_HALF - 0.11), H - 0.02, 0));
    g.add(box(0.12, 0.012, 0.03, postMat, sx * (NET_HALF - 0.06), H + 0.006, 0));
  }
  g.visible = false;
  scene.add(g);
  return (tables[key] = g);
}
function makePlateTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#6b7078'; g.fillRect(0, 0, 256, 32);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 4; y < 32; y += 6) for (let x = (y % 12 ? 3 : 6); x < 256; x += 6) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Show the table of that key (TABLES), built the first time. */
export let tableKey = '';
export function setTableLook(key) {
  if (!LOOKS[key]) key = 'arena';
  if (key === tableKey) return;
  const g = tables[key] || buildTable(key);
  for (const t of Object.values(tables)) t.visible = t === g;
  tableKey = key;
}

setTableLook('arena');
setBoardText('Open');
