# Headless balance sim

Plays scripted matches against the CPU through the real game code: `run.mjs` loads `index.html` in headless Chromium, and `bot.js` plays the near side as a "finger". It moves `input.target` the same way a touch drag does, so contact, swing detection, touch scaling, hand error and footwork are all the game's own. One match takes about 0.1–0.3 s.

## Run

```sh
python3 -m http.server 8765 &                 # from the repo root
export PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core   # if it isn't resolvable
sim/baseline.sh [commit]                      # optional: a before-version to compare against
sim/compare.sh hard 51                        # three bots vs the baseline and the current game
sim/sig.sh hard 48                            # signature strength vs signature owners
node sim/smoke.mjs                            # watch mode, 2v2 and quick match run to the end without page errors
node sim/run.mjs '{"policy":"mixed","matches":17,"level":"hard","tune":{"SMASH_D":{"react":0.3}}}'
```

`tune` deep-merges overrides into the game's config before a run (`SMASH_D`, `ADAPT`, `AI_LEVELS`, `SIGNATURES`, `SIG_POWER`, ...). Use it to sweep values without editing the game. Opponents rotate through the roster (or `owners` / `pool` / `opp`), so runs compare like for like.

## Bots

- **Human model:** `human` sets reaction, positioning and timing noise, flick speed and width, and how deep it takes the ball. The skilled default is 150 ms reaction, a max-pace 16 m/s flick toward the corners, and taking the ball at 1.7 m.
- **`smash` policy:** smashes everything above `smashMinH`. `smash-all` uses 0.12 m, `smasher` 0.2 m.
- **`mixed` policy:** drives, pushes, blocks and touches, and smashes only balls above 0.3 m.
- **`aware`:** plays each signature's counter.
- **`switcher`:** smashes until it loses a game, then mixes.

Scripted bots only approximate a person on a phone. Treat the numbers as relative (before vs after, bot vs bot), not as your own win rate.

## Smash counterplay (Nov 2026)

Problem: the smash felt like the only move needed against Hard. The CPU had no answer to a smash-happy player, and a ball that kicked above 1.7 m was out of reach.

Changes:
- **High balls:** the racket now reaches up to 2.2 m (`PLAYER_CFG.maxY`), which covers balls up to about 2.5 m.
- **Smash habit:** the CPU tracks your smashes per point and the points they win (`ADAPT.smash`). This builds up `anti` over a match and fades when you stop smashing. Capped by level (`AI_LEVELS.antiSmash`: Easy 0, Medium 0.5, Hard 1).
- **What `anti` does (`SMASH_D`):**
  - Lower balls with more backspin and drop shots.
  - A deeper stance.
  - Reads a smash sooner and counter-blocks it to your open corner.
  - Only smashes off balls lower than 0.45 m can be read. A smash off a ball that really sat up stays as strong as before.
- **Always on (scaled by `AI_LEVELS.read`):** the CPU steps back when its own ball will sit up for you.
- **Hard retune:** reaction 140 → 125 ms, aim error 0.04 → 0.03, unforced errors 0.02 → 0.014, pace 1.15 → 1.2. Footwork is unchanged: the sims showed faster CPU feet wiped out smash winners even on high balls.
- **Signatures:** see SIGNATURE.md ("Balance").

Results vs Hard, 51 matches per bot, share of points the bot won:

| Bot | Before | Now |
|---|---|---|
| smash-all (smashes nearly everything) | 0.17 | 0.10 |
| smasher (smashes anything above 0.2 m) | 0.38 | 0.35 |
| mixed (sets up, smashes high balls) | 0.42 | 0.37 |
| switcher (smashes, then changes plan after losing a game) | 0.38 | 0.33, 11 comebacks from a game down out of 50 |

A smash-only bot (above 0.15 m) won 0 of 51 matches; its point share stays near 0.25 as the CPU's read climbs to about 0.66. The switcher takes 23% of game 1's points and 59% of game 3's once it changes plan.
