// Racket meshes (you, the CPU, the 2v2 partners) and the bodies that carry them.
import * as THREE from 'three';
import { clamp } from '../util.js';
import { AI_COMMON, COLORS, PLAYER_CFG } from '../config.js';
import { scene } from './scene.js';
import { box, std } from './table.js';

/* =====================================================================
   RACKET — reusable factory (cylinder blade + rubber faces + handle).
   Players exist only as these floating rackets.
   ===================================================================== */
function createRacketMesh(rubberColor) {
  const group = new THREE.Group();
  const wood = std(0xc89a5b, { roughness: 0.7 });
  const front = std(rubberColor, { roughness: 0.55 });
  const back = std(new THREE.Color(rubberColor).multiplyScalar(0.6), { roughness: 0.6 });
  const R = 0.082;
  const cyl = (r, h, mat, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), mat);
    m.rotation.x = Math.PI / 2;          // cylinder axis along Z → face normal points along ±Z
    m.position.z = z;
    m.castShadow = true;
    return m;
  };
  group.add(cyl(R, 0.006, wood, 0));
  group.add(cyl(R - 0.002, 0.003, front, -0.0045));   // front rubber faces -Z (toward the opponent)
  group.add(cyl(R - 0.002, 0.003, back, 0.0045));
  const handle = box(0.03, 0.105, 0.026, wood, 0, -(R + 0.048), 0);
  const flare = box(0.04, 0.025, 0.02, wood, 0, -(R - 0.004), 0);
  const cap = box(0.034, 0.012, 0.03, front, 0, -(R + 0.104), 0);
  group.add(handle, flare, cap);
  group.scale.setScalar(1.35);   // slightly oversized so it reads well from the camera
  group.userData = { front, back };
  return group;
}

class Racket {
  constructor(owner, color, pos) {
    this.owner = owner;
    this.mesh = createRacketMesh(color);
    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.prev = this.pos.clone();
    this.last = this.pos.clone();   // position at the start of the current physics step
    this.vel = new THREE.Vector3();
    this.swing = 0;      // 1 → 0 swing animation timer
    this.tilt = 0;       // face angle, -1 open (backspin) .. +1 closed (topspin)
    // CPU tells (bots have no body, so the racket shows them): a wind-up before a pattern's key
    // shot or a signature, a pulsing glow for a signature, a lean for a sidespin serve.
    this.windTarget = 0; this.wind = 0;
    this.glowColor = null; this.glowHex = 0; this.glow = 0;
    this.lean = 0;       // blade top leans toward world +X (1) / -X (-1)
    scene.add(this.mesh);
  }
  setColor(color) {
    this.mesh.userData.front.color.set(color);
    this.mesh.userData.back.color.set(color).multiplyScalar(0.6);
  }
  /** 2v2: a racket whose turn it isn't fades out (it can't touch the ball either). */
  setGhost(on) {
    if (this.ghost === on) return;
    this.ghost = on;
    this.mesh.traverse(o => { if (o.material) { Object.assign(o.material, { transparent: on, opacity: on ? 0.25 : 1, depthWrite: !on }); o.material.needsUpdate = true; } });
  }
  /** Smoothed velocity from the last fixed step; drives power, direction and spin. */
  integrateVelocity(dt) {
    this.last.copy(this.prev);
    const inst = new THREE.Vector3().subVectors(this.pos, this.prev).divideScalar(dt);
    this.vel.lerp(inst, 1 - Math.exp(-20 * dt));
    this.prev.copy(this.pos);
  }
  /** Visual pose: position, face tilt, roll from lateral motion, swing animation. */
  updateMesh(dt, tilt) {
    this.swing = Math.max(0, this.swing - dt / 0.22);
    const s = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
    const isAI = this.owner === 'ai';
    const dir = isAI ? 1 : -1;  // forward direction along Z
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 12);
    const w = this.wind;        // wound up: pulled back, raised high, face cocked
    this.mesh.position.set(this.pos.x, this.pos.y + w * 0.12, this.pos.z + dir * (s * 0.07 - w * 0.15));
    const roll = clamp(-this.vel.x * 0.08, -0.6, 0.6) + (isAI ? 1 : -1) * this.lean * 0.7;
    const pitch = (isAI ? 1 : -1) * (tilt * 0.45 + s * 0.5 - w * 0.55);
    this.mesh.rotation.set(pitch, isAI ? Math.PI : 0, roll);
    const g = this.glowColor != null ? 0.95 + 0.3 * Math.sin(performance.now() / 85) : 0;
    this.glow += (g - this.glow) * Math.min(1, dt * 16);
    this.mesh.scale.setScalar(1.35 * (1 + 0.3 * clamp(this.glow, 0, 1)));   // a glowing racket swells too: it reads from the far end
    const em = this.mesh.userData.front.emissive;
    if (this.glowColor != null) this.glowHex = this.glowColor;   // keep the color while it fades
    em.setHex(this.glow > 0.01 ? this.glowHex : 0).multiplyScalar(this.glow);
  }
}

export const player = new Racket('player', COLORS.player, { x: 0, y: PLAYER_CFG.restY, z: 1.8 });
export const aiRacket = new Racket('ai', COLORS.ai, AI_COMMON.home);
// 2v2 partners: your CPU ally at the near end, the second CPU at the far end (hidden in 1v1).
export const allyRacket = new Racket('player', COLORS.ally, { x: -0.5, y: PLAYER_CFG.restY, z: 2.2 });
export const ai2Racket = new Racket('ai', COLORS.ai, { x: 0.5, y: AI_COMMON.home.y, z: -2.2 });
allyRacket.mesh.visible = ai2Racket.mesh.visible = false;

/** Where each player's feet are (XZ) and how fast they're moving; see moveBody. */
export const playerBody = { x: 0, z: 1.8, vx: 0, vz: 0 };
export const aiBody = { x: 0, z: AI_COMMON.home.z, vx: 0, vz: 0 };
export const allyBody = { x: -0.5, z: 2.2, vx: 0, vz: 0 }, ai2Body = { x: 0.5, z: -2.2, vx: 0, vz: 0 };
export function placeBody(body, x, z) { Object.assign(body, { x, z, vx: 0, vz: 0 }); }
