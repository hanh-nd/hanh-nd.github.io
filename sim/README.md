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
sim/jutsu.sh medium 24 samehada,possession,rasengan:1 clone,mirror,rasengan:2   # you + a jutsu vs the CPU
sim/duel.sh medium 400 6                      # CPU vs CPU jutsu duel: win rate of the points each jutsu was fired in (FOE=true: both sides have seals)
node sim/run.mjs '{"policy":"mixed","matches":17,"level":"hard","tune":{"SMASH_D":{"react":0.3}}}'
```

`tune` deep-merges overrides into the game's config before a run (`SMASH_D`, `ADAPT`, `AI_LEVELS`, `SIGNATURES`, `SIG_POWER`, ...). Use it to sweep values without editing the game. Opponents rotate through the roster (or `owners` / `pool` / `opp`), so runs compare like for like.

## Bots

- **Human model:** `human` sets reaction, positioning and timing noise, flick speed and width, and how deep it takes the ball. The skilled default is 150 ms reaction, a max-pace 16 m/s flick toward the corners, and taking the ball at 1.7 m.
- **`smash` policy:** smashes everything above `smashMinH`. `smash-all` uses 0.12 m, `smasher` 0.2 m.
- **`mixed` policy:** drives, pushes, blocks and touches, and smashes only balls above 0.3 m.
- **`aware`:** plays each signature's counter.
- **`switcher`:** smashes until it loses a game, then mixes.
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
