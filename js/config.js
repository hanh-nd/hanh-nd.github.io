// Every tuning number: table and physics constants, your strokes (smash, spin, block, chop), the racket and touch,
// CPU levels, styles and aim, jutsu, signatures, the roster and tournament tiers. Gameplay tuning starts here.

/* =====================================================================
   CONFIG
   Units: meters, seconds, radians. +Z points toward the player (camera),
   -Z toward the AI. The table surface is at y = TABLE.height.
   ===================================================================== */
export const TABLE = {
  length: 2.74, width: 1.525, height: 0.76, thickness: 0.03,   // ITTF regulation
  netHeight: 0.1525, netOverhang: 0.1525,
  lineWidth: 0.02, centerLineWidth: 0.003,
};

export const PHYS = {
  dt: 1 / 240,            // fixed physics timestep (decoupled from rendering)
  maxSubSteps: 48,        // safety cap per frame (enough for a 4× fast-forwarded match)
  gravity: 9.81,
  radius: 0.02,           // 40 mm ball
  drag: 0.11,             // quadratic air drag: a = -drag * |v| * v
  magnus: 0.0045,         // Magnus effect:      a = magnus * (ω × v)
  spinDecay: 0.1,         // fraction of spin lost per second in flight
  tableRestitution: 0.88,
  tableGrip: 0.55,        // 0..1, how much of the contact slip friction removes on a bounce
  edgeRestitution: 0.3,   // an edge ball skids off low...
  edgeKick: 0.4,          // ...and is knocked outward (fraction of its impact speed)
  floorRestitution: 0.55,
  netDamping: 0.15,       // fraction of speed kept when the ball hits the net
};

export const GAME = {
  pointsToWin: 11, winBy: 2, gamesToWin: 2,  // best of 3
  servesPerTurn: 2,                          // serve switches every 2 points (every point at deuce)
  pointDelay: 1.7, gameDelay: 2.8,           // seconds
  // Simulation speed relative to real time. Physics stays physically correct; it just runs slower/faster.
  speeds: { slow: { label: 'Slow', scale: 0.8 }, real: { label: 'Real', scale: 1.0 }, fast: { label: 'Fast', scale: 1.2 } },
  rallyTimeout: 8,                           // safety: resolve a stuck rally
};

/** Physical reach limits shared by both players: a player stands behind the end line, so the
 *  racket can only reach a little way over the table, and it can't dip into the table top.
 *  The body runs (limited speed and acceleration); the arm reaches around it quickly. */
export const REACH = {
  overTable: 0.45,        // how far past the end line (toward the net) a racket can reach
  handleClearance: 0.27,  // blade center must be this high above the top when over the table
  bodyBehind: 0.1,        // the body stays at least this far behind the end line
  armX: 0.6,              // racket reach to either side of the body (m)
  armZ: 0.55,             // racket reach in front of / behind the body (m)
};

/** Smash: a quick FORWARD flick of the racket at contact (finger/mouse moving up the screen —
 *  straight or diagonal, e.g. bottom-left → top-right). Sideways moves (defending,
 *  chasing a wide ball) never smash. Flat, very fast, topspin; the flick's direction steers it.
 *  Safe on a high ball; a low, fast or spinny one is a gamble (see AIM). */
export const SMASH = {
  minSwing: 2.8,          // speed (real m/s) of a forward-pointing flick that triggers a smash
  maxAngle: 60,           // flick must point within this many degrees of straight forward
  minSpeed: 12, maxSpeed: 16,    // horizontal ball speed range (m/s), scaled by swing
  topspin: 70,
  shake: 0.035,           // camera shake amplitude (m)
  window: 0.22,           // a fast swing still counts this long after its peak (sim seconds)
  sweepTime: 0.2,         // during a fast swing, contact checks the path swept over this time
  grace: 0.1,             // a fast swing right after a normal hit ("through the ball") upgrades it
  easeHigh: 0.3,          // a ball that sits up takes a smaller flick: minSwing × (1 − easeHigh) from 0.55 m
                          // up, from 0.25 m (real play, ?log: flicks just short of it on high balls)
  sweepReach: 1.25,       // ...and accepts the ball slightly wider than a normal contact
};

/** Sidespin: a firm SIDEWAYS flick at contact (left → right or right → left) brushes the back of
 *  the ball. A sideways racket adds no forward pace, so the ball comes off it like a soft block;
 *  friction on the brush gives it a little sideways push along the flick and sidespin, and the
 *  sidespin (Magnus) curves it back the other way. For a hollow ball (I = 2/3 m R²) a sliding
 *  brush that grips a share `grip` of the racket's speed vb gives Δv = 0.4·grip·vb and
 *  ω = 0.6·grip·vb / R. A slow sideways drag (just moving to the ball) stays a normal stroke; a
 *  flick pointing mostly forward is a drive or a smash, never this. */
export const SPIN = {
  minSwing: 2.8,          // sideways flick speed (real m/s) that plays a sidespin stroke
  maxAngle: 35,           // flick must point within this many degrees of straight sideways
  touch: 0.6,             // on a touch screen a flick counts this much (cf. PLAYER_CFG.touchSmash):
                          // about 1/3 of the screen width in ~0.23 s
  grip: 0.35,             // share of the racket's sideways speed the rubber grips on a brush
  maxBrush: 5,            // racket speed (m/s) past which the rubber just slips: at most ~0.7 m/s
                          // sideways and ~50 rad/s of sidespin
  power: 0.3,             // pace (see playerHit): a soft block, no forward push
  arc: 0.34,              // ...kept low like a block: at most this high over the table (m)
  drive: 0.8,             // a brush with a forward swipe keeps this share of a drive's pace (see playerHit):
                          // a soft brush gave the CPU time to attack (sim/human.sh youSpin: Medium .42 → .48)
  window: 0.22,           // a flick still counts this long after its peak (sim s)
};

/** Block and chop: the strokes that live off the other side's ball instead of your own swing.
 *  BLOCK — a still racket (no forward swipe to speak of) at the table (contact within `table` m
 *  behind the end line): the ball comes off it with a share `keep` of its own pace — more (`rise`)
 *  when you take it early, still rising off the bounce — flat and low (arc at most `arc` m over the
 *  table), `base` m from the net and deeper the faster it goes (`depth` m per m/s). Off a smash it is a counter-block. A
 *  still racket further back has no pace to borrow: it floats, and sits up.
 *  CHOP — a pull-back from deep (contact at least `z` m from the net): a defensive stroke against
 *  topspin, not a push. It turns the incoming topspin into backspin (`reverse` of it, on top of
 *  `base`, more for a harder pull, at most `max` rad/s), low (`arc`) and deep (`depth`) at `speed`
 *  m/s — a slow ball that stays down after its bounce. Heavy backspin drags a loop or a smash into
 *  the net unless it is lifted (see SPIN_D, AIM.spinBias). */
export const BLOCK = { keep: 0.6, rise: 0.15, table: 0.45, max: 11, arc: 0.34, base: 0.3, depth: 0.17 };
export const CHOP = { z: 1.8, base: 70, reverse: 0.35, pull: 40, max: 200, speed: [6, 7.4], arc: 0.36, depth: [1.0, 1.18],
  float: 0.14, floatFrom: 50, floatSpan: 100,   // a heavy loop lifts the chop: arc + float × (topspin − floatFrom) / floatSpan
  err: 1.3 };                                    // hand error × (a stroke from deep against a loop is the hard one)

