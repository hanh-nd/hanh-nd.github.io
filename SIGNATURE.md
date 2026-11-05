# Signature Shots

Headline players each have a signature shot. When one is coming, the opponent's racket glows in the signature's color, a chime plays, and the ball trails that color. The shot's name flashes each time it's played, and the first time in a match you're also told the counter. If a signature wins the point, the point message repeats the counter.

The wrong stroke against a signature loses the point about 88% of the time. The right one gets the ball back, but it's still a hard ball to play: your hand error on that return is 1.8× normal.

A smash counts as a drive against a signature. It holds a Dragon Loop, but a Phantom Chop or a backspin Ghost Serve still drags it into the net, and a Mozart Serve or Chiquita still carries it wide unless you flick against the curve.

| Player | Signature | Color | When it's played | What it does | Counter |
|---|---|---|---|---|---|
| Joo Se-hyuk | Phantom Chop | ice blue | a rally ball he meets deep | Low, deep chop with very heavy backspin | Push it back (pull back). A drive or a block dies in the net. |
| Jan-Ove Waldner | Mozart Serve | gold | his serve | Half-long serve with heavy sidespin; the racket leans to the side the spin carries | Swipe sideways AGAINST the lean as you return, or the spin carries your ball up to 0.8 m wide. |
| Tomokazu Harimoto | Chorei Counter | orange | your fast ball (8 m/s or more), met deep | Topspin counter at 13–14.5 m/s, away from your racket | It feeds on your pace: push or touch instead of driving, and get back to the middle. |
| Ma Long | Dragon Loop | red-orange | any ball he meets deep | Heavy topspin loop (10.5–11.5 m/s) deep to your forehand | Keep it short to him. Returning it: drive through it (swipe forward). A block or a push flies long. |
| Zhang Jike | Chiquita Flick | lime | any short ball (met over the table) | Fast banana flick, curving away toward your backhand corner | He flicks any short ball, so keep it long. Returning it: swipe AGAINST its curve. |
| Ding Ning | Ghost Serve | violet | her serve | Heavy spin, with the racket face showing the opposite spin | Her racket lies: a chop face hides topspin (drive it), a topspin face hides backspin (push it). |
| Kim Kyung-ah | Spin Reversal | mint | your backspin ball (a push), met deep | Looks like a chop but comes back with topspin (your backspin, turned around) | After you push, drive her next "chop". A push flies long. |
| Mima Ito | Hayabusa | pink | your ball that sits up after its bounce | Flat hit at 13.5–15 m/s away from your racket | She punishes anything above the net: keep it low with a push or a short touch. |

## How often

| Signature | Chance when the situation allows |
|---|---|
| Phantom Chop | 45% |
| Mozart Serve | 50% |
| Chorei Counter | 45% |
| Dragon Loop | 30% |
| Chiquita Flick | 60% |
| Ghost Serve | 50% |
| Spin Reversal | 45% |
| Hayabusa | 65% |

A player plays their signature at most once per point.

## Balance

Measured with the headless sim (`sim/sig.sh`): skilled scripted players against the eight signature owners at Hard, 48 matches each.

| | Before | Now |
|---|---|---|
| Signatures per point | 0.23 | 0.38 |
| A signature wins the point outright, vs a player who doesn't know the counters | 43% | 51% |
| ...vs one who knows them | 29% | 33% |

An ordinary CPU stroke wins the point outright about 10% of the time.

Before this change, Dragon Loop almost never fired, because it needed your backspin. Mozart Serve never won a point outright.

## Strokes, for reference

- **Push:** pull back as the ball arrives (backspin).
- **Drive:** swipe forward.
- **Block:** hold still.
- **Short touch:** meet a slow ball over the table while holding still.
- **Smash:** a quick flick forward. It's safe only on a ball that sits up high.
