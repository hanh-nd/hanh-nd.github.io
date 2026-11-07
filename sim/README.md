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

## Practice drills (Nov 2026)

Two Practice-only partners (`DRILLS`, `AI_STYLES.wall` / `.hammer`), never in the tournament, 1v1 or 2v2. They're in the Practice partner picker under "Drills", and Random never picks one. Each pushes one side of the game to the top and leaves the other out on purpose.

- **The Wall (you attack):** no smash, no drop shot, no flick, no counter-block, no open-side aim, no plan (`tactics: 0`). It plays slow chops and blocks to the middle. Its errors come only from pressure above `calm` (0.6; a normal rally ball is about 0.4) × `pressureErr` 25, so only pace and placement beat it. Kit: Meta Vision, Flying Thunder God, God Hand (it keeps the ball in play).
- **The Hammer (you defend):** heavy, fast topspin to the corners, smashes balls 0.1 m lower than others do, flicks 90% of short balls, never chops, plays the situation 1.3× and punishes soft balls. Its defence is poor: `pressureErr` 5, your smash catches it (`smashSave` −0.4), spin fools it (`spinErr` 1.5), slower feet (`speed` 0.9). Kit: Spirit Bomb, Time Stop, Rasengan.

Your point share by sim bot (5–6 matches each; Wall rallies are long by design: 60–130 hits):

| Level | Wall: mixed | Wall: block | Hammer: mixed | Hammer: block |
|---|---|---|---|---|
| Easy | 0.64 | 0.72 | 0.85 | 0.73 |
| Medium | 0.50 | 0.11 | 0.39 | 0.39 |
| Hard | 0.27 | 0.11 | 0.11 | 0.19 |

On Medium and Hard, blocking alone doesn't beat the Wall (a normal CPU loses 0.79 of points to the block bot). On Easy, its slow feet leave it stretched, so it's forgiving. The new style knobs (`speed`, `tactics`, `calm`, `pressureErr`, `smashLow`, `counter`) default to the old behaviour, and the fingerprint is unchanged.

## Low drop shots, a steadier Wall (Nov 2026)

Real play 11-06/07 (`?log`): the wizards' rally drop shots peaked at ~0.6 m (drives: ~0.33 m) and half
of the smashes off them were outright winners, so a smasher found wizards easy. From deep, a soft ball
that has to land short loops up. Now a rally drop (`aiHit`) obeys the same ceiling as every other CPU
stroke (`AI_COMMON.maxArc`, or `arcOver` above a ball met high): it's played quicker and flatter, or,
if no low one lands short, it becomes the normal ball. The smash habit's extra drops (`SMASH_D.short`)
scale with the style's `tactics`, so the Wall plays none.

The Wall had normal feet: on the run for 63% of its strokes (real play), so placement alone broke it,
and it missed more than any roster player. It now has `speed` 1.15 and `calm` 0.9.

Human-like bot (`you` = smash habit, 16 matches vs wizards; the rest 12 per opponent, Hard):

| | before | after |
|---|---|---|
| wizard drop: share of its strokes / apex median / p90 | 19% / 0.49 / 0.94 m | 19% / 0.34 / 0.38 m |
| Wall vs `you`: your points / its smash returns / its errors per point | 0.30 / 0.88 / 0.20 | 0.20 / 0.95 / 0.17 |
| Wall vs `youBlock` / `youSpin` | — | 0.07 / 0.32 (spin and placement still break it) |
| Wall vs `mixer`, Easy / Medium / Hard | 0.72 / 0.57 / 0.34 | 0.78 / 0.46 / 0.25 |

Per style (`human.sh` youBlock, 30 matches), allround, wizard and blocker moved by 0.01 or less.
The Hammer was left alone. It's already the hardest attacker to keep out: vs `youBlock`, 25% of its rally
balls beat you (Ma Long 6%, Ito 5%, Zhang Jike 14%), median pace 11.9 m/s, p90 15.6.

