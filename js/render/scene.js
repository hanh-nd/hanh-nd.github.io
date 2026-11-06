// Renderer, camera, lights, resize.
import * as THREE from 'three';
import { clamp } from '../util.js';

/* =====================================================================
   SCENE — renderer, camera, lights, resize
   ===================================================================== */
export const canvas = document.getElementById('game');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141920);
scene.fog = new THREE.Fog(0x141920, 13, 34);   // far enough to keep the stands in view

// Camera behind the player's end of the table.
const CAM_BASE = { pos: new THREE.Vector3(0, 1.85, 3.15), look: new THREE.Vector3(0, 0.76, -0.5) };
// The camera follows the player's racket sideways (pos/look) and near/far (depth), so wide and
// deep balls stay reachable and on screen. Depth following is limited (depthMin/depthMax) so the
// camera never strays too close to the table or too far back.
// Narrow (portrait) screens see less width, so the camera follows more closely and sits a little
// higher, looking further down to use the screen's height.
// Desktop (mouse) gets the phone-portrait camera height and angle — the whole table seen from
// above — with the wide screen's sideways follow.
export const CAM_FOLLOW = {
  wide:    { pos: 0.55, look: 0.35, y: 0,    z: 0,    lookY: 0,     lookZ: 0 },
  narrow:  { pos: 0.9,  look: 0.7,  y: 0.35, z: 0.15, lookY: -0.12, lookZ: 0.35 },
  desktop: { pos: 0.55, look: 0.35, y: 0.35, z: 0.15, lookY: -0.12, lookZ: 0.35, fov: 58 },
  refZ: 1.7,              // racket depth at which the camera sits at its base distance
  depth: 0.75,            // fraction of the racket's near/far movement the camera follows
  depthMin: -0.3,         // furthest the camera moves toward the table (m)
  depthMax: 0.5,          // furthest the camera moves back (m)
  depthRise: 0.25,        // camera rises this much per meter it moves back (keeps the table in view)
  lookDepth: 0.25,        // the look point shifts this fraction of the camera's depth move
  rate: 7,
};
/** Gameplay camera pose for a racket at (x, z). */
export function cameraPoseFor(x, z, outPos, outLook) {
  const f = camera.aspect < 1 ? CAM_FOLLOW.narrow : isDesktop ? CAM_FOLLOW.desktop : CAM_FOLLOW.wide;
  const dz = clamp((z - CAM_FOLLOW.refZ) * CAM_FOLLOW.depth, CAM_FOLLOW.depthMin, CAM_FOLLOW.depthMax);
  outPos.set(CAM_BASE.pos.x + x * f.pos,
             CAM_BASE.pos.y + f.y + Math.max(0, dz) * CAM_FOLLOW.depthRise,
             CAM_BASE.pos.z + f.z + dz);
  outLook.set(x * f.look, CAM_BASE.look.y + f.lookY, CAM_BASE.look.z + f.lookZ + dz * CAM_FOLLOW.lookDepth);
}
export const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.05, 60);
camera.position.copy(CAM_BASE.pos);
camera.lookAt(CAM_BASE.look);
export const camLook = CAM_BASE.look.clone();
// Copy of the gameplay camera, posed where it will settle for a given racket position;
// used to keep the racket inside the visible frame.
export const viewCam = camera.clone();
export const _vcPos = new THREE.Vector3(), _vcLook = new THREE.Vector3();

// Light levels are set per venue (setVenue).
export const ambLight = new THREE.AmbientLight(0xffffff, 0.45), hemiLight = new THREE.HemisphereLight(0xcfe0ff, 0x2a2a30, 0.6);
scene.add(ambLight, hemiLight);
export const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(1.5, 5, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 1, far: 12 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  // Widen the field of view on portrait screens so the table still fits; desktop zooms out a bit.
  const base = isDesktop ? CAM_FOLLOW.desktop.fov : 52;
  const fov = aspect < 1.2 ? Math.max(base, Math.min(85, 52 * 1.2 / aspect)) : base;
  for (const cam of [camera, viewCam]) { cam.aspect = aspect; cam.fov = fov; cam.updateProjectionMatrix(); }
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();
