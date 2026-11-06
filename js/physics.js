// Ball flight, bounces and the shot solver: pure functions on plain ball states (no Three.js).
import { clamp, randn } from './util.js';
import { AIM, PHYS, REACH, TABLE } from './config.js';

/* =====================================================================
   PHYSICS (pure functions; no Three.js, so they also run headless)
   Ball state: { p: position, v: velocity, w: angular velocity (rad/s) }
   ===================================================================== */
export const HALF_L = TABLE.length / 2, HALF_W = TABLE.width / 2;
export const TABLE_TOP = TABLE.height, NET_TOP = TABLE.height + TABLE.netHeight;
export const NET_HALF = HALF_W + TABLE.netOverhang;

export function makeBallState() {
  return { p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } };
}
function cloneBall(b) {
  return { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
}

/** Spin vector for a shot travelling horizontally along (dx, dz).
 *  top > 0 = topspin (ball dips, kicks forward), top < 0 = backspin; side spins about +Y. */
function spinVector(dx, dz, top, side) {
  // topspin axis = up × direction = (dz, 0, -dx)
  return { x: top * dz, y: side, z: -top * dx };
}

/** Advance the ball one step. Fills `ev` with { net, table, floor } collision events. */
export function stepBall(b, dt, ev) {
  const R = PHYS.radius, p = b.p, v = b.v, w = b.w;
  const speed = Math.hypot(v.x, v.y, v.z);
  const kd = PHYS.drag * speed, km = PHYS.magnus;

  // Forces: gravity + drag + Magnus (ω × v). Semi-implicit Euler.
  v.x += (-kd * v.x + km * (w.y * v.z - w.z * v.y)) * dt;
  v.y += (-PHYS.gravity - kd * v.y + km * (w.z * v.x - w.x * v.z)) * dt;
  v.z += (-kd * v.z + km * (w.x * v.y - w.y * v.x)) * dt;
  const decay = Math.max(0, 1 - PHYS.spinDecay * dt);
  w.x *= decay; w.y *= decay; w.z *= decay;

  const oy = p.y, oz = p.z;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;

  // --- Net: crossing z = 0 inside the net rectangle ---
  if ((oz > 0) !== (p.z > 0) && Math.abs(p.x) <= NET_HALF && p.y > TABLE_TOP && p.y < NET_TOP + R) {
    ev.net = true;
    if (p.y < NET_TOP) {                       // solid net: knocked back, loses most energy
      const side = oz > 0 ? 1 : -1;
      p.z = side * (R + 0.002);
      v.z = -v.z * PHYS.netDamping; v.x *= 0.5; v.y *= 0.3;
    } else {                                    // clips the tape: slows and pops up, may dribble over
      v.z *= 0.5; v.y = Math.abs(v.y) * 0.3 + 0.4;
    }
  }

  // --- Table top (only when arriving from above) ---
  if (v.y < 0 && p.y - R <= TABLE_TOP && oy - R >= TABLE_TOP - 0.02 &&
      Math.abs(p.x) <= HALF_W + R * 0.5 && Math.abs(p.z) <= HALF_L + R * 0.5) {
    p.y = TABLE_TOP + R;
    const impact = -v.y;
    // Edge ball: the ball clips the table's top edge. Legal, but it skids off low and kicks outward.
    const edge = Math.abs(p.x) > HALF_W - R * 0.3 || Math.abs(p.z) > HALF_L - R * 0.3;
    v.y = impact * (edge ? PHYS.edgeRestitution : PHYS.tableRestitution);
    // Friction at the contact point: slip u = v_t + ω × r, with r = (0, -R, 0).
    // Impulse applied to a hollow sphere (I = 2/3 m R²) couples linear and angular velocity.
    const ux = v.x + R * w.z, uz = v.z - R * w.x;
    const dvx = -ux * 0.4 * PHYS.tableGrip, dvz = -uz * 0.4 * PHYS.tableGrip;
    v.x += dvx; v.z += dvz;
    w.x += -dvz * 1.5 / R; w.z += dvx * 1.5 / R;
    if (edge) {
      if (Math.abs(p.x) > HALF_W - R * 0.3) v.x += Math.sign(p.x) * impact * PHYS.edgeKick;
      if (Math.abs(p.z) > HALF_L - R * 0.3) v.z += Math.sign(p.z) * impact * PHYS.edgeKick;
    }
    ev.table = { side: p.z >= 0 ? 'player' : 'ai', x: p.x, z: p.z, speed: impact, edge };
  }

  // --- Side of the table (below the top surface): not a legal bounce, the ball just rebounds ---
  if (p.y < TABLE_TOP && p.y > TABLE_TOP - TABLE.thickness - R) {
    const inX = Math.abs(p.x) < HALF_W + R, inZ = Math.abs(p.z) < HALF_L + R;
    if (inX && inZ) {
      const wasInX = Math.abs(p.x - v.x * dt) < HALF_W + R, wasInZ = Math.abs(oz) < HALF_L + R;
      if (!wasInX) { p.x = Math.sign(p.x) * (HALF_W + R); v.x = -v.x * 0.5; ev.side = true; }
      else if (!wasInZ) { p.z = Math.sign(p.z) * (HALF_L + R); v.z = -v.z * 0.5; ev.side = true; }
    }
  }

  // --- Floor ---
  if (p.y - R <= 0 && v.y < 0) {
    p.y = R;
    const impact = -v.y;
    v.y = impact * PHYS.floorRestitution; v.x *= 0.85; v.z *= 0.85;
    w.x *= 0.7; w.y *= 0.7; w.z *= 0.7;
    ev.floor = { speed: impact };
  }
}

/** Run a copy of the ball forward; onStep returns a value to stop early. */
export function simulate(b0, maxT, onStep) {
  const b = cloneBall(b0), ev = { net: false, table: null, floor: null, side: false };
  for (let t = 0; t < maxT; t += PHYS.dt) {
    ev.net = false; ev.table = null; ev.floor = null; ev.side = false;
    stepBall(b, PHYS.dt, ev);
    const r = onStep(b, ev, t);
    if (r !== undefined) return r;
  }
  return null;
}

/** Where the ball first lands (table or floor). For serves, skip the server-side bounce
 *  and report whether it happened (`ownBounce`). */
export function landingOf(b0, serve) {
  const startSign = Math.sign(b0.p.z);
  let skip = serve, net = false, ownBounce = false;
  return simulate(b0, 3, (b, ev) => {
    if (ev.net) net = true;
    if (ev.table) {
      if (skip && Math.sign(ev.table.z) === startSign) { skip = false; ownBounce = true; return undefined; }
      return { x: ev.table.x, z: ev.table.z, net, table: true, ownBounce };
    }
    if (ev.floor) return { x: b.p.x, z: b.p.z, net, table: false, ownBounce };
    return undefined;
  });
}

/** Signed landing distance along the shot direction. Touching the net counts as short,
 *  a serve that skips its own-side bounce counts as long — this keeps the search monotonic. */
function shotDistance(start, ux, uz, vh, vy, w, serve) {
  const land = landingOf({ p: { ...start }, v: { x: ux * vh, y: vy, z: uz * vh }, w: { ...w } }, serve);
  let s = land ? (land.x - start.x) * ux + (land.z - start.z) * uz : Infinity;
  if (land && land.net) s = -Infinity;
  else if (serve && land && !land.ownBounce) s = Infinity;
  return { s, land };
}

/** Find a launch velocity that lands the ball at `target` {x,z} with horizontal speed vh and
 *  the given spin. Bisects on vertical speed and corrects aim for Magnus/drag drift.
 *  Simulates the real physics, so drag, spin and the net are all accounted for. */
export function solveShot(start, target, vh, top, side) {
  let aimX = target.x, result = null;
  for (let iter = 0; iter < 3; iter++) {
    const dx = aimX - start.x, dz = target.z - start.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / dist, uz = dz / dist;
    const w = spinVector(ux, uz, top, side);
    let lo = -6, hi = 9, vy = 0;
    for (let i = 0; i < 24; i++) {
      vy = (lo + hi) / 2;
      if (shotDistance(start, ux, uz, vh, vy, w, false).s < dist) lo = vy; else hi = vy;
    }
    const { land } = shotDistance(start, ux, uz, vh, vy, w, false);
    result = { v: { x: ux * vh, y: vy, z: uz * vh }, w, land };
    if (!land || land.net) break;
    aimX += target.x - land.x;   // correct sideways drift and re-solve
  }
  return pushOutIfAimedOut(result, target);
}

/** Serve solver: the ball is struck downward so it bounces on the server's half first.
 *  Tries a few downward angles, bisecting on horizontal speed to reach the target depth. */
export function solveServe(start, target, top, side) {
  let best = null;
  for (const vy of [-1.5, -2, -2.5, -1, -3]) {
    let aimX = target.x, cand = null;
    for (let iter = 0; iter < 2; iter++) {
      const dx = aimX - start.x, dz = target.z - start.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const ux = dx / dist, uz = dz / dist;
      const w = spinVector(ux, uz, top, side);
      let lo = 1.5, hi = 10, vh = 4;
      for (let i = 0; i < 20; i++) {
        vh = (lo + hi) / 2;
        if (shotDistance(start, ux, uz, vh, vy, w, true).s < dist) lo = vh; else hi = vh;
      }
      const { land } = shotDistance(start, ux, uz, vh, vy, w, true);
      const err = land && !land.net && land.ownBounce ? Math.hypot(land.x - target.x, land.z - target.z) : Infinity;
      cand = { v: { x: ux * vh, y: vy, z: uz * vh }, w, land, err };
      if (!isFinite(err)) break;
      aimX += target.x - land.x;
    }
    if (!best || cand.err < best.err) best = cand;
    if (best.err < 0.04) break;
  }
  return pushOutIfAimedOut(best, target);
}

/** The searches stop at the table edge when the target lies off the table;
 *  give such deliberate "out" shots extra pace so they really miss. */
function pushOutIfAimedOut(shot, target) {
  if (Math.abs(target.z) > HALF_L || Math.abs(target.x) > HALF_W) { shot.v.x *= 1.15; shot.v.z *= 1.15; }
  return shot;
}

/** A human hand on an auto-aimed shot: tilt the launch up/down (pitch) and sideways (yaw) by a few
 *  degrees and scale its pace. The ball then flies with real physics, so a shot with little margin
 *  (fast, from a low ball, at a corner) misses while a safe one still lands. Spin stays as planned. */
function perturbShot(shot, pitchDeg, yawDeg, speedMul = 1) {
  const v = shot.v, vh = Math.hypot(v.x, v.z), s = Math.hypot(vh, v.y) * speedMul;
  const a = Math.atan2(v.y, vh) + pitchDeg * Math.PI / 180;
  const yaw = Math.atan2(v.x, v.z) + yawDeg * Math.PI / 180, h = Math.cos(a) * s;
  return { ...shot, v: { x: Math.sin(yaw) * h, y: Math.sin(a) * s, z: Math.cos(yaw) * h } };
}

/** First table bounce on the given side (sideSign: +1 player, -1 AI). */
export function predictBounce(b0, sideSign) {
  return simulate(b0, 3, (b, ev) => {
    if (ev.table && Math.sign(ev.table.z) === sideSign) return { x: ev.table.x, z: ev.table.z };
    if (ev.floor) return null;
    return undefined;
  });
}

/** Predict where a racket should meet the ball: after it bounces on `sideSign`'s half
 *  (earlier bounces on the other half, e.g. a serve's first bounce, are skipped),
 *  at the top of the bounce (or where it passes maxDepth from the net). The racket can't reach
 *  closer to the net than minDepth, so a short ball is met where it comes within reach.
 *  bounced: the ball has already made that bounce (the next one would be its second). */
/** Can side `sideSign` (+1 you, −1 the CPU) meet this shot from `p` before its second bounce? A
 *  racket reaches REACH.overTable past its end line (the same for both sides), and the ball must
 *  still be up there — at least `up` m over the table (past the end line, any height). Lower than
 *  that, the racket doesn't get down to it in time: in the sims a short touch that only crept
 *  within reach went unanswered 2 times in 3. */
export function reachableShort(p, shot, sideSign, up = 0.1) {
  const minD = TABLE.length / 2 - REACH.overTable;
  let bounced = false;
  return !!simulate({ p: { ...p }, v: { ...shot.v }, w: { ...shot.w } }, 3, (b, ev) => {
    if (ev.floor) return false;
    if (ev.table) { if (bounced) return false; if (Math.sign(ev.table.z) === sideSign) bounced = true; return undefined; }
    if (!bounced || Math.abs(b.p.z) < minD) return undefined;
    return Math.abs(b.p.z) > HALF_L + 0.06 || b.p.y - TABLE_TOP >= up ? true : undefined;
  });
}
export function predictIntercept(b0, sideSign, maxDepth, minDepth = 0, bounced = false) {
  return simulate(b0, 3, (b, ev, t) => {
    if (ev.floor) return null;
    if (ev.table) {
      if (!bounced) {
        if (Math.sign(ev.table.z) === sideSign) bounced = true;
        return undefined;
      }
      return { x: b.p.x, y: b.p.y, z: b.p.z, t };   // second bounce: take it before it drops
    }
    if (bounced && Math.abs(b.p.z) >= minDepth && (b.v.y <= 0 || Math.abs(b.p.z) >= maxDepth)) return { x: b.p.x, y: b.p.y, z: b.p.z, t };
    return undefined;
  });
}

/** What is left, `t` seconds later, of spin `w0` put on the ball by a stroke: it decays in flight
 *  and each table bounce removes part of the spin about the horizontal axes (see stepBall). */
export function carriedSpin(w0, t, bounces) {
  const d = Math.exp(-PHYS.spinDecay * t), keep = Math.pow(1 - 0.6 * PHYS.tableGrip, bounces);
  return { x: w0.x * d * keep, y: w0.y * d, z: w0.z * d * keep };
}

/** Body movement with limited acceleration and top speed, braking in time to stop on the goal. */
export function moveBody(b, gx, gz, maxSpeed, accel, dt) {
  const dx = gx - b.x, dz = gz - b.z, d = Math.hypot(dx, dz);
  const want = Math.min(maxSpeed, Math.sqrt(2 * accel * d));
  const wx = d > 1e-6 ? dx / d * want : 0, wz = d > 1e-6 ? dz / d * want : 0;
  let ax = wx - b.vx, az = wz - b.vz;
  const am = Math.hypot(ax, az), maxDv = accel * dt;
  if (am > maxDv) { ax *= maxDv / am; az *= maxDv / am; }
  b.vx += ax; b.vz += az;
  b.x += b.vx * dt; b.z += b.vz * dt;
}

/** Execution error of a stroke (degrees): { pitch, yaw } spreads and a pitch bias.
 *  speedIn: incoming ball speed (m/s) · h: contact height above the table (m) ·
 *  off: contact distance from the racket center, 0..1 · spinLift: smash only, unread topspin (+) /
 *  backspin (−) on the ball (rad/s), already offset by the player's face tilt · lowBall: AIM.smashLow
 *  for a smash */
export function strokeError(base, speedIn, h, off, spinLift = 0, lowBall = AIM.lowBall) {
  const k = base * (1 + clamp((speedIn - 6) / 8, 0, 1) * AIM.fastBall)
    * (1 + clamp((0.45 - h) / 0.25, 0, 1.2) * lowBall)
    * (1 + clamp(off - 0.4, 0, 0.6) * AIM.offCenter);
  return { pitch: k, yaw: k * AIM.yaw, bias: clamp(spinLift / 100, -2, 2) * AIM.spinBias };
}

/** Play `shot` from `start` with hand error `err` (see strokeError). With `rescues` > 0 (the
 *  player's aim assist), an error that would send the ball off the far half is shrunk by
 *  AIM.rescue and replayed, so only a clearly bad ball or contact still misses. */
export function handPlay(start, shot, err, rescues = 0) {
  const pitch = err.bias + randn() * err.pitch, yaw = randn() * err.yaw;
  const far = -Math.sign(start.z);
  for (let i = 0, k = 1; ; i++, k *= AIM.rescue) {
    const s = perturbShot(shot, pitch * k, yaw * k);
    if (i >= rescues) return s;
    const land = landingOf({ p: { ...start }, v: { ...s.v }, w: { ...s.w } }, false);
    if (land && land.table && Math.sign(land.z) === far && Math.abs(land.x) <= HALF_W) return s;
  }
}

/** Lowest allowed racket-center height at (x, z): above the table top when over the table. */
export function racketMinY(x, z) {
  const overTable = Math.abs(x) < HALF_W + 0.06 && Math.abs(z) < HALF_L + 0.06;
  return overTable ? TABLE_TOP + REACH.handleClearance : 0.3;
}
