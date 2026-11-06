# Your smashes in a play log: where they're met and land, how fast, what the CPU does next.
#   python3 sim/bench/smashcmp.py LOG.json [match indexes]
import json, sys, statistics as S
from collections import Counter
d = json.load(open(sys.argv[1]))
idx = [int(i) for i in sys.argv[2].split(',')] if len(sys.argv) > 2 else range(len(d['matches']))
pts = [p for i in idx for p in d['matches'][i]['points']]
sm, after = [], Counter()
for p in pts:
    hs = p['hits']
    for i, h in enumerate(hs):
        if h['who'] == 'you' and h.get('stroke', '').startswith('smash'):
            sm.append(h); n = hs[i + 1] if i + 1 < len(hs) else None
            after[n.get('kind') if n else ('cpu missed' if p['end']['winner'] == 'you' else 'smash err')] += 1
ok = [h for h in sm if h.get('land') and h['land']['table'] and h['land']['z'] < 0]
md = lambda f, hs=ok: round(S.median(f(h) for h in hs), 2)
print(sys.argv[1].split('/')[-1], 'n', len(sm), 'h', md(lambda h: h['h'], sm), 'z', md(lambda h: h['pos'][2], sm), 'x', md(lambda h: abs(h['pos'][0]), sm),
      'speedOut', md(lambda h: h['speedOut']), '|landx|', md(lambda h: abs(h['land']['x'])), 'landz', md(lambda h: h['land']['z']),
      'wide(>.6)', round(sum(abs(h['land']['x']) > 0.6 for h in ok) / max(1, len(ok)), 2), 'apex', md(lambda h: h['apex']))
print('   after', ' '.join(f'{k}={v/len(sm):.2f}' for k, v in after.most_common()))
