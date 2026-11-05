#!/bin/sh
# Smart vs plain CPU (duel.mjs iq mode): the near CPU at iq SMART_IQ, the far one at PLAIN_IQ, then
# swapped, RUNS times each. Prints the smart side's point and game share (0.5 = no better).
# Usage: sim/iq.sh LEVEL POINTS [RUNS] [SMART_IQ] [PLAIN_IQ]   env: TUNE='{"SMART":{...}}'
L=${1:-medium}; N=${2:-600}; K=${3:-3}; S=${4:-1}; D=${5:-0}
set --; for i in $(seq "$K"); do
  set -- "$@" "{\"level\":\"$L\",\"points\":$N,\"iq\":{\"player\":$S,\"ai\":$D},\"tune\":${TUNE:-null}}" "{\"level\":\"$L\",\"points\":$N,\"iq\":{\"player\":$D,\"ai\":$S},\"tune\":${TUNE:-null}}"
done
node "$(dirname "$0")/duel.mjs" "$@" | python3 -c "
import json,sys
pts=[0,0]; g=[0,0]; jp=[0,0,0]; n=0; by=[{},{}]
for l in sys.stdin:
  d=json.loads(l); smartNear = d['run']['iq']['player']==$S
  tot=d['points']; sp=d['playerPts'] if smartNear else 1-d['playerPts']
  pts[0]+=sp*tot; pts[1]+=tot
  gs=d['games'] if smartNear else d['games'][::-1]; g[0]+=gs[0]; g[1]+=sum(gs)
  j=d['jutsuPerPt'] if smartNear else d['jutsuPerPt'][::-1]; jp[0]+=j[0]*tot; jp[1]+=j[1]*tot
  b=d['by'] if smartNear else d['by'][::-1]
  for i in (0,1):
    for k,(nn,ww) in b[i].items(): e=by[i].setdefault(k,[0,0]); e[0]+=nn; e[1]+=ww
print('smart pts %.3f  games %.3f (%d)  jutsu/pt smart %.3f plain %.3f  points %d'%(pts[0]/pts[1], g[0]/max(1,g[1]), g[1], jp[0]/pts[1], jp[1]/pts[1], pts[1]))
import os
if os.environ.get('BY'):
  for i,nm in ((0,'smart'),(1,'plain')): print('  %s:'%nm, ' '.join('%s %d/%d'%(k,v[1],v[0]) for k,v in sorted(by[i].items(), key=lambda kv:-kv[1][0])))
"
