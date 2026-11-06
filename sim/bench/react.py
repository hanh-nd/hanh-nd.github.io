# Real reaction time from a play log: for every CPU ball you had to move for (intercept more than
# `need` m sideways from the finger at their hit), the time from their hit until the finger is moving
# toward it (>= 1.5 m/s for one sample, and 0.1 m along within the next 0.1 s). Split by ball speed.
#   python3 sim/bench/react.py LOG.json [LOG.json ...]
import json, sys, statistics as st
need = 0.3
rows = []
for f in sys.argv[1:]:
    d = json.load(open(f))
    for m in d['matches']:
        if m.get('mode') == 'duo': continue
        for p in m['points']:
            for h in p['hits']:
                if h['who'] != 'cpu' or not h.get('chase') or not h['chase'].get('reach'): continue
                path = h['chase']['path']; at = h['chase']['reach'].get('at')
                if not at or len(path) < 4: continue
                x0 = path[0][5]; dx = at[0] - x0
                if abs(dx) < need: continue
                sgn = 1 if dx > 0 else -1; t = None
                for i in range(1, len(path)):
                    dt = path[i][0] - path[i - 1][0]
                    if dt <= 0: continue
                    v = (path[i][5] - path[i - 1][5]) / dt * sgn
                    later = [q for q in path[i:] if q[0] - path[i - 1][0] <= 0.12]
                    if v >= 1.5 and (later[-1][5] - path[i - 1][5]) * sgn >= 0.1: t = path[i - 1][0]; break
                rows.append((h.get('speedOut') or 0, t, h['chase']['reach'].get('window')))
for lo, hi in ((0, 9), (9, 12), (12, 30)):
    r = [t for s, t, w in rows if lo <= s < hi and t is not None]
    if r: print(f"cpu ball {lo}-{hi} m/s: n={len(r)} react median {st.median(r):.2f} s  quartiles {[round(q, 2) for q in st.quantiles(r, n=4)]}  (never moved: {sum(1 for s, t, w in rows if lo <= s < hi and t is None)})")
r = [t for s, t, w in rows if t is not None]
print(f"all: n={len(r)} median {st.median(r):.2f}  quartiles {[round(q, 2) for q in st.quantiles(r, n=4)]}")
w = [w[0] for s, t, w in rows if w and s >= 12]
print(f"fast balls: earliest contact after their hit, median {st.median(w):.2f} s")
