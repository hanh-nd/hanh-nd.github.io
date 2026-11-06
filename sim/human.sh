#!/bin/sh
# The human-like bot (bot.js H.real) against what real play logged (sim/bench/logstats.py), same terms.
# Usage: sim/human.sh [LEVEL] [MATCHES] [POLICIES]   (POLICIES: you youBlock; HUMAN='"reaction":0.22,...')
L=${1:-hard}; N=${2:-20}; S=${3:-"you youBlock"}
HU=${HUMAN:-"\"real\":true,\"reaction\":0.22,\"posErr\":0.04,\"timeErr\":0.015,\"smashV\":16,\"smashSl\":[2,6],\"takeDepth\":1.9,\"home\":1.6"}
args=""
for s in $S; do args="$args {\"tune\":${TUNE:-null},\"name\":\"$s\",\"policy\":\"$s\",\"pool\":[\"allround\"],\"matches\":$N,\"level\":\"$L\",\"human\":{$HU}}"; done
eval node sim/run.mjs $(for a in $args; do printf "'%s' " "$a"; done) | python3 -c "
import json,sys
for l in sys.stdin:
  d=json.loads(l); w=d['why']; r=max(1,d['rallies']); st=d['strokes']; tot=sum(st.values()) or 1; sm=max(1,d['smashes'])
  print('bot', d['run']['name'].ljust(8), 'pts=%.3f'%d['ptWin'], 'n=%d'%r, 'rally=%.1f'%d['avgRally'], 'smash/pt=%.2f'%(d['smashes']/r), 'smashLands=%.2f'%((d['smashWin']+d['smashRet'])/sm),
    ' '.join('%s=%.2f'%(k,sum(v for kk,v in w.items() if kk.split(':')[:2]==k.split(':'))/r) for k in ('lost:myErr','lost:noReturn','won:cpuErr','won:cpuMissed')), 'smashWon=%.2f'%(d['smashWin']/sm), ' '.join('%s%.0f%%'%(k,100*v/tot) for k,v in sorted(st.items())),
    ' nr:', ' '.join('%s=%d'%(k[3:],v) for k,v in sorted(w.items()) if k.startswith('nr:')))
"
