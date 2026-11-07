# Headless balance sim

Plays scripted matches against the CPU through the real game code: `run.mjs` loads `index.html` in headless Chromium, and `bot.js` plays the near side as a "finger". It moves `input.target` the same way a touch drag does, so contact, swing detection, touch scaling, hand error and footwork are all the game's own. One match takes about 0.1–0.3 s.

Every sim here steps the game itself (`fixedUpdate` at 240 Hz, the page's frame loop paused, nothing rendered), so it runs as fast as the CPU allows. The old `.agent-kit` sims (`sim*.mjs`, `jutsubot.mjs`) played in real time with sped-up watch mode: about 240 points per 2 minutes. `duel.mjs` does 1,200 points in about 15 s.

## Run

```sh
(cd sim && npm install)                       # playwright-core; uses its own Chromium, else your Google Chrome (or CHROME=/path)
python3 -m http.server 8765 &                 # from the repo root
sim/baseline.sh [commit]                      # optional: a before-version to compare against
sim/compare.sh hard 51                        # three bots vs the baseline and the current game
sim/sig.sh hard 48                            # signature strength vs signature owners
node sim/smoke.mjs                            # watch mode, 2v2 and quick match run to the end without page errors
node sim/fingerprint.mjs > a.txt              # seeded replay of 8 fixed scenarios, hashed every physics step (see below)
sim/jutsu.sh medium 24 samehada,possession,rasengan:1 clone,mirror,rasengan:2   # you + a jutsu vs the CPU
sim/duel.sh medium 400 6                      # CPU vs CPU jutsu duel: win rate of the points each jutsu was fired in (FOE=true: both sides have seals)
sim/iq.sh medium 600 4                        # smart vs plain CPU (iq 1 vs 0, ends swapped): the smart side's point and game share (BY=1: per jutsu)
node sim/run.mjs '{"policy":"mixed","matches":17,"level":"hard","tune":{"SMASH_D":{"react":0.3}}}'
```

**Refactors:** `fingerprint.mjs` seeds `Math.random`, turns off the page's frame loop and plays a fixed set of matches (the human-like bot in three styles, the mixed bot, a jutsu kit, 2v2, CPU vs CPU, the play log), hashing the ball and the players every step. A change that leaves the game's behaviour alone prints the same lines: run it before and after (or against `SIM_URL=…/sim/_baseline/index.html`) and `diff`. Any difference, even one step, shows up.

`tune` deep-merges overrides into the game's config before a run (`SMASH_D`, `ADAPT`, `AI_LEVELS`, `SIGNATURES`, `SIG_POWER`, ...). Use it to sweep values without editing the game. Opponents rotate through the roster (or `owners` / `pool` / `opp`), so runs compare like for like.

## Bots

- **Human model:** `human` sets reaction, positioning and timing noise, flick speed and width, and how deep it takes the ball. The skilled default is 150 ms reaction, a max-pace 16 m/s flick toward the corners, and taking the ball at 1.7 m.
- **`smash` policy:** smashes everything above `smashMinH`. `smash-all` uses 0.12 m, `smasher` 0.2 m.
- **`mixed` policy:** drives, pushes, blocks and touches, and smashes only balls above 0.3 m.
- **`aware`:** plays each signature's counter.
- **`mixer`:** your smash game plus the combos (COMBO) on purpose on the other balls: smash a pop-up, deep after short, the other wide after a wide, soft and fast in turn. `human.sh LEVEL N "you mixer"` shows whether mixing beats smashing.
- **`switcher`:** smashes until it loses a game, then mixes.
- **`human.recover`:** how fast the finger drifts back to the middle between shots (m/s, default 2.2). A slow one (0.6) is closer to a real thumb and shows what the CPU's open-side aim does.
- **`doubles`:** 2v2, you + an ally (`allyStyle`, default all-rounder; the game's default pick is Blocker) vs two CPUs (styles in turn). `allyIq` / `cpuIq` override their iq. In `why`, `duo:*` keys say whose ball each point was lost on.
- **`jutsu`:** `{ kit: [j1, j2, j3], tier: 1|2|3|'max' }` arms that jutsu whenever the seals pay for it. The result's `jutsu` field counts the jutsu each side fired, the points they were fired in, and the points won (`cpuPts` / `youPts`). `jutsu.sh` prints the CPU's jutsu per point, which shows whether yours shuts it out.

## Jutsu duel

`duel.mjs` plays CPU vs CPU (tournament watch mode). Each point, one random side gets 1–3 seals and a random kit from `JUTSU_POOL`, and fires whenever it can (`JUTSU_AI.use` = 1). The other side gets no seals, or 0–3 with `foeSeals` (`FOE=true`), which Samehada and Copy Wheel need. It reports the win rate of the points each jutsu was fired in; points with no jutsu should be about 50%.

Options: `level`, `points`, `style` (both sides), `only` (jutsu ids to build kits from), `foeSeals`, `tune`.

Scripted bots only approximate a person on a phone. Treat the numbers as relative (before vs after, bot vs bot), not as your own win rate.

## Smash habit (Nov 2026)

The CPU tracks your smashes per point and the points they win (`ADAPT.smash`). That builds up `anti` over a match, and it fades when you stop smashing. It's capped by level (`AI_LEVELS.antiSmash`: Easy 0, Medium 0.5, Hard 1).

What `anti` does (`SMASH_D`):
- Lower balls with more backspin and drop shots.
- A deeper stance.
- Reads a smash sooner and counter-blocks it to your open corner.

Only smashes off balls lower than 0.45 m can be read. A smash off a ball that really sat up is as strong as without it.

Everything else is unchanged: the racket height cap, the Hard numbers and the signatures. A first version also changed those; it was reverted.

## Smarter CPU (Nov 2026)

Each level has an `iq` (`AI_LEVELS`: Easy 0.25, Medium 0.55, Hard 0.85) that scales the `SMART` behaviours.

| Behaviour | Effect in the sim |
|---|---|
| Open-side aim: away from whoever plays next, or behind a runner | Vs a slow-recovering bot: 2–3.5 more points per 100 for the CPU. 2v2: the CPU pair takes about 4 more per 100. Vs a bot that recovers fast: nothing. |
| Drop shots vs a deep player | Nothing measurable |
| Situational jutsu (`smartJutsu`, `SMART_J`) | Even, 0.49–0.50 vs a plain CPU. Saving up only stopped costing points once the jutsu costs were rebalanced. |

Two tries made no difference and were dropped: hoarding seals (0.470 of points before the jutsu rebalance), and a safe shot under pressure (fewer CPU errors, but a weaker ball).

## Ways to play (Nov 2026)

`sim/styles.sh LEVEL MATCHES [STYLES]` plays one-style bots (skilled finger). It prints each bot's point share, CPU smashes per point, how often your ball sits up, rally length, and the spin errors it forced (`spinErr`).

The styles:
- `smasher`: smashes anything above 0.2 m.
- `mixed`: drives, pushes, blocks and touches, and smashes only above 0.3 m.
- `block`: holds still at 1.5 m.
- `chop`: pulls back from 2.2 m and takes the ball as it drops.
- `spin`: mixes chop, topspin drive and sidespin brush at random.
- `drive`: drives everything.

The non-smash bots smash only a real sitter (above 0.5 m). `SIM_URL=…/sim/_baseline/index.html` runs the same bots on an older build. Two microbenches: `node sim/bench/stroke.mjs` shows where your stroke goes from set contacts and how high it bounces on the far side (`STROKE=block|drive|push`), and `node sim/bench/spinprobe.mjs POLICY` shows the spin that reaches the CPU.

What changed:
- **Block** (`BLOCK`): a still racket at the table sends back 60% of the incoming pace, 75% when taken on the rise, flat and low. Before, every block left at ~5 m/s, so a block from mid-table floated into the smash zone.
- **Chop** (`CHOP`): a pull-back from 1.8 m or deeper turns the incoming topspin into backspin, low and deep. A heavy loop makes it float a little, and its hand error is ×1.3.
- **The CPU against your spin** (`SPIN_D`): it reads your spin by level (Easy 0.3, Medium 0.5, Hard 0.7). When it misreads, it plays the spin of the last ball, so varying your spin beats it. More topspin than it expected flies long, more backspin finds the net, more sidespin goes wide. Its topspin stroke against backspin is a slower, higher lift. Each style has a `spinErr` factor (Blocker 0.15, Defender and Wizard 0.7) that scales these errors. A "Spin!" callout and an end-of-match stat show it working. Its smash carries the misread spin into its hand error, as yours does.

Point share by style, 30 matches each:

| Style | Medium before → after | Hard before → after |
|---|---|---|
| smasher | 0.446 → 0.425 | 0.345 → 0.336 |
| drive | 0.442 → 0.418 | 0.337 → 0.335 |
| mixed | 0.476 → 0.474 | 0.370 → 0.387 |
| spin | 0.464 → 0.492 | 0.374 → 0.385 |
| block | 0.567 → 0.567 | 0.494 → 0.463 |
| chop | 0.331 → 0.511 | 0.258 → 0.344 |

The before chop is a bot with a home at 1.85 m; it gets 0.25–0.33. A chopper who stays deep invites drop shots and smashes; chop from 1.85 m and it scores higher (Hard ~0.52), but the CPU's drop shots punish it once it stands back.

CPU against CPU, each style vs the All-rounder on Hard (`duel.mjs` with `styles`, both ends): Wizard 0.37 → ~0.50, Attacker 0.64 → ~0.58, Defender ~0.47, Blocker ~0.44 → ~0.45.

## Human-like bot (Nov 2026)
`sim/bench/react.py LOG...` measures your real reaction time to CPU balls you had to move for, by ball speed (11-06 logs: median 0.27 s, 0.20 s on balls over 12 m/s).

Real play is logged with `?log` (see the play log, js/log.js); `sim/bench/logstats.py LOG [matches]`
and `sim/bench/smashcmp.py` summarize a log, and `sim/bench/botlog.mjs` makes the bot play with the log
on, so bot and human go through the same analysis. `bot.js` `human.real` plays like the logged iPhone
player: reaction 0.22 s, a rough first read that sharpens, a finger that never stops (it drags the
racket to the ball and jumps ~8 m/s to get near it), a smash flick that peaks just after contact,
mostly cross-court and very sideways (8 fwd / 12 side m/s), a follow-through, touch sensitivity 2×.
Policies `you` (your normal game: smash anything not short, else drive or sidespin) and `youBlock`.
`sim/human.sh [LEVEL] [MATCHES] [POLICIES]` runs them (`SIM_URL=…/sim/_baseline/index.html` for the live
version; `POOL='["defender"]'` for one style, `OPP='"Joo\u0020Se-hyuk"'` for one player — `\u0020` for a
space). `sim/matrix.sh [LEVEL] [MATCHES]` plays every roster player against all four policies and prints
the table (hardest player last); raw output in `sim/_matrix/` (ignored). Use it to spot a player or a way
of playing that is out of line — it is how a free point off the short touch was found (11-06: the CPU
could not reach a low touch, so pure "block and touch" won 0.6–0.7 against wizards and blockers).
The bot is a fixed human: as you improve, real play pulls ahead of it (11-06: you 0.46 at Hard, the bot
~0.3) — compare strokes, styles and players with it, don't re-fit it to the newest log.

Hard vs All-rounders, live version (older numbers):

| | real (points won) | bot |
|---|---|---|
| normal (smash) | 0.19 / 0.44 (two matches) | 0.20–0.25 |
| trying to block | 0.27, 0.24 (vs a Blocker) | 0.34 |

The smash gap (the CPU missed ~19% of the real smashes, ~5% of the bot's) closed once the bot smashed
like you: from your left, cross-court, early on the rise (`smashZ`). Spin play (`youSpin`): your
sidespin carries a forward swipe (topspin) and a 10–15 m/s sideways flick at 2×.

Nov 2026 change, from these bots (points won; live → new): the catch zone 0.17 → 0.21 m (most of
your points were lost to balls the racket missed by 0.2–0.35 m), a brush with a forward swipe is a
sidespin drive (SPIN.drive), the CPU's arc ceiling counts from its contact (a high ball no longer
turned into a 16 m/s drive), a brush stays low (SPIN.arc), a high ball smashes with a smaller flick.

| | you (smash) | youSpin | youBlock |
|---|---|---|---|
| easy | .62 → .73 | .55 → .63 | .63 → .78 |
| medium | .47 → .50 | .35 → .42 | .47 → .58 |
| hard | .23 → .28 | .22 → .30 | .37 → .48 |

(youBlock reads ~0.1 high against real blocking.) The sim only tunes what `PingPong.test` exposes —
a TUNE key it doesn't know is silently ignored.

## Playable balls (Nov 2026)

A racket reaches 0.45 m over the table (`REACH.overTable`). A low backspin push or block could land short and bounce twice before it got there, and the CPU just watched it. Only the touch and the CPU's drop shot were checked for this. On Hard, those dead balls were **60% of the points** the drive and smash bots won (150 of 248, 134 of 254).

Now `keepReachable` (physics.js) checks the final ball of every stroke, on both sides, after hand error. A ball that lands but would die out of reach gets the least extra pace that makes it playable (`REACH.playable`, `paceStep`, `paceSteps`). Its height and spin stay the same, it never goes long, and jutsu and deliberate misses are left alone. It changes about 3% of shots, 1–2 steps of 3% each. Short balls that can still be reached are untouched.

| Bot vs Hard | before | after |
|---|---|---|
| smasher | 0.31 | 0.17–0.20 |
| drive | 0.30–0.33 | 0.20 |
| mixed | 0.34 | 0.21–0.27 |
| block | 0.43 | 0.32–0.35 |
| chop | 0.50 | 0.45–0.47 |

Against Medium the drop is smaller (smasher 0.43 → 0.33, the rest within about 0.03). Signatures win as often as before. The guard on the CPU's own shots changes nothing measurable for you. `REACH.playable` 0.03 still let a few balls that only just crept into reach go unanswered; 0.06 left none.

## Tables (Nov 2026)

Each venue has its own table (`TABLES`, `TABLE_OF_VENUE`): club (gym), arena (baseline), pro (stadium), park (with a per-point wind). Sim a table by pointing the quick match's venue at it: `TUNE='{"TABLE_OF_VENUE":{"arena":"park"}}' sim/styles.sh hard 30`. For the tournament and the duel, map `gym` and `stadium` too.

What you see (a probe of `solveShot` + `simulate`, same shots on each table; bounce height over the table / speed after the bounce):

| Table | restitution / grip | Drive | Chop |
|---|---|---|---|
| arena | 0.88 / 0.55 | 19 cm / 7.5 m/s | 9 cm / 3.3 |
| club | 0.76 / 0.38 | 15 cm / 7.9 | 8 cm / 4.0 |
| pro | 0.93 / 0.72 | 21 cm / 7.0 | 10 cm / 2.6 |
| park | 0.97 / 0.42 | 23 cm / 7.8 | 12 cm / 3.9 |

Park wind, at 1 / 2 / 2.6 m/s across: a drive bends 6 / 11 / 15 cm by the far end line, a soft push 15 / 31 / 43 cm.

Point share per style (30 matches, skilled finger):

| Hard | smasher | mixed | drive | spin | chop | block |
|---|---|---|---|---|---|---|
| arena | 0.181 | 0.257 | 0.215 | 0.270 | 0.426 | 0.332 |
| club | 0.165 | 0.226 | 0.185 | 0.311 | 0.423 | 0.361 |
| pro | 0.201 | 0.245 | 0.199 | 0.292 | 0.437 | 0.351 |
| park | 0.196 | 0.216 | 0.161 | 0.324 | 0.420 | 0.371 |

Medium is within ±0.04 of the arena for every style. Rally length and CPU misses are unchanged (a block-only bot: 0 CPU misses on every table). Signatures (`sig.sh hard 32`): 40–43% wins vs an unaware bot and 27–29% vs an aware one on all four tables. The jutsu duel's order and rates match the arena within noise; points without a jutsu stay at 0.52–0.54. 2v2 (medium, 16 matches): 0.35–0.40 on all tables.

A first try with gentler numbers (club 0.84 / 0.42, pro 0.90 / 0.68) changed bounces by only 1–2 cm, too small to notice, so they were pushed to about ±30%.
