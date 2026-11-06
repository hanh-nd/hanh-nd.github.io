# Summary of a play log (?log) in the same terms as sim/run.mjs: point share, how points end, strokes.
#   python3 sim/bench/logstats.py LOG.json [match indexes, e.g. 1,2]
import json, sys
from collections import Counter
d = json.load(open(sys.argv[1]))
idx = [int(i) for i in sys.argv[2].split(',')] if len(sys.argv) > 2 else range(len(d['matches']))
pts = [p for i in idx for p in d['matches'][i]['points']]
n = len(pts); won = sum(p['end']['winner'] == 'you' for p in pts)
why = Counter()
for p in pts:
    e = p['end']; last = p['hits'][-1]['who'] if p['hits'] else None
    if e['winner'] == 'you': why['won:cpuMissed' if e['kind'] == 'miss' else 'won:cpuErr'] += 1
    else: why['lost:noReturn' if e['kind'] == 'miss' else 'lost:myErr'] += 1
you = [h for p in pts for h in p['hits'] if h['who'] == 'you' and not h.get('serve')]
st = Counter(('smash' if h['stroke'].startswith('smash') else 'side' if 'side' in h['stroke'] else h['stroke']) for h in you)
tot = sum(st.values())
sm = [h for h in you if h['stroke'].startswith('smash')]
rally = sum(p['end']['rally'] for p in pts) / n
print(f"log pts={won/n:.3f} n={n} rally={rally:.1f} smash/pt={len(sm)/n:.2f} smashLands={sum(1 for h in sm if h['land'] and h['land']['table'] and h['land']['z'] < 0)/max(1,len(sm)):.2f}",
      ' '.join(f"{k}={v/n:.2f}" for k, v in sorted(why.items())), ' '.join(f"{k}{100*v/tot:.0f}%" for k, v in sorted(st.items())))
