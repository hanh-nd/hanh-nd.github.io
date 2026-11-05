// Injected into the game page by sim/run.mjs. A scripted "finger" plays the near side through the
// real input path (input.target, touch scaling, swing detection, hand error, footwork), so the
// numbers come from the same code a human plays against.
window.runSim = function (opts) {
  const P = window.PingPong, T = P.test;
  const { match, rally, ball, input, PLAYER_CFG } = P;
  const TABLE_TOP = 0.76, dt = 1 / 240;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const H = opts.human || {};
  const reaction = H.reaction ?? 0.2, posErr = H.posErr ?? 0.035, timeErr = H.timeErr ?? 0.018;

  // opts.tune: { SMASH_D: {...}, ADAPT: {...}, AI_LEVELS: { hard: {...} }, ... } deep-merged into the game's config
  const merge = (dst, src) => { for (const k in src) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k]) merge(dst[k], src[k]); else dst[k] = src[k]; } };
  if (opts.tune) for (const k in opts.tune) if (T[k]) merge(T[k], opts.tune[k]);
  const pol = opts.policy;   // 'smash': smash anything that isn't low or short · 'mixed': set it up, smash the high ones
  const smashMinH = opts.smashMinH ?? (pol === 'smash' ? 0.12 : 0.3);

  const agg = { matches: 0, won: 0, pts: [0, 0], smashes: 0, smashWin: 0, smashErr: 0, smashRet: 0, plans: 0, strokes: {},
    sig: {}, why: {}, hIn: {}, games: [], behind: 0, comebacks: 0, cpuSmash: 0, rallies: 0, rallyHits: 0 };
  const bot = { plan: null, serveAt: 0 };

  const topIn = b => { const h = Math.hypot(b.v.x, b.v.z) || 1; return (b.w.x * b.v.z - b.w.z * b.v.x) / h; };
  function moveTargetToward(x, z, speed) {
    const t = input.target, dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), s = speed * dt;
    if (d <= s) { t.x = x; t.z = z; } else { t.x += dx / d * s; t.z += dz / d * s; }
  }

  // opts.jutsu: { kit: [j1, j2, j3], tier: 1|2|3|'max' } — arm that jutsu whenever the seals pay for it
  // (as a player would, before the stroke). Fired jutsu are counted per side in agg.jutsu.
  const J = opts.jutsu;
  function armJutsu() {
    if (!J || rally.fired.player || P.armed) return;
    const n = T.sealsOf('player'), tier = J.tier === 'max' ? Math.min(n, 3) : J.tier || 0;
    if (!tier || n < tier) return;
    match.paused = false; P.armJutsu(tier); match.paused = true;   // armJutsu ignores a paused game
  }

  function choose(ip) {
    // opts.switcher: smash-happy until it loses a game, then it mixes it up (a player changing plan)
    if (opts.switcher) { const lostGame = match.games[1] > 0; return chooseP(ip, lostGame ? 'mixed' : 'smash', lostGame ? 0.3 : 0.15); }
    return chooseP(ip, pol, smashMinH);
  }
  function chooseP(ip, pol, smashMinH) {
    // opts.aware: it knows each signature's counter (SIGNATURES.counter) and plays it
    const bs = rally.botShot;
    if (opts.aware && bs && bs.by === 'ai' && bs.sig) {
      const k = { 'phantom-chop': 'push', 'dragon-loop': 'drive', 'pimple-reversal': 'drive',
        'ghost-serve': bs.hidden === 'top' ? 'drive' : 'push' }[bs.sig];
      if (k) return k;
    }
    const h = ip.y - TABLE_TOP, short = ip.z < 1.2, speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z), spin = topIn(ball);
    const mirror = opts.aware && rally.mirror && rally.mirror.ai === 'up';   // it knows not to smash into a Yata Mirror
    // One-style bots (kill: smash only a ball above this height, default 0.5 m — a real sitter):
    // 'block' holds the racket still · 'chop' pulls back (push / chop) · 'drive' swipes forward.
    // 'spin' mixes it up: a chop (pull back, from deep), a topspin drive or a sidespin brush, at random.
    if (pol === 'spin') {
      if (h >= (opts.kill ?? 0.5) && !short && !mirror) return 'smash';
      if (short) return speed < 7 && Math.random() < 0.4 ? 'touch' : 'push';
      const r = Math.random(); return r < 0.4 ? 'push' : r < 0.75 ? 'drive' : 'side';
    }
    if (pol === 'block' || pol === 'chop' || pol === 'drive') {
      if (h >= (opts.kill ?? 0.5) && !short && !mirror) return 'smash';
      if (short) return speed < 7 && Math.random() < 0.4 ? 'touch' : 'push';
      return pol === 'block' ? 'block' : pol === 'chop' ? 'push' : (spin < -80 ? 'push' : 'drive');
    }
    if (h >= smashMinH && !short && !mirror) return 'smash';
    if (short) return speed < 7 && Math.random() < (pol === 'mixed' ? 0.5 : 0.3) ? 'touch' : 'push';
    if (pol === 'mixed') {
      if (spin < -40) return Math.random() < 0.6 ? 'push' : 'drive';
      return Math.random() < 0.8 ? 'drive' : 'block';
    }
    return spin < -60 ? 'push' : 'drive';
  }
  // Late, as it drops (a chopper): below dropH or at the deepest the finger goes (H.takeDepth).
  function dropIntercept(bounced) {
    const maxD = H.takeDepth ?? 2.4, low = H.dropH ?? 0.18;
    return T.simulate(ball, 3, (b, ev, t) => {
      if (ev.floor) return null;
      const pt = { x: b.p.x, y: b.p.y, z: b.p.z, t };
      if (ev.table) { if (!bounced) { if (ev.table.z > 0) bounced = true; return undefined; } return pt; }
      if (!bounced || b.p.z < PLAYER_CFG.minZ) return undefined;
      return (b.v.y <= 0 && b.p.y - TABLE_TOP < low) || b.p.z >= maxD ? pt : undefined;
    });
  }
  const aimSide = () => { const ax = P.aiRacket.pos.x; return Math.random() < 0.75 ? (ax > 0 ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1); };

  function step() {
    const now = P.simTime;
    if (match.state === 'serve' && T.youServe()) {
      bot.plan = null;
      if (!bot.serveAt) { bot.serveAt = now + rand(0.4, 0.8); input.target.x = match.doubles ? rand(0.2, 0.5) : rand(-0.4, 0.4); input.target.z = 1.6; }
      if (now >= bot.serveAt) { bot.serveAt = 0; T.beginToss('player', rand(0.2, 0.7)); }
      return;
    }
    if (match.doubles && rally.live && !T.yourTurn()) {   // 2v2, your ally's ball: clear out beside and behind it
      bot.plan = null;
      return moveTargetToward(-(Math.sign(P.allyRacket.pos.x) || 1) * 0.7, 2.2, H.recover ?? 2.2);
    }
    if (!rally.live || rally.lastHitter !== 'ai') { bot.plan = null; return moveTargetToward(ball.p.x * 0.25, H.home ?? 1.85, H.recover ?? 2.2); }
    let p = bot.plan;
    if (!p || p.hitTime !== rally.lastHitTime) {
      p = bot.plan = { hitTime: rally.lastHitTime, readyAt: now + Math.max(0.08, reaction + randn() * 0.04), ip: null, tContact: 0, stroke: null, nextRead: 0,
        ex: randn() * posErr, ez: randn() * posErr * 0.6, et: randn() * timeErr, side: aimSide(), started: false, sw: null, minD: 9 };
      agg.plans++;
      armJutsu();
      bot.prevSmash = bot.lastPlan && bot.lastPlan.stroke === 'smash' && bot.lastPlan.hitTime !== undefined && rally.rallyHits !== 0 && P.match.rallyCount > 1 && bot.smashedThisRally;
      bot.smashedThisRally = false;
      bot.lastPlan = p;
    }
    { const r = P.player.pos, d = Math.hypot(ball.p.x - r.x, ball.p.y - r.y, ball.p.z - r.z); if (d < p.minD) p.minD = d; }
    if (now < p.readyAt) return;
    if (!p.started && now >= p.nextRead) {   // keep reading the ball until the stroke starts
      p.nextRead = now + 0.08;
      const bounced = rally.bounceCount === 1 && rally.serveStage === 0;
      const ip = H.take === 'drop' ? dropIntercept(bounced) : P.predictIntercept(ball, 1, H.takeDepth ?? 2.5, PLAYER_CFG.minZ, bounced);
      if (ip) { p.ip = ip; p.tContact = now + ip.t + p.et;
        if (!p.stroke) { p.stroke = choose(ip);
          const h = ip.y - TABLE_TOP, b = h < 0.2 ? '<.2' : h < 0.3 ? '.2-.3' : h < 0.45 ? '.3-.45' : h < 0.7 ? '.45-.7' : '>.7';
          const key = (bot.prevSmash ? 'afterSmash ' : 'normal ') + b; agg.hIn[key] = (agg.hIn[key] || 0) + 1;
          if (h > 0.94) agg.hIn.overCap = (agg.hIn.overCap || 0) + 1; } }
    }
    if (!p.ip) return moveTargetToward(ball.p.x, 1.9, 3);
    const ip = p.ip;
    if (!p.sw) {
      p.sw = {
        smash: { v: (H.smashV ?? 7.5) + randn() * 0.6, sl: p.side * rand(...(H.smashSl || [0.8, 2.2])), lead: 0.06, dur: 0.12 },
        drive: { v: rand(2.2, 3.8), sl: p.side * rand(0.4, 1.2), lead: 0.08, dur: 0.14 },
        ...(opts.aware && rally.botShot && rally.botShot.lean ? { [p.stroke]: { v: rand(2.2, 3.2), sl: -rally.botShot.lean * rand(1.4, 2), lead: 0.08, dur: 0.14 } } : {}),
        push: { v: -rand(0.8, 1.6), sl: p.side * rand(0.2, 0.6), lead: 0.06, dur: 0.12 },
        block: { v: 0, sl: 0, lead: 0, dur: 0 },
        side: { v: 0, sl: p.side * rand(5.5, 7), lead: -0.01, dur: 0.09 },   // a sideways flick through the ball, just after contact (playerSpinUpgrade)
        touch: { v: 0, sl: 0, lead: 0, dur: 0 },
      }[p.stroke];
      agg.strokes[p.stroke] = (agg.strokes[p.stroke] || 0) + 1;
      bot.lastStroke = p.stroke;
    }
    const sw = p.sw;
    const x0 = ip.x - p.side * 0.04 + p.ex - sw.sl * sw.lead;
    const z0 = ip.z + p.ez + sw.v * sw.lead;
    if (!p.started && (sw.v || sw.sl) && now >= p.tContact - sw.lead) p.started = true;
    if (p.started) {
      if (now <= p.tContact - sw.lead + sw.dur) { input.target.x += sw.sl * dt; input.target.z -= sw.v * dt; }
      return;
    }
    moveTargetToward(x0, Math.max(z0, PLAYER_CFG.minZ), p.tContact - sw.lead - now > 0.12 ? 4.4 : 2.5);   // under the smash / sidespin flick speeds   // get there, then settle
  }

  for (let m = 0; m < opts.matches; m++) {
    const pool = opts.owners ? T.ROSTER.filter(r => opts.owners.includes(r.name)) : opts.pool ? T.ROSTER.filter(r => opts.pool.includes(r.style)) : T.ROSTER;
    const e = opts.opp ? T.ROSTER.find(r => r.name === opts.opp) : pool[m % pool.length];   // every opponent in turn: runs compare like for like
    match.mode = opts.doubles ? 'duo' : 'quick'; match.watch = null; match.doubles = !!opts.doubles;
    T.setHome(null);
    match.gamesToWin = opts.gamesToWin || 2;
    if (opts.doubles) {   // 2v2: you + an all-rounder ally vs two CPUs (styles in turn); iq overrides: allyIq, cpuIq
      const S = Object.keys(T.AI_STYLES), lv = opts.level || 'hard';
      T.setOpponent({ name: 'CPU', short: 'CPU', color: 0x2f80ed, level: lv, style: S[m % S.length] });
      Object.assign(P.ai2, { level: lv, style: S[(m + 1 + Math.floor(m / S.length)) % S.length], name: '' });
      Object.assign(P.ally, { level: opts.allyLevel || lv, style: 'allround', name: '' });
      P.ally.iq = opts.allyIq ?? undefined; P.ai.iq = P.ai2.iq = opts.cpuIq ?? undefined;
    } else T.setOpponent({ ...e, level: opts.level || 'hard' });
    if (J && J.kit) T.setKit(J.kit);
    P.startMatch();
    match.paused = true;   // the page's own frame loop stays out of it
    input.touch = true; input.mouseActive = false;
    bot.plan = null; bot.serveAt = 0;
    let hadSmash = false, lastPts = [0, 0], lastSm = 0, lastCpuSm = 0, steps = 0, lastHitter = null, trail = false, smash = null, sigId = null;
    const firedNow = { player: null, ai: null };
    while (match.state !== 'matchOver' && steps < 240 * 60 * 40) {
      step();
      T.fixedUpdate(dt);
      steps++;
      if (rally.live) {   // (after the point, rally.fired stays set until the next serve)
        for (const jt of [rally.pendingJutsu, rally.jutsu]) if (jt && !firedNow[jt.by]) firedNow[jt.by] = jt.id;
        for (const side of ['player', 'ai']) if (rally.fired[side] && !firedNow[side]) firedNow[side] = 'fizzle';
      }
      const st = match.stats;
      if (st.smashes !== lastSm) { lastSm = st.smashes; smash = 'pending'; agg.smashes++; hadSmash = true; bot.smashedThisRally = true;
        if (opts.debug && (agg.samples ||= []).length < 30) { const v = ball.v; agg.samples.push({ h: +(ball.p.y - TABLE_TOP).toFixed(2), z: +ball.p.z.toFixed(2), x: +ball.p.x.toFixed(2), vh: +Math.hypot(v.x, v.z).toFixed(1), vx: +v.x.toFixed(1), aiX: +P.aiRacket.pos.x.toFixed(2), aiZ: +P.aiRacket.pos.z.toFixed(2), lvl: P.ai.level }); } }
      if (st.cpuSmashes !== lastCpuSm) { lastCpuSm = st.cpuSmashes; agg.cpuSmash++; }
      if (rally.lastHitter !== lastHitter && rally.lastHitter === 'ai' && lastHitter === 'player') {
        const h = ball.p.y - TABLE_TOP; agg.cpuMeet ||= { n: 0, up: 0, sum: 0 }; agg.cpuMeet.n++; agg.cpuMeet.sum += h; if (h > 0.38) agg.cpuMeet.up++;
      }
      if (rally.lastHitter !== lastHitter) {
        if (rally.lastHitter === 'ai' && smash === 'pending') { smash = null; agg.smashRet++; }
        if (rally.lastHitter === 'ai' && sigId) { const s = agg.sig[sigId] ||= { n: 0, cpuWon: 0 }; s.n++; sigId = null; }   // the CPU plays again: you survived it
        if (rally.lastHitter === 'ai' && rally.botShot && rally.botShot.sig) sigId = rally.botShot.sig;
        lastHitter = rally.lastHitter;
      }
      const pts = st.pointsWon;
      if (pts[0] !== lastPts[0] || pts[1] !== lastPts[1]) {
        const youWon = pts[0] !== lastPts[0];
        const why = youWon ? (rally.lastHitter === 'player' ? 'won:cpuMissed' : 'won:cpuErr') : (rally.lastHitter === 'ai' ? 'lost:noReturn' : 'lost:myErr:' + (bot.lastStroke || '?'));
        agg.why[why] = (agg.why[why] || 0) + 1;
        if (match.doubles) { const k = 'duo:' + why.split(':').slice(0, 2).join(':') + (why.startsWith('lost:noReturn') ? (T.yourTurn() ? ':you' : ':ally') : rally.lastHitter === 'player' ? (rally.turn.player === 1 ? ':byYou' : ':byAlly') : ''); agg.why[k] = (agg.why[k] || 0) + 1; }
        if (why === 'lost:noReturn' && bot.lastPlan) { const lp = bot.lastPlan; const k = 'nr:' + (lp.ip ? lp.stroke + (lp.minD < 0.3 ? '-whiff' : '-far') : 'noIP'); agg.why[k] = (agg.why[k] || 0) + 1; }
        if (smash === 'pending') youWon ? agg.smashWin++ : agg.smashErr++;
        if (sigId) { const s = agg.sig[sigId] ||= { n: 0, cpuWon: 0 }; s.n++; if (!youWon) s.cpuWon++; }   // cpuWon: the signature won the point outright
        agg.rallies++; agg.rallyHits += match.rallyCount;
        agg.jutsu ||= { you: {}, cpu: {}, cpuPts: 0, youPts: 0 };
        for (const [side, k] of [['player', 'you'], ['ai', 'cpu']]) if (firedNow[side]) {
          const e = agg.jutsu[k][firedNow[side]] ||= { n: 0, won: 0 }; e.n++; if (youWon === (side === 'player')) e.won++;
          agg.jutsu[k + 'Pts']++; firedNow[side] = null;
        }
        if (hadSmash) { agg.smashRallies = (agg.smashRallies || 0) + 1; if (youWon) agg.smashRalliesWon = (agg.smashRalliesWon || 0) + 1; }
        hadSmash = false; smash = null; sigId = null; lastHitter = null;
        lastPts = [...pts];
      }
      if (match.games[1] > match.games[0]) trail = true;
    }
    agg.matches++;
    const won = match.games[0] > match.games[1];
    if (won) agg.won++;
    if (trail) { agg.behind++; if (won) agg.comebacks++; }
    agg.spinWins = (agg.spinWins || 0) + (match.stats.spinWins || 0);
    agg.pts[0] += match.stats.pointsWon[0]; agg.pts[1] += match.stats.pointsWon[1];
    agg.games.push(match.gameScores.join(' '));
    (agg.anti ||= []).push(+(P.ai.adapt.anti || 0).toFixed(2));
  }
  agg.ptWin = +(agg.pts[0] / (agg.pts[0] + agg.pts[1])).toFixed(3);
  agg.avgRally = +(agg.rallyHits / agg.rallies).toFixed(2);
  return agg;
};
