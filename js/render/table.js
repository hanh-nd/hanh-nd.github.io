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

function buildTable() {
  const { width: W, length: L, height: H, thickness: T } = TABLE;
  const g = new THREE.Group();

  g.add(box(W, T, L, std(COLORS.table, { roughness: 0.45 }), 0, H - T / 2, 0));

  // White lines: two side lines, two end lines, center line (doubles line).
  const lineMat = std(0xffffff, { roughness: 0.5 });
  const lw = TABLE.lineWidth, ly = H + 0.0008;
  g.add(box(lw, 0.0015, L, lineMat, -(W / 2 - lw / 2), ly, 0, false));
  g.add(box(lw, 0.0015, L, lineMat, (W / 2 - lw / 2), ly, 0, false));
  g.add(box(W, 0.0015, lw, lineMat, 0, ly, -(L / 2 - lw / 2), false));
  g.add(box(W, 0.0015, lw, lineMat, 0, ly, (L / 2 - lw / 2), false));
  g.add(box(0.004, 0.0015, L, lineMat, 0, ly, 0, false));

  // Legs and under-frame.
  const metal = std(0x2d3138, { metalness: 0.5, roughness: 0.4 });
  const legH = H - T;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, legH, 0.05, metal, sx * (W / 2 - 0.12), legH / 2, sz * (L / 2 - 0.25)));
  for (const sz of [-1, 1]) g.add(box(W - 0.24, 0.04, 0.04, metal, 0, legH - 0.06, sz * (L / 2 - 0.25)));
  g.add(box(0.04, 0.04, L - 0.5, metal, 0, 0.18, 0));

  // Net: textured transparent mesh, white top tape, posts and clamps.
  const netH = TABLE.netHeight;
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(NET_HALF * 2, netH),
    new THREE.MeshStandardMaterial({ map: makeNetTexture(), transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.9 })
  );
  net.position.set(0, H + netH / 2, 0);
  net.castShadow = true;
  g.add(net);
  g.add(box(NET_HALF * 2, 0.012, 0.006, std(0xffffff), 0, NET_TOP - 0.006, 0));
  const postMat = std(0x111418, { metalness: 0.6, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, netH + 0.02, 16), postMat);
    post.position.set(sx * NET_HALF, H + (netH + 0.02) / 2, 0);
    post.castShadow = true;
    g.add(post);
    g.add(box(0.03, 0.05, 0.05, postMat, sx * (NET_HALF - 0.11), H - 0.02, 0));
    g.add(box(0.12, 0.012, 0.03, postMat, sx * (NET_HALF - 0.06), H + 0.006, 0));
  }
  scene.add(g);
}

buildTable();
setBoardText('Open');
