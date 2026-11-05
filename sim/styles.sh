#!/bin/sh
# Each way to play vs the CPU: one-style bots (skilled finger) — point share, how often the CPU smashes,
# how often your ball sits up for it (met above 0.38 m), rally length. Usage: sim/styles.sh LEVEL MATCHES [STYLES]
# STYLES: any of smasher mixed block chop spin drive (default: all). TUNE='{...}' overrides config.
L=${1:-medium}; N=${2:-20}; S=${3:-"smasher mixed block chop spin drive"}
SK=${SKILL:-"\"reaction\":0.15,\"posErr\":0.025,\"timeErr\":0.012,\"smashV\":16,\"smashSl\":[4,9]"}
args=""
for s in $S; do
  case $s in
    smasher) a="\"policy\":\"smash\",\"smashMinH\":0.2,\"human\":{$SK,\"takeDepth\":1.7}" ;;
    mixed)   a="\"policy\":\"mixed\",\"human\":{$SK,\"takeDepth\":1.7}" ;;
    block)   a="\"policy\":\"block\",\"human\":{$SK,\"takeDepth\":${BLOCK_DEPTH:-1.5}}" ;;
    chop)    a="\"policy\":\"chop\",\"human\":{$SK,\"take\":\"drop\",\"takeDepth\":${CHOP_DEPTH:-2.4},\"home\":${CHOP_HOME:-2.2}}" ;;
    spin)    a="\"policy\":\"spin\",\"human\":{$SK,\"takeDepth\":${SPIN_DEPTH:-2.0}}" ;;
    drive)   a="\"policy\":\"drive\",\"human\":{$SK,\"takeDepth\":1.7}" ;;
  esac
  args="$args {\"tune\":${TUNE:-null},\"name\":\"$s\",\"matches\":$N,\"level\":\"$L\",${KILL:+\"kill\":$KILL,}$a}"
done
eval node sim/run.mjs $(for a in $args; do printf "'%s' " "$a"; done) | python3 -c "
import json,sys
for l in sys.stdin:
  d=json.loads(l); w=d['why']; m=d.get('cpuMeet',{'n':1,'up':0,'sum':0}); r=max(1,d['rallies'])
  st=d['strokes']; tot=sum(st.values()) or 1
  print('$L', d['run']['name'].ljust(8), 'pts=%.3f'%d['ptWin'], 'won=%d/%d'%(d['won'],d['matches']), 'cpuSmash/pt=%.2f'%(d['cpuSmash']/r), 'yourSmash/pt=%.2f'%(d['smashes']/r), 'sitsUp=%.2f'%(m['up']/max(1,m['n'])), 'meetH=%.2f'%(m['sum']/max(1,m['n'])), 'rally=%.1f'%d['avgRally'],
    'won:cpuErr=%.2f'%(w.get('won:cpuErr',0)/r), 'spinErr=%.2f'%(d.get('spinWins',0)/r), 'won:cpuMissed=%.2f'%(w.get('won:cpuMissed',0)/r), 'lost:noRet=%.2f'%(w.get('lost:noReturn',0)/r), 'myErr=%.2f'%(sum(v for k,v in w.items() if k.startswith('lost:myErr'))/r),
    ' '.join('%s%.0f%%'%(k,100*v/tot) for k,v in sorted(st.items())))
"
