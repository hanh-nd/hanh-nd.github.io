#!/bin/sh
# Jutsu duel table (CPU vs CPU, see duel.mjs). Usage: sim/duel.sh LEVEL POINTS [RUNS]   env: FOE=1 (foe has seals too), TUNE='{...}'
L=${1:-medium}; N=${2:-600}; K=${3:-4}
set --; for i in $(seq "$K"); do set -- "$@" "{\"level\":\"$L\",\"points\":$N,\"foeSeals\":${FOE:-false},\"tune\":${TUNE:-null}}"; done
node "$(dirname "$0")/duel.mjs" "$@" | python3 -c "
import json,sys
by={}; none=[0,0]; secs=0
for l in sys.stdin:
  d=json.loads(l); secs=max(secs,d['secs'])
  none[0]+=d['none']['n']; none[1]+=d['none']['n']*d['none']['rate']
  for k,v in d['by'].items(): e=by.setdefault(k,[0,0]); e[0]+=v['n']; e[1]+=v['n']*v['rate']
print('no jutsu: %.2f (%d)'%(none[1]/max(1,none[0]),none[0]), ' wall %ss'%secs)
for k,(n,w) in sorted(by.items(), key=lambda kv:-kv[1][1]/kv[1][0]): print('  %-11s %.2f  (%d)'%(k,w/n,n))
"