export const PLAYER_CFG = {
  hitRadius: 0.21,        // generous contact sphere around the racket center: a finger on glass misses a
                          // ball it reached by ~0.2–0.35 m (real play, ?log); 0.17 left most points unreturned
  yWeight: 0.55,          // vertical distance counts less (racket height is auto-assisted)
  minX: -1.3, maxX: 1.3, minZ: TABLE.length / 2 - REACH.overTable, maxZ: 2.6,
  serveMinZ: 1.42,        // must serve from behind the end line...
  serveMaxZ: 1.75,        // ...but close enough to bounce the ball on your own half
  serveMaxX: 0.75,
  restY: 0.92,
  followRate: 40,         // racket (arm) smoothing toward the target (1/s)
  heightRate: 30,
  bodySpeed: 4.5,         // footwork: top speed (m/s) and acceleration (m/s²) — quick, so the
  bodyAccel: 30,          // racket keeps up with the finger; the CPU's are slower (AI_LEVELS)
  maxPower: 1.2,
  pushMin: 0.4,           // pull-back (m/s) that plays a push
  pushPower: 0.3,
  longPush: 0.12,         // a harder pull-back pushes deeper: power per m/s beyond pushMin...
  longPushMax: 0.35,      // ...up to this much
  // Short touch: a ball met over the table (closer to the net than touchZ), slower than
  // touchMaxSpeed, with the racket held still (forward swipe under touchMaxFwd, no pull-back) is
  // dropped low over the net with backspin (flight time `time`), so it would bounce twice on the
  // far half. Checked in a headless sim: it bounces twice every time, rises ~0.23 m after its first
  // bounce, the second bounce is ~1.05 m from the net — the opponent has to reach in over the table
  // and meets it low (~0.15 m), so it can return it but not attack it.
  touchZ: 1.15, touchMaxSpeed: 7, touchMaxFwd: 0.8,
  touch: { depth: 0.4, time: 0.45, top: -120 },
  cornerX: 0.66,          // corner aim saturates here (soft), so an overshot sideways swipe stays on
  touchSmash: 0.5,        // on a touch screen a flick counts this much toward a smash (smashIntent): a finger
                          // drags the racket ~3 m per screen height, so a steady swipe up drives and a snap
                          // (1/3 of the screen in ~0.18 s) smashes. Aim and stroke swipes are not scaled
  driveFwd: 1.2,          // forward swipe (m/s) that counts as a drive against a signature (sigReturn)
  answerFwd: 2.0,         // ...and against a jutsu that wants a block (a firmer block still counts)
  sigLuck: 0.12,          // chance a wrong stroke still gets a signature shot back
  spinRead: 60,           // spin a stroke handles (rad/s): drives/blocks topspin, pushes backspin;
                          // more or less than that shifts the return long/short
  lungeSweep: 0.08,       // a fast-moving racket also meets balls it crossed this long ago (s)
  strokeWindow: 0.12,     // a swipe still shapes the stroke this long after it peaks (sim s)
  bladeRadius: 0.11,      // the real blade: touching the ball before its bounce (a volley) uses this
};

/** AI tuning, all difficulty levels in one object.
 *  speed/accel: footwork m/s and m/s² (human range: even Hard can't cover a fast wide ball)
 *  reactionMs: delay before reading the ball · aimError: aim + positioning noise
 *  power: shot pace · spin: 0..1 spin amount · mistakeRate: chance of an unforced error per shot
 *  smash: chance of smashing a ball that sits up high (see AI_COMMON.smashHeight) ·
 *  smashError: hand error of its smash, relative to the player's (AIM.smash) ·
 *  pattern: chance of playing one of its style's patterns in a point (STYLE_PATTERNS) ·
 *  adapt: at most this share of its shots goes at the zone where you keep missing (ADAPT) ·
 *  counter: at full anti-smash, chance it meets a smash it could read with a counter-block ·
 *  antiSmash: how far it adapts to a smash-happy opponent (ADAPT.smash, 0 = never) ·
 *  iq: how much it plays the situation rather than a coin flip (SMART) */
export const AI_LEVELS = {
  easy:   { label: 'Easy',   speed: 2.6, accel: 11, reactionMs: 240, aimError: 0.13, power: 0.9,  spin: 0.5,  mistakeRate: 0.09,  smash: 0.35, smashError: 1.9,  pattern: 0.55, adapt: 0.35, counter: 0,    antiSmash: 0, iq: 0.25 },
  medium: { label: 'Medium', speed: 3.0, accel: 14, reactionMs: 180, aimError: 0.07, power: 1.05, spin: 0.8,  mistakeRate: 0.045, smash: 0.6,  smashError: 1.45, pattern: 0.7,  adapt: 0.5,  counter: 0.35, antiSmash: 0.5, iq: 0.55 },
  hard:   { label: 'Hard',   speed: 3.3, accel: 16, reactionMs: 140, aimError: 0.04, power: 1.15, spin: 1.0,  mistakeRate: 0.02,  smash: 0.85, smashError: 1.15, pattern: 0.8,  adapt: 0.6,  counter: 0.65, antiSmash: 1, iq: 0.85 },
};
export const LEVEL_ORDER = ['easy', 'medium', 'hard'];
export const LEVEL_BLURB = { easy: 'Steady', medium: 'Fast, spinny', hard: 'Ruthless' };

/** Playing styles, layered on top of a level (multipliers of its numbers, 1 = unchanged).
 *  chop: share of strokes played as backspin chops (chopSpin scales their backspin) ·
 *  top / side: topspin and sidespin · power: pace · smash: smash rate · mistake: error rate ·
 *  depth: how far behind its home position it stands (m; < 0 = closer to the table) ·
 *  wide: how close to the side lines it aims · short: share of short, slow drop shots ·
 *  flick: share of short balls (met over the table) it flicks with topspin instead of pushing ·
 *  serveBack: share of backspin serves · reaction: reaction time ·
 *  take: when it meets the ball — 'top' of the bounce, on the 'rise', or as it 'drop's ·
 *  spinErr: × the errors your spin forces (SPIN_D) — a blocker's quick hands soak it up ·
 *  weak: × the effect of each of your combos on it (COMBO) · smashSave: share of its reaction time it
 *  saves against a smash (> 0: it retrieves smashes from deep; < 0: they catch it out) — and, when
 *  > 0, the share of the smash's pressure on its stroke it shrugs off ·
 *  punishSoft: pace it adds to its return of a soft ball of yours · weakTo / punishes: the rival
 *  card's lines (shown before the match). */