Hard's reaction time went from 140 ms to 160 ms (blockers ×0.8: 112 → 128 ms). 140 was at or below the fastest
a person reacts to what they see (~150 ms). Real play is ~0.22–0.27 s, so 160 is still quick, just not superhuman.
Human-like bot, 40 matches, Hard: you 0.26 → 0.28 (it misses a few more smashes), youSpin 0.25 → 0.26,
youBlock 0.31 → 0.30.

## Rival traits (Nov 2026)

Players of one style used to play exactly alike; only the signature set them apart. Each roster player
now has a trait (`TRAITS`, config.js): a few of the style's numbers overridden by about ±25%, with a
strength and a weakness that's really in the numbers (a `weak` combo, slower feet, more errors, less
pace). `styleOf(style, name)` merges it, so `styleCfg` (the CPU), the tournament's attribute bars and the
rival card see it. The card shows its name (◆ chip), what it does and how to beat it.

`matrix.sh hard 8`: each player's point share for the human-like bot, the average of the four ways to play
(before → after). Same-style players already differed by ±0.04 through noise.

| Player | before → after | | Player | before → after |
|---|---|---|---|---|
| Chen Meng | 0.37 → 0.33 | | Hugo Calderano | 0.30 → 0.30 |
| Timo Boll | 0.36 → 0.32 (spin bot 0.35 → 0.30) | | Kim Kyung-ah | 0.29 → 0.28 |
| Fan Zhendong | 0.33 → 0.30 (smash bot 0.41 → 0.30) | | Jan-Ove Waldner | 0.29 → 0.28 |
| Wang Chuqin | 0.32 → 0.32 | | Ma Long | 0.28 → 0.24 |
| Zhang Jike | 0.32 → 0.29 | | Ding Ning | 0.23 → 0.28 |
| Wang Manyu | 0.32 → 0.34 | | Sun Yingsha | 0.22 → 0.19 |
| Truls Möregårdh | 0.31 → 0.30 | | Felix Lebrun | 0.21 → 0.23 (spin bot 0.23 → 0.30) |
| Joo Se-hyuk | 0.20 → 0.21 | | Tomokazu Harimoto | 0.19 → 0.21 |
| Mima Ito | 0.17 → 0.20 (12 matches; the combo bot 0.16 → 0.21) | | | |

A first Ito (quicker reaction, a "slow it down" line with nothing behind it) went to 0.13, the hardest by far.
Her weakness is now a real one: Change Up ×1.6.

## Tournament: 1v1 · 2v2 · Ball Machine (Nov 2026)

The Tournament screen has three tabs. 1v1 is the 16-player knockout. 2v2 is 8 pairs (you and your partner,
from the 2v2 ally, and seven roster pairs), from the quarterfinal. Both have Club Open, Pro Tour and World
Championship, and titles are counted per kind.

Ball Machine (`machine.js`, `MACHINE`) is survival: a robot at the far end feeds nine waves (warm-up,
topspin, backspin, corners, short and long, sidespin, fast and flat, at your body, everything), then repeats
them 6% faster each time round. A landed return scores 1, one in the lit target 3, and three misses end it.
`run.mjs` with `"machine": true` plays runs instead of matches (`agg.machine`: score, wave, fed, returned,
targets, faults). `smoke.mjs` runs one with a racket that tracks the ball perfectly (299 of 300 back).

Human-like bot, 12 runs each (score min / median / max · wave reached, median and max), every fed ball landing (faults 0):

| Bot | Score | Wave |
|---|---|---|
| youSpin | 17 / 69 / 126 | 7, 14 |
| you (smash) | 15 / 48 / 86 | 6, 10 |
| youBlock | 21 / 88 / 158 | 9, 17 |

Overdrive is off in Ball Machine: its rally never resets between balls, so the heat sat at its top and
added +10% pace on top of the waves' own speed-up. With it on, runs ended a wave or two earlier
(smash 36, spin 40 median).

2v2 tournament matches between CPU pairs can be watched (all four seats are bots: `activeBots`
adds `nearAI` in a watched 2v2). `smoke.mjs` watches one to the end.
