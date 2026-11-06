#!/bin/sh
# The human-like bot (bot.js human.real, fitted to real play logged with ?log) in your three ways to
# play, against every CPU style in turn (POOL='["allround"]' for one style,
# OPP='"Ma Long"' for one player). Point share and how points end,
# in the terms of sim/bench/logstats.py.
#   sim/human.sh [LEVEL] [MATCHES] [POLICIES]      POLICIES: you youSpin youBlock mixer (default: the first three)
#   SIM_URL=http://localhost:8765/sim/_baseline/index.html sim/human.sh ...   (the live version: sim/baseline.sh)
L=${1:-hard}; N=${2:-20}; S=${3:-"you youSpin youBlock"}
# The finger, as logged (iPhone, sensitivity 2×): see README "Human-like bot".
F='"real":true,"sens":2,"reaction":0.22,"posErr":0.055,"timeErr":0.015,"smashV":8,"smashSl":[8,15],"smashDur":0.25,"smashZ":1.6,"sideSl":[10,15],"sideV":[2,5],"sideDur":0.15,"driveV":[3,7]'
args=""
for s in $S; do
  case $s in
    you)      W='"take":"drop","dropH":0.17,"takeDepth":2.0,"home":1.6' ;;   # lets the ball come, smashes it early
    youSpin)  W='"takeDepth":1.7,"home":1.55' ;;
    youBlock) W='"takeDepth":1.6,"home":1.5' ;;                            # at the table
    mixer)    W='"takeDepth":1.7,"home":1.55' ;;                           # plays the combos (COMBO)
  esac
  args="$args {\"tune\":${TUNE:-null},\"name\":\"$s\",\"policy\":\"$s\",\"pool\":${POOL:-null},\"opp\":${OPP:-null},\"matches\":$N,\"level\":\"$L\",\"human\":{$F,$W${HUMAN:+,$HUMAN}}}"
done
eval node sim/run.mjs $(for a in $args; do printf "'%s' " "$a"; done) | python3 -c "
import json,sys
for l in sys.stdin:
  d=json.loads(l); w=d['why']; r=max(1,d['rallies']); st=d['strokes']; tot=sum(st.values()) or 1; sm=max(1,d['smashes'])
  g=lambda k: sum(v for kk,v in w.items() if kk.split(':')[:2]==k.split(':'))/r
  print('$L', d['run']['name'].ljust(8), 'pts=%.3f'%d['ptWin'], 'won=%d/%d'%(d['won'],d['matches']), 'rally=%.1f'%d['avgRally'], 'smash/pt=%.2f'%(d['smashes']/r), 'cpuSmash/pt=%.2f'%(d['cpuSmash']/r),
    ' '.join('%s=%.2f'%(k,g(k)) for k in ('lost:myErr','lost:noReturn','won:cpuErr','won:cpuMissed')), ' '.join('%s%.0f%%'%(k,100*v/tot) for k,v in sorted(st.items())))
"