export const AI_STYLES = {
  allround: { label: 'All-rounder', tag: 'Balanced', blurb: 'No obvious weakness: steady drives with the odd chop.', tip: 'Be patient. Move it around.',
    chop: 0.2, chopSpin: 1, top: 1, side: 1, power: 1, smash: 1, mistake: 1, depth: 0, wide: 1, short: 0.06, flick: 0.3, serveBack: 0.5, reaction: 1, take: 'top', spinErr: 1,
    weak: {}, smashSave: 0, punishSoft: 0, weakTo: 'Nothing in particular', punishes: 'Nothing in particular' },
  attacker: { label: 'Attacker', tag: 'Loops & smashes', blurb: 'Heavy topspin loops and a smash for anything that sits up — but takes risks.', tip: 'Keep it low. Block the loops.',
    chop: 0.04, chopSpin: 1, top: 1.35, side: 0.8, power: 1.15, smash: 1.6, mistake: 1.4, depth: 0.2, wide: 1.05, short: 0.03, flick: 0.6, serveBack: 0.3, reaction: 1, take: 'top', spinErr: 1,
    weak: { changeUp: 1.6 }, smashSave: -0.25, punishSoft: 0.12, weakTo: 'Change Up · the smash', punishes: 'Slow, soft balls' },
  defender: { label: 'Defender', tag: 'Chops from deep', blurb: 'Stands far back and chops almost everything with heavy backspin.', tip: 'Push the chops. Smash high balls.',
    chop: 0.75, chopSpin: 1.25, top: 0.8, side: 0.5, power: 0.82, smash: 0.4, mistake: 0.7, depth: 0.55, wide: 0.95, short: 0.04, flick: 0.08, serveBack: 0.85, reaction: 1, take: 'drop', spinErr: 0.7,
    weak: { drawDrive: 1.6, setKill: 1.6 }, smashSave: 0.35, punishSoft: 0, weakTo: 'Draw & Drive · Set & Kill', punishes: 'Smash after smash' },
  blocker: { label: 'Blocker', tag: 'Quick & flat', blurb: 'Hugs the table and redirects your pace with flat, quick blocks to the corners.', tip: 'Cover the corners.',
    chop: 0.05, chopSpin: 1, top: 0.4, side: 0.3, power: 1.05, smash: 0.7, mistake: 0.85, depth: -0.15, wide: 1.1, short: 0.12, flick: 0.3, serveBack: 0.4, reaction: 0.8, take: 'rise', spinErr: 0.15,
    weak: { runAround: 1.6 }, smashSave: 0, punishSoft: 0, weakTo: 'Run Around', punishes: 'Pace (it blocks it back)' },
  wizard: { label: 'Spin Wizard', tag: 'Sidespin & tricks', blurb: 'Wicked sidespin, sneaky short balls and spin that changes every shot.', tip: 'Read the racket face.',
    chop: 0.35, chopSpin: 1.3, top: 1.15, side: 2.3, power: 0.9, smash: 0.8, mistake: 1.1, depth: 0.1, wide: 1, short: 0.22, flick: 0.35, serveBack: 0.5, reaction: 1, take: 'top', spinErr: 0.7,
    weak: { changeUp: 1.5 }, smashSave: 0, punishSoft: 0, weakTo: 'Change Up · flat pace', punishes: 'Drives into its spin' },
};
export const STYLE_ORDER = ['allround', 'attacker', 'defender', 'blocker', 'wizard'];

/** Tactical patterns, two per style: small multi-shot plans a CPU picks at the start of a point
 *  (c.pattern) and plays hit by hit, so its habits can be learned — and broken. The key shot is
 *  telegraphed by a wind-up of the racket. A mistake or a smash still comes first.
 *  steps: intents for its rally hits in order (its first hit = the return of serve, or the third
 *  ball when it served); fields, all optional (unset = the style's usual random choice):
 *    side: 'bh' | 'fh' | 'mid' — your backhand / forehand / body (players are right-handed) ·
 *          'switch' — away from its previous shot · 'open' — away from your racket
 *    depth: 'short' (a drop shot, if you can reach it) | 'long' · pace: × its usual pace
 *    spin: 'top' (heavy) | 'chop' | 'flat' | 'float' (looks like a chop, carries no spin)
 *    key: the shot the pattern builds up to (wind-up tell; seeing it scouts the pattern)
 *  serve: its serve when the pattern starts on its serve ({ long | short, back, side });
 *  needsServe: only picked when it serves · loop: repeat the steps until the point ends. */
export const STYLE_PATTERNS = {
  allround: [
    { id: 'allround-corners', name: 'Corner to corner', counter: 'Get back to the middle after every shot — the next ball goes to the other corner.',
      steps: [{ side: 'bh' }, { side: 'switch', key: true }], loop: true },
    { id: 'allround-long-serve', name: 'Long serve, then the forehand', counter: 'Return the long serve to its middle — the third ball goes hard to your forehand.',
      serve: { long: true, side: 'bh' }, steps: [{ side: 'fh', spin: 'top', pace: 1.15, key: true }], needsServe: true },
  ],
  attacker: [
    { id: 'attacker-short-loop', name: 'Short serve, loop the third ball', counter: 'Answer its short backspin serve with a short touch — no long ball, nothing to loop.',
      serve: { short: true, back: true }, steps: [{ side: 'bh', spin: 'top', depth: 'long', pace: 1.2, key: true }], needsServe: true },
    { id: 'attacker-hammer', name: 'Hammer the backhand, then the forehand', counter: 'After two balls to your backhand, cover your forehand.',
      steps: [{ side: 'bh', spin: 'top' }, { side: 'bh', spin: 'top', pace: 1.1 }, { side: 'fh', spin: 'top', pace: 1.25, key: true }] },
  ],
  defender: [
    { id: 'defender-chop-counter', name: 'Chop, chop, counter', counter: 'After two chops, expect a sudden topspin counter — block it, don\'t push it.',
      steps: [{ spin: 'chop', depth: 'long' }, { spin: 'chop', depth: 'long' }, { spin: 'top', side: 'switch', pace: 1.3, key: true }] },
    { id: 'defender-float', name: 'Heavy chop, then a float', counter: 'Every second chop carries no spin — when the racket winds up, drive it instead of pushing.',
      steps: [{ spin: 'chop', depth: 'long' }, { spin: 'float', depth: 'long', key: true }], loop: true },
  ],
  blocker: [
    { id: 'blocker-wide-body', name: 'Wide, wide, at your body', counter: 'After two wide blocks, step aside — the third comes straight at you.',
      steps: [{ side: 'bh', spin: 'flat' }, { side: 'fh', spin: 'flat' }, { side: 'mid', spin: 'flat', pace: 1.2, key: true }] },
    { id: 'blocker-drop-deep', name: 'Drop shot, then deep', counter: 'After you step in for its drop shot, step straight back — the next block comes deep.',
      steps: [{ depth: 'short', spin: 'flat' }, { depth: 'long', side: 'switch', spin: 'flat', pace: 1.25, key: true }] },
  ],
  wizard: [
    { id: 'wizard-short-short-long', name: 'Short, short, long', counter: 'After two short balls, stay ready for a fast long one.',
      steps: [{ depth: 'short' }, { depth: 'short' }, { depth: 'long', spin: 'top', pace: 1.3, key: true }] },
    { id: 'wizard-spin-switch', name: 'Backspin serve, topspin follow', counter: 'Push its backspin serve short — the follow-up is a heavy topspin to your backhand.',
      serve: { back: true }, steps: [{ side: 'bh', spin: 'top', pace: 1.15, key: true }], needsServe: true },
  ],
};
const PATTERN_BY_ID = Object.fromEntries(Object.values(STYLE_PATTERNS).flat().map(p => [p.id, p]));

/** Signature shots of headline players: a tell (the racket glows in the signature's color, the
 *  ball trails it, a chime), the name flashed each time (with the counter the first time in a
 *  match), and a counter to learn. chance: how often it's played when it can be.
 *  when: 'serve' (decided at its serve) or the contact it needs, checked as soon as the CPU has
 *  read your ball (contactSignature): deep / short (over the table) / high, your pace (minSpeed),
 *  your spin (backspin). Effects: see aiHit / aiServe / playerHit (sigReturn). */
