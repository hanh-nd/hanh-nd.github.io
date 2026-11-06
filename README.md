# Ping Pong 3D

A table tennis game in the browser (three.js, no build step): open `index.html` from any static server, e.g. `python3 -m http.server 8765`, and go to http://localhost:8765. GitHub Pages serves it as is.

## Code

`index.html` holds the page (HUD and menus), `css/style.css` its styles, and `js/` the game as ES modules. `js/main.js` loads them in order:

| Module | What's in it |
|---|---|
| `config.js` | Every tuning number: physics constants, your strokes (smash, spin, block, chop), the racket and touch, CPU levels, styles and aim, jutsu, signatures, roster, tournament tiers |
| `util.js` | clamp, random helpers |
| `physics.js` | Ball flight, bounces, the shot solver (pure functions, no Three.js) |
| `input.js` | Mouse and touch: racket target, swipe tracking, stroke intent |
| `strokes.js` | Your strokes: which stroke a swipe makes and where it goes |
| `combo.js` | Combos: two strokes in a row read as a tactic (Draw & Drive, Run Around, Change Up, Set & Kill), scaled by each CPU style's weakness |
| `ai.js` | The CPU: reading your shot, moving, choosing and playing strokes, adapting |
| `serve.js` | Serves and the toss |
| `jutsu.js` | Chakra, jutsu, FLOW, Ego rank |
| `rules.js` | Match state and the rules: faults, lets, scoring, games; the time scale |
| `loop.js` | The frame loop: fixed-step physics, contacts, camera, rendering |
| `log.js` | The play log (`?log`) |
| `render/` | Scene, table, venues and crowd, rackets, ball and effects |
| `ui/` | HUD, menus, start-up wiring (`controls.js`) |
| `tournament.js`, `audio.js` | The knockout tournament; synthesized sounds |

Modules import exactly what they use. A `let` another module changes has a setter next to it (`setWatchSpeed`, `setCameraShake`, ...), because imported bindings are read-only. `window.PingPong` (set in `main.js`) is the console and sim hook.

`sim/` plays the game headlessly with scripted bots for balance work. See `sim/README.md`, and use `node sim/fingerprint.mjs` to confirm that a refactor leaves the gameplay unchanged.

`JUTSU.md` and `SIGNATURE.md` describe the jutsu and signature systems.