export const SIGNATURES = {
  'phantom-chop': { owner: 'Joo Se-hyuk', name: 'Phantom Chop', color: 0x8fe3ff, chance: 0.3, when: 'deep',
    counter: 'PUSH it',
    // A drive swiped at least `fwd` (a hard one: real play's median drive is ~5.3) loops it over
    // instead of into the net, but slow and high (`speed` m/s, at most `top` topspin, `depth` m from
    // the net: ~0.5 m apex, ~0.35 m off the bounce) — a ball they can attack. Real play: drives sent
    // 19 of 23 Phantom Chops into the net; no push was ever tried (logs 11-06).
    loop: { fwd: 5, speed: 4.4, top: 60, depth: 0.95 } },
  'mozart-serve': { owner: 'Jan-Ove Waldner', name: 'Mozart Serve', color: 0xffd23f, chance: 0.35, when: 'serve',
    counter: 'Swipe against the lean' },
  'chorei-counter': { owner: 'Tomokazu Harimoto', name: 'Chorei Counter', color: 0xff7a1a, chance: 0.3, when: 'deep', minSpeed: 8,
    counter: 'Slow it down' },
  'dragon-loop': { owner: 'Ma Long', name: 'Dragon Loop', color: 0xff4d2e, chance: 0.3, when: 'deep', backspin: true,
    counter: 'DRIVE through it' },
  'chiquita': { owner: 'Zhang Jike', name: 'Chiquita Flick', color: 0xb8ff3a, chance: 0.4, when: 'short',
    counter: 'Keep it long' },
  'ghost-serve': { owner: 'Ding Ning', name: 'Ghost Serve', color: 0xd78bff, chance: 0.35, when: 'serve',
    counter: 'Do the opposite' },
  'pimple-reversal': { owner: 'Kim Kyung-ah', name: 'Spin Reversal', color: 0x4dffc3, chance: 0.3, when: 'deep', backspin: true,
    counter: 'DRIVE the fake chop' },
  'hayabusa': { owner: 'Mima Ito', name: 'Hayabusa', color: 0xff4fa3, chance: 0.45, when: 'high',
    counter: 'Keep it low' },
};
export const SIGNATURE_OF = Object.fromEntries(Object.entries(SIGNATURES).map(([id, s]) => [s.owner, id]));

/** Chakra and jutsu. Each side has a chakra bar of 3 seals (in 2v2 the team shares one: only you
 *  spend yours, your ally just fills it). Clean strokes, long rallies and every point fill it. With a
 *  seal or more you arm (double-tap, a second finger, your scorebug row, Space or right-click) and your next stroke
 *  fires the jutsu of your character's kit for that stroke: block / push = jutsu 1 (1 seal), drive =
 *  jutsu 2 (2 seals), smash = jutsu 3 (3 seals). Each has a counter; returning a jutsu is a COUNTER
 *  and refunds chakra. One jutsu per side per point. */
export const CHAKRA = {
  seal: 100, seals: 3,                           // chakra per seal, seals on the bar
  stroke: 5, rally: 2, rallyFrom: 6,             // per clean stroke (it landed), + per hit past rallyFrom
  win: 12, lose: 9, counter: 35,                 // per point won / lost, per jutsu countered
  flow: 1.6,                                     // gain multiplier in FLOW
};
CHAKRA.max = CHAKRA.seal * CHAKRA.seals;
export const SLOTS = ['block', 'drive', 'smash'];       // a kit's jutsu 1, 2, 3 (named for the CPU's stroke for each)...
export const SLOT_COST = { block: 1, drive: 2, smash: 3 };   // ...and its price in seals
export const SLOT_LABEL = { block: 'JUTSU 1', drive: 'JUTSU 2', smash: 'JUTSU 3' };
/** The jutsu, as data (see jutsuShot and the effects in stepLiveBall / aiHit / playerHit). Each one
 *  does one thing no other does, from one of the angles in JUTSU_ANGLE.
 *  speed: m/s (unset: the stroke's own pace) · top: its topspin (− backspin) · aim: 'body' (at the
 *  receiver's racket), 'corner' (away from it) · depth: m from the net it lands · on the way —
 *  decoys: two clones (only the real ball casts a shadow) · vanish: ball and shadow disappear from
 *  the net to the bounce · snake: it bows this far out past the side line and curls back in (around
 *  the net post) · stop: time stops as it crosses the net (STOP), then it flies off to the corner
 *  away from the receiver · at its bounce on the receiver's half — rollback: it hops back toward
 *  the net (a second bounce unless met early) · answer: the stroke that returns it ('block':
 *  a still racket — a drive, smash, push or brush flies long) · flash: Black Flash — lands only off the racket's
 *  center (contact off-center below this; a CPU: JUTSU_AI.flash), else it fizzles into a normal
 *  stroke · self (no shot of its own) — 'copy' (with an incoming jutsu: cancels it and fires it
 *  back), 'warp' (the rest of the point your racket blinks to the ball: HIRAISHIN), 'hand' (the
 *  first ball that would lose you the point is caught and sent back: GODHAND), 'slow' (their balls in
 *  slow motion; a CPU: few errors), 'void' (the other side is slow to react until it lands a ball back),
 *  'drain' (win the point and you eat their seals: SAMEHADA), 'flow' (FLOW now, and it holds through
 *  one lost point), 'mirror' (your ball floats up as bait; the next hard ball they hit at you is
 *  sent back faster: MIRROR), 'bind' (their next stroke floats up to you: POSSESSION), 'barrier'
 *  (the rest of the point walls stand on your half's side strips: a ball of theirs landing there is
 *  out — BARRIER), 'charge' (a Spirit Bomb gathers with your balls that land, then your stroke after
 *  SPIRIT.need of them is released as it — SPIRIT).
 *  fx: its look — aura (swirl, spark, ring, smoke, eye, clock, none), spin (aura rad/s), size,
 *  trail ('zigzag' crackles, 'none'), mark (what its bounce leaves: ripple). */
export const JUTSU = {
  // ⚔️ Power
  rasengan:   { angle: 'power', name: 'Rasengan', kanji: '螺旋丸', color: 0x4fc3ff, counter: 'BLOCK IT', speed: [15.5, 17], top: 110, aim: 'body', answer: 'block', answerK: 0.55, fx: { aura: 'swirl', spin: 22, size: 0.22, big: true } },
  blackflash: { angle: 'power', name: 'Black Flash', kanji: '黒閃', color: 0xff1744, counter: 'GET BACK', speed: [12.5, 13.5], top: 100, aim: 'corner', flash: 0.4, fx: { aura: 'spark', spin: 3, trail: 'zigzag', size: 0.15 } },
  // 🌀 Curve
  zeroshiki:  { angle: 'curve', name: 'Zero-Shiki Drop', kanji: '零式', color: 0x9cff6e, counter: 'STEP IN', speed: [7, 7.8], top: -260, depth: [1.0, 1.12], rollback: true, readK: 0.35, fx: { aura: 'ring', spin: -12, mark: 'ripple' } },
  snake:      { angle: 'curve', name: 'Boomerang Snake', kanji: '蛇', color: 0x2ee6a8, counter: 'STEP WIDE', speed: [9.5, 10.5], top: 40, depth: [0.85, 1.1], snake: 0.5, readK: 1, fx: { aura: 'ring', spin: 6 } },
  // 👁️ Illusion
  clone:      { angle: 'illusion', name: 'Shadow Clone', kanji: '影分身', color: 0xffa630, counter: 'FOLLOW THE SHADOW', decoys: true, fx: { aura: 'none' } },
  misdirect:  { angle: 'illusion', name: 'Misdirection', kanji: '視線誘導', color: 0xd6f2ff, counter: 'TRUST THE ARC', speed: [10.5, 11.5], top: 60, aim: 'corner', vanish: true, readK: 0.5, fx: { aura: 'smoke', spin: 1, trail: 'none', mark: 'ripple' } },
  // 🛡️ Guard
  sharingan:  { angle: 'guard', name: 'Copy Wheel', kanji: '写輪眼', color: 0xff2b3a, counter: '', self: 'copy', fx: { aura: 'eye', spin: 9 } },
  hiraishin:  { angle: 'guard', name: 'Flying Thunder God', kanji: '飛雷神', color: 0xffe066, counter: 'HIT THROUGH IT', self: 'warp', fx: { aura: 'none' } },
  godhand:    { angle: 'guard', name: 'God Hand', kanji: '神の手', color: 0xffb020, counter: 'WIN IT TWICE', self: 'hand', fx: { aura: 'none' } },
  // ⏳ Tempo
  metavision: { angle: 'tempo', name: 'Meta Vision', kanji: '空間認識', color: 0x5ad1ff, counter: '', self: 'slow', fx: { aura: 'none' } },
  timestop:   { angle: 'tempo', name: 'Time Stop', kanji: '時止め', color: 0xe8e8ff, counter: 'WAIT FOR IT', speed: [10, 11], top: 50, depth: [0.9, 1.05], stop: true, readK: 0.5, fx: { aura: 'clock', spin: 2, size: 0.16 } },
  void:       { angle: 'tempo', name: 'Infinite Void', kanji: '無量空処', color: 0x7b6bff, counter: 'FOCUS ON THE BALL', self: 'void', fx: { aura: 'none' } },
  // 🔥 Spirit
  samehada:   { angle: 'spirit', name: 'Samehada', kanji: '鮫肌', color: 0x3a7bd5, counter: 'SPEND FIRST', self: 'drain', fx: { aura: 'none' } },
  // 🛡️ Guard, again: the one answer to brute force
  mirror:     { angle: 'guard', name: 'Yata Mirror', kanji: '八咫鏡', color: 0xb8f3ff, counter: "DON'T SMASH IT", self: 'mirror', readK: 0.5, fx: { aura: 'none' } },
  // 🕸️ Control: you play their stroke
  possession: { angle: 'control', name: 'Shadow Possession', kanji: '影真似', color: 0xb06bff, counter: 'JUTSU BREAKS IT', self: 'bind', fx: { aura: 'none' } },
  // 🧱 Space: reshapes the table
  barrier:    { angle: 'space', name: 'Barrier', kanji: '結界', color: 0x7cf5ff, counter: 'AIM INSIDE', self: 'barrier', readK: 1.3, fx: { aura: 'none' } },
  // 🌀 Charge: grows while the rally lasts
  spiritbomb: { angle: 'charge', name: 'Spirit Bomb', kanji: '元気玉', color: 0x9fd8ff, counter: 'END IT FAST', self: 'charge', fx: { aura: 'swirl', spin: 5, size: 0.2, big: true } },
  awaken:     { angle: 'spirit', name: 'Awakening', kanji: '覚醒', color: 0x2f6bff, counter: 'BREAK THEIR STREAK', self: 'flow', speed: [12.5, 13.5], top: 90, aim: 'corner', fx: { aura: 'spark', spin: 4, size: 0.14 } },
};
JUTSU.clone.reveal = 0;   // the clones vanish this long after the real ball's bounce (s)
/** The angles a jutsu comes from: how it wins you the point. */
export const JUTSU_ANGLE = {
  power:    { label: 'Power', blurb: 'overwhelms with force' },
  curve:    { label: 'Curve', blurb: 'an impossible path' },
  illusion: { label: 'Illusion', blurb: 'fools the eye' },
  guard:    { label: 'Guard', blurb: 'saves you on defense' },
  tempo:    { label: 'Tempo', blurb: 'bends time' },
  spirit:   { label: 'Spirit', blurb: 'chakra and momentum' },
  control:  { label: 'Control', blurb: 'plays their stroke for them' },
  space:    { label: 'Space', blurb: 'reshapes the table' },
  charge:   { label: 'Charge', blurb: 'grows while the rally lasts' },
};
/** Flying Thunder God: contact reach × and footwork × (rest of the point). God Hand: the save it
 *  plays back (m/s, topspin, corner x: away from them). Time Stop: how long time stands still (s).
 *  Samehada: seals it eats, and how many of them it keeps. Infinite Void (until the other side lands a
 *  ball back — FOCUS ON THE BALL breaks it): a bot inside it reacts delay s later, moves at speed×
 *  and has err extra error chance; you inside it move at you× (heavy feet; the screen also goes dark). */
export const HIRAISHIN = { reach: 2.2, speed: 2.4 };
export const GODHAND = { speed: [11, 12], top: 80, wide: [0.45, 0.6] };
export const STOP = { time: 0.6, dart: { speed: [10.5, 11.5], wide: [0.42, 0.56] } };   // dart: the ball when time flows again (m/s, corner x)
export const SAMEHADA = { take: 2, keep: 1 };   // ...only if the Samehada side wins the point (spend first!)
/** Yata Mirror. Its own stroke is bait (speed m/s, topspin, depth m): a slow ball that sits up deep.
 *  The next ball they hit at you primes it if it leaves their racket at min m/s or more (flat: a
 *  smash, a Rasengan, a Black Flash, a hard signature); anything softer leaves it up, waiting, for
 *  the rest of the point. Primed, your
 *  racket catches the ball from reach× as far — or, if it can't get there, the mirror catches it
 *  itself as it rises catchH m off its bounce — and fires it back boost× faster (up to max) to the
 *  open corner. A CPU that doesn't read the mirror (JUTSU_AI.see) smashes the bait (fall). */
export const MIRROR = { min: 11.5, boost: 1.12, max: 19, reach: 1.6, catchH: 0.2, fall: 0.85, bait: { speed: [4.4, 5], top: 10, depth: [1.0, 1.15] } };
/** Shadow Possession: the other side's next stroke is yours — the ball floats to your racket and
 *  sits up (speed, topspin, depth) — unless they fire a jutsu with it. combo: the chance a CPU
 *  smashes the ball its Possession set up, by level (with aim× its smash's hand error). hold: a
 *  possessed CPU is still in the shadow — it reacts this much later (s) to the combo ball. */
export const POSSESSION = { speed: [4.0, 4.5], top: 20, depth: [0.95, 1.12], combo: { easy: 0.55, medium: 0.8, hard: 0.95 }, aim: 0.5, hold: 0.25 };
export const MISDIRECT = { freeze: 3 };   // Misdirection: a bot that lost the ball freezes this × longer (JUTSU_AI.reread)
export const VOID = { delay: 0.28, speed: 0.62, err: 0.16, you: 0.45 };
/** Barrier: the strip this wide (m) along each side line of the caster's half is walled for the rest
 *  of the point — a ball the other side lands there is out. A bot that reads it (seesJutsu) aims
 *  at least margin m inside the wall. */
export const BARRIER = { w: 0.15, margin: 0.06 };
/** Spirit Bomb: it gathers one charge per ball its side lands after firing it; with `need`, that
 *  side's next stroke is the bomb — chakra-guided (no error), speed m/s with topspin `top` to the
 *  corner away from the receiver (x `wide`). A bot that reads the gathering hits harder (pace×)
 *  to end the point first. */
export const SPIRIT = { need: 2, speed: [13.5, 14.5], top: 90, wide: [0.48, 0.62], pace: 1.08 };
/** Jutsu kits — jutsu 1 / 2 / 3. Each CPU style has one (Black Flash and Flying Thunder God are
 *  yours only); you pick yours (JUTSU_POOL). */
export const STYLE_KIT = {
  allround: ['clone', 'snake', 'rasengan'],
  blocker:  ['sharingan', 'mirror', 'godhand'],
  defender: ['metavision', 'timestop', 'void'],
  wizard:   ['zeroshiki', 'misdirect', 'awaken'],
  attacker: ['samehada', 'possession', 'rasengan'],
};
/** Your jutsu (start menu): one per cost, picked from that cost's pool; kept in storage. */
export const JUTSU_POOL = {
  block: ['clone', 'sharingan', 'zeroshiki', 'metavision', 'samehada'],
  drive: ['snake', 'misdirect', 'blackflash', 'hiraishin', 'timestop', 'mirror', 'possession', 'barrier', 'spiritbomb'],
  smash: ['rasengan', 'godhand', 'void', 'awaken'],
};
/** One line each for the picker. */
export const JUTSU_TIP = {
  clone: 'Two decoy balls — only the real one has a shadow',
  sharingan: 'Cancels their jutsu and fires it back at them',
  zeroshiki: 'Drop shot that rolls back toward the net',
  metavision: 'Rest of the point: their balls in slow motion, steadier hands, more reach',
  samehada: 'Win this point and eat 2 of their seals (you keep 1)',
  possession: 'Their next ball floats up to you: smash it. A jutsu breaks it, but is wasted',
  mirror: 'Your ball floats up as bait. All point, a smash at you comes back faster',
  snake: 'Curls out around the net post and back in',
  misdirect: 'Vanishes after the net, reappears at the bounce',
  blackflash: 'Hit dead center: a blazing drive + a seal back',
  hiraishin: 'Rest of the point: your racket warps to the ball',
  timestop: 'Freezes over the net, then darts to the open corner',
  rasengan: 'Huge spiral smash — they must block it',
  godhand: 'Saves you once: the ball that would lose you the point is caught and fired back',
  void: 'Domain: they react late, slow and lost — until they land a ball back',
  awaken: 'Blazing corner drive + deep FLOW (steadier, more reach) through one lost point',
  barrier: 'Rest of the point: walls on your side strips — their balls landing there are out',
  spiritbomb: 'Gathers with each ball you land; after 2, your next stroke unleashes it',
};
/** Bots against a jutsu, by level: chance to answer it with the right stroke (else it flies long),
 *  to pick the real ball among the clones, and to read a vanish, curl, time stop or roll-back in
 *  time (else it freezes for reread × its reaction); extra error chance
 *  against any jutsu. use: chance to fire one of its own when it can, per stroke · flash: chance its
 *  Black Flash lands. */
export const JUTSU_AI = {
  easy:   { block: 0.32, see: 0.5,  rattle: 0.25, reread: 0.55, use: 0.35, flash: 0.45 },
  medium: { block: 0.4,  see: 0.6,  rattle: 0.2,  reread: 0.4,  use: 0.55, flash: 0.6 },
  hard:   { block: 0.48, see: 0.7,  rattle: 0.15, reread: 0.3,  use: 0.8,  flash: 0.75 },
};
/** FLOW: this many points in a row and a side plays in flow until it loses one — steadier hands
 *  (you: smaller aim error; a bot: fewer mistakes) and faster chakra. */
export const FLOW = { streak: 3, aim: 0.6, mistake: 0.6, deep: { aim: 0.4, mistake: 0.35, reach: 1.3 } };   // deep: an Awakening's FLOW (reach: contact reach ×)
/** Meta Vision: the rest of the point your hand error (a bot's error chance) is × META_STEADY. */
export const META_STEADY = 0.6, META_REACH = 1.25;   // ...and its contact reach × this
/** Ego rank: you start at #300 and climb with every win (more vs a higher level), and slip a
 *  little on a loss. duo / tour: multipliers for a 2v2 or a tournament win. */
export const RANK = { start: 300, win: { easy: 6, medium: 14, hard: 26 }, loss: 4, duo: 1.2, tour: 1.5 };

/** Adaptation within a match (vs you only, never in watch mode, never from the score): the CPU
 *  remembers the kind of shot you missed (zone = your side × short / backspin / topspin), aims a
 *  capped share of its shots there (AI_LEVELS.adapt) and switches plans every few points. Silent:
 *  nothing on screen tells the player about it. */
export const ADAPT = {
  decay: 0.8,             // every point, miss weights fade to this fraction
  returned: 0.35,         // a clean return of a zone takes this off its weight
  minWeight: 1.6,         // a zone needs this weight (about 2 recent misses) to be targeted
  hold: [3, 4],           // points a target is held before switching
  rest: 2,                // points without a target when nothing new stands out
  // Your shot habits: it counts your smashes and the points they win you (both fade every point)
  // and, the more you lean on the smash, the more it plays against it (anti, 0..1, capped by
  // AI_LEVELS.antiSmash): lower balls with more backspin and drop shots, a deeper stance, quicker
  // reads and counter-blocks (SMASH_D). Stop smashing and it fades back to its normal game.
  smash: { decay: 0.85, use: 0.16, won: 0.16, rise: 0.15, fall: 0.1 },
};
/** Combos: your stroke read together with your previous one in the rally, as a real tactic — and
 *  what the tactic does to the CPU, exaggerated so it shows (no on-screen text: the Playbook in
 *  Help and the rival card explain them before the match). Each one also costs you something.
 *  Draw & Drive, Run Around and Change Up arm your rally strokes — a drive, a block, a brush can
 *  beat it outright — not the smash (it wins ~70% of the balls it lands on its own; sim, Nov 2026,
 *  when no rally stroke ever did): a smash only finishes Set & Kill.
 *  - Draw & Drive: a short ball (lands within `short` m of the net), then a deep (beyond `deep`)
 *    firm one (at least `fast` m/s): it stepped in, and is caught at the table — it starts `late` s later and moves
 *    `slow` slower to that ball. (Risk: a short ball it reads gets flicked.)
 *  - Run Around: wide (|x| beyond `wide`) to one side, then wide to the other: it drifted back
 *    to the middle and is stretched — `late` s, and `stretch` added to its stretch (errors, pace).
 *    (Risk: your finger goes wide too.)
 *  - Change Up: a soft ball (at most `soft` m/s: a block, a push, a brush), then a fast one (at
 *    least `fast` m/s) — or the other way round: its timing breaks, `mistake` added to its error
 *    chance. (Risk: a soft ball gives it time to attack.)
 *  - Set & Kill: a real brush (sidespin past SPIN_D.side.tol) floats back up — popUp: chance
 *    `misread` if it misread the spin, `read` if it read it; `speed` m/s, `top` topspin, `depth` m
 *    (~0.5 m apex, ~0.35 m off the bounce) — and your smash
 *    off that ball is steady (error × `steady`, no low-ball risk). (Risk: a big brush leaves you wide.)
 *  - read: the same stroke to the same place `n` times running (not a smash: ADAPT does that) — it
 *    saw it coming and saves `save` of its reaction time.
 *  A style's `weak` multiplies a combo's effect (AI_STYLES). */
export const COMBO = {
  short: 0.6, deep: 0.95, wide: 0.38, soft: 5.8, fast: 7.2,   // real play: block / push ~5 m/s, brush 4.4–6.7, drive 6.4–7.9, smash ~12.3
  drawDrive: { late: 0.25, slow: 0.4 },
  runAround: { late: 0.15, stretch: 0.5 },
  changeUp: { mistake: 0.15 },
  popUp: { misread: 0.6, read: 0.2, speed: [4.2, 4.7], top: 40, depth: [0.85, 1.05] },
  setKill: { steady: 0.5 },
  read: { n: 3, save: 0.3 },
};
/** Smash defense: what a CPU does about your smash once it has adapted to it (anti, ADAPT.smash),
 *  so a smash now and then is as strong as ever — in the headless sim (sim/) any early read of the
 *  smash took a big bite out of smashes off high balls. A smash off a ball that really sat up
 *  (contact above `clean`) can't be read; one off a lower ball (at `lazy` and below) can, fully —
 *  the reads and the counter-block scale in between.
 *  antiBack: m deeper at full anti · react: share of its reaction time it saves on a smash it
 *  read, at full anti · block: its counter-block's pace (× the smash's) and pace range (m/s) ·
 *  lowArc / chop / short: at full anti, its strokes' arc ceiling drops by lowArc (m), and chop
 *  and drop-shot shares rise by these. */
export const SMASH_D = {
  lazy: 0.25, clean: 0.45,
  antiBack: 0.3,
  react: 0.45,
  block: { pace: 0.55, min: 7.5, max: 10.5, top: [15, 35] },
  lowArc: 0.12, chop: 0.3, short: 0.12,
};
/** A CPU against your spin. It reads the spin off your racket (`read`, by level); when it doesn't,
 *  it plays the ball as if it carried the spin of the last one — so varying your spin is what beats
 *  it: a loop after chops, a float after a heavy chop, a sidespin brush out of nowhere. The misread
 *  part (rad/s, per axis: `top` along the flight, `side` about the vertical) beyond `tol`, full at
 *  tol + span, is an error chance up to `err`: more topspin than it played flies long, more backspin
 *  dies in the net, sidespin goes wide. Heavy spin is hard even read: past `heavy`, up to
 *  `heavyErr`. Its topspin stroke against backspin is a lift (pace × 1 − slow, arc ceiling + arc);
 *  its own chop takes both topspin and backspin. Its smash carries the unread spin into its hand
 *  error (AIM.spinBias), as yours does. */
export const SPIN_D = {
  read: { easy: 0.3, medium: 0.5, hard: 0.7 },
  top: { tol: 50, span: 120, heavy: 110 }, side: { tol: 15, span: 40, heavy: 35 },   // what is left at its contact (a table bounce takes a third)
  err: 0.4, heavyErr: 0.1, heavySpan: 140,
  slow: 0.1, arc: 0.1,
};
/** Playing the situation (each × the CPU's iq, AI_LEVELS; c.iq overrides it for the sim).
 *  open: chance a drive with no side planned goes to the open side — away from the racket of whoever
 *  plays the next ball (in 2v2 that sends them round their partner), or back behind them when they
 *  run faster than wrongFoot m/s · drop: drop-shot share added when they stand more than deep m
 *  behind their end line, and taken off when they're up at the table (over span m) ·
 *  jutsu: chance its jutsu choice reads the game (smartJutsu) instead of just counting seals. */
export const SMART = { open: 0.7, wrongFoot: 1.2, drop: 0.18, deep: 0.55, span: 0.35, jutsu: 1 };

/** Tournament field: world, Olympic and World Cup champions, men and women (styles are loose
 *  caricatures of their game). short = scorebug name. Rackets avoid the player's red. */
export const ROSTER = [
  { name: 'Ma Long', short: 'Ma Long', nick: 'The Dragon', flag: '🇨🇳', style: 'allround', color: 0xe0a100 },
  { name: 'Fan Zhendong', short: 'Fan', nick: 'The Tiger', flag: '🇨🇳', style: 'attacker', color: 0xf2994a },
  { name: 'Wang Chuqin', short: 'Wang C.', nick: 'Lefty Storm', flag: '🇨🇳', style: 'attacker', color: 0x2f80ed },
  { name: 'Zhang Jike', short: 'Zhang', nick: 'Ji-King', flag: '🇨🇳', style: 'attacker', color: 0x8e44ad },
  { name: 'Sun Yingsha', short: 'Sun', nick: 'Shasha', flag: '🇨🇳', style: 'blocker', color: 0xbb6bd9 },
  { name: 'Chen Meng', short: 'Chen', nick: 'Rock Steady', flag: '🇨🇳', style: 'allround', color: 0x56ccf2 },
  { name: 'Wang Manyu', short: 'Wang M.', nick: 'Power Queen', flag: '🇨🇳', style: 'attacker', color: 0x1fa463 },
  { name: 'Ding Ning', short: 'Ding', nick: 'Serve Queen', flag: '🇨🇳', style: 'wizard', color: 0x9b51e0 },
  { name: 'Jan-Ove Waldner', short: 'Waldner', nick: 'Mozart', flag: '🇸🇪', style: 'wizard', color: 0x3b5bdb },
  { name: 'Truls Möregårdh', short: 'Möregårdh', nick: 'The Showman', flag: '🇸🇪', style: 'wizard', color: 0x00a8e8 },
  { name: 'Timo Boll', short: 'Boll', nick: 'Mr Fair Play', flag: '🇩🇪', style: 'allround', color: 0x2bb673 },
  { name: 'Tomokazu Harimoto', short: 'Harimoto', nick: 'Chorei!', flag: '🇯🇵', style: 'blocker', color: 0x00b3a4 },
  { name: 'Mima Ito', short: 'Ito', nick: 'Quick Hands', flag: '🇯🇵', style: 'blocker', color: 0xf2c94c },
  { name: 'Hugo Calderano', short: 'Calderano', nick: 'The Rocket', flag: '🇧🇷', style: 'attacker', color: 0x6fcf97 },
  { name: 'Felix Lebrun', short: 'Lebrun', nick: 'The Kid', flag: '🇫🇷', style: 'blocker', color: 0x3d8bff },
  { name: 'Joo Se-hyuk', short: 'Joo', nick: 'The Chopper', flag: '🇰🇷', style: 'defender', color: 0x8c8c99 },
  { name: 'Kim Kyung-ah', short: 'Kim', nick: 'Chop Queen', flag: '🇰🇷', style: 'defender', color: 0x7f8c8d },
];

/** Events: a weighted pool of levels each entrant's level is drawn from (so any round can bring
 *  any level in the pool), and how full the arena is per round. */
export const TIERS = {
  club:  { label: 'Club Open', blurb: 'Friendly local event', fans: 120, crowd: [0.25, 0.3, 0.45, 0.65],
    pool: { easy: 0.7, medium: 0.3 } },
  pro:   { label: 'Pro Tour', blurb: 'The real circuit', fans: 2400, crowd: [0.4, 0.5, 0.75, 1],
    pool: { easy: 0.3, medium: 0.45, hard: 0.25 } },
  world: { label: 'World Championship', blurb: 'Only the best', fans: 9000, crowd: [0.6, 0.7, 0.9, 1],
    pool: { medium: 0.4, hard: 0.6 } },
};
/** A random level from a tier's pool, by weight. */
export function drawLevel(pool) {
  let r = Math.random() * Object.values(pool).reduce((a, b) => a + b, 0);
  for (const [level, w] of Object.entries(pool)) if ((r -= w) < 0) return level;
  return Object.keys(pool).pop();
}
export const TIER_ORDER = ['club', 'pro', 'world'];
export const ROUND_NAMES = ['Round of 16', 'Quarterfinal', 'Semifinal', 'Final'];
export const ROUND_BEST_OF = [3, 3, 3, 5];
/** Bracket slots by seed (the last slot = you, a wildcard): you meet seed 15 first, seed 3 or 7
 *  in the quarterfinal, the bottom half's best (2, 6, 10 or 11) in the semifinal, and the top
 *  half's winner (usually seed 1 or 4) in the final. */
export const BRACKET_SEEDS = [1, 14, 8, 9, 4, 13, 5, 12, 2, 11, 6, 10, 3, 7, 15, 0];
export const YOU = 15;
export const FINAL = ROUND_NAMES.length - 1;

export const AI_COMMON = {
  hitRadius: 0.17, minX: -1.4, maxX: 1.4, minZ: -2.6, maxZ: -(TABLE.length / 2 - REACH.overTable), serveZ: -1.55,
  home: { x: 0, y: 0.92, z: -1.8 }, ySpeed: 3.5, reachDepth: 2.35,
  armSpeed: 6,            // racket speed around the body (m/s)
  recovery: 0.2,          // after hitting, the follow-through stops the feet this long (s)
  smashHeight: 0.38,      // the CPU starts to smash balls it meets above this height (m)...
  smashFull: 0.2,         // ...and goes for every one (at its level's `smash` rate) this much higher
  smashSlow: 9,           // only balls slower than this (m/s): a fast ball is blocked, not smashed
  maxArc: 0.42,           // its strokes never float higher than this above the table (m): see aimAI
  arcOver: 0.06,          // ...or than this over the ball, met high
};

export const COLORS = { player: 0xe63946, ally: 0xff9f43, ai: 0x2f80ed, ai2: 0x8e7dff, table: 0x1b4f8f, ball: 0xff8c1a };

/** Between auto-aim and pure physics: strokes are aimed for the table, then played with a human
 *  hand — the launch angle is off by a few degrees (see perturbShot) and real physics decides
 *  whether it lands. A slow shot from a high ball has room to spare; a fast one from a low ball
 *  hardly any, so a smash is a real risk unless the ball sits up. Errors are standard deviations
 *  in degrees for an easy ball, and grow with: */
export const AIM = {
  smash: 0.55,            // smash
  stroke: 0.45,           // block / drive / push
  fastBall: 0.6,          // incoming speed (×1 at 6 m/s, ×1.6 at 14 m/s and above)
  lowBall: 0.8,           // contact height (×1 at 0.45 m above the table, ×1.8 at 0.2 m, ×1.96 lower)
  smashLow: 2,            // ...for a smash (×3 at 0.2 m): with the rescue (below), your smash lands ~78% at
                          // 0.15 m, ~85% at 0.2 m, ~95% from 0.25 m up (sim/bench/smash.mjs)
  offCenter: 1.0,         // contact off the sweet spot (×1 within 40% of the racket radius, ×1.6 at the edge)
  yaw: 0.7,               // sideways error relative to up/down
  spinBias: 0.25,         // a smash against spin: degrees per 100 rad/s, topspin lifts it long and
                          // backspin drops it into the net; a closed / open face (wheel) counters
  rescues: 1,             // player assist: a hand error that would miss is replayed up to this many
  rescue: 0.5,            // times, each with the error scaled by this — near misses land, wild ones don't
};

/** Meta Vision: the other side's balls in slow motion, at this speed. */
export const META_SLOW = 0.5;

/** Touch drags the racket relative to where the finger lands (like a trackpad): racket travel per
 *  finger travel, times the sensitivity setting. */
export const TOUCH_GAIN = 1.25;

/** A double-tap arms a jutsu: two short, still taps close together — the second within `gap` ms
 *  and `dist` px of the first, which was held under `hold` ms and moved under `move` px. */
export const DOUBLE_TAP = { gap: 300, hold: 220, move: 14, dist: 50 };

/** Map the mouse to the racket's reachable area: left/right → X, up/down → depth (Z).
 *  The lower ~60% of the screen spans from the farthest step back to full reach over the table. */
// xGain: the mouse reaches the side limits at 1/xGain of the way to the screen edge, so a wide
// ball doesn't need a huge hand movement (touch drags have their own gain, TOUCH_GAIN).
export const MOUSE_MAP = { xRange: 1.3, xGain: 1.5, ndcNear: -1, ndcFar: 0.2, zNear: 2.5 };

/** (Measured and logged — not yet used to pick the stroke.) A drive is a stroke of the arm, not of
 *  the feet: the racket has to move forward relative to the body, at least `drive` real m/s (at touch sensitivity 1×) within PLAYER_CFG.strokeWindow of
 *  contact. Moving the whole body to the ball — on touch the finger never stops: it drags the
 *  racket there — is no stroke: the racket meets the ball still, a block. `still`: the most arm a
 *  jutsu that wants a block lets through. Measured on real play (an iPhone at 2×, ?log): blocks
 *  +0.1 m/s (median), drives and smashes +1.0. (A pull-back stays a push: an intended chop and a
 *  step back to the ball look the same, and a push is a fine return either way.) */
export const ARM = { drive: 0.25, still: 0.5 };

/** The smart CPU's jutsu choice (smartJutsu in ai.js): clutch use, how big it goes, seals it saves. */
export const SMART_J = { clutch: 0.7, big: 1.5, save: 0.4 };

/** The stroke each rally signature plays (aiHit adds its pace and spin). */
export const SIG_INTENT = {
  'phantom-chop': { spin: 'chop', depth: 'long' },
  'chorei-counter': { spin: 'top', side: 'open', depth: 'long' },
  'dragon-loop': { spin: 'top', side: 'fh', depth: 'long' },
  'chiquita': { spin: 'top', side: 'bh' },
  'pimple-reversal': { spin: 'chop', depth: 'long' },
  'hayabusa': { spin: 'flat', side: 'open', depth: 'long' },
};

/** A short ball (met over the table): no room for a full swing, so a low push (backspin, deep), a
 *  flick (topspin — attackers like it), or a drop back over the net. The flight time sets the pace,
 *  which keeps it low: in a headless sim a push clears the net by ~4 cm and kicks up only
 *  ~0.12 m after its bounce, a flick ~0.16 m. Its plan still picks side and spin. */
export const SHORT_PLAY = {
  push: { time: [0.33, 0.38], depth: [0.85, 1.2] },
  flick: { time: [0.26, 0.3], depth: [0.9, 1.2] },
  drop: { time: [0.34, 0.38], depth: [0.42, 0.58] },
  chiquita: { time: [0.22, 0.25], depth: [1.0, 1.2], side: [140, 170] },   // banana flick: fast, curving
};

/** Serve toss (ITTF rule: thrown up at least 16 cm from an open palm, struck as it falls). */
export const TOSS_HEIGHT = 0.3;
