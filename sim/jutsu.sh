#!/bin/sh
# Jutsu vs the CPU: the bot arms a jutsu whenever its seals pay for it. Reports the CPU's jutsu per
# point (does yours shut it out?), your point share, and the win rate of the points each jutsu was in.
# Usage: sim/jutsu.sh LEVEL MATCHES 'KIT,KIT,KIT:TIER' ...   (TIER 1-3 or max; no spec = no jutsu)
L=${1:-medium}; N=${2:-20}; shift 2
SK='"reaction":0.15,"posErr":0.025,"timeErr":0.012,"smashV":16,"smashSl":[4,9],"takeDepth":1.7'
args=""; set -- none "$@"
for spec in "$@"; do
  if [ "$spec" = none ]; then J=null; else
    kit=$(echo "${spec%%:*}" | sed 's/[^,]*/"&"/g'); tier=${spec##*:}; [ "$tier" = max ] && tier='"max"'
    J="{\"kit\":[$kit],\"tier\":$tier}"; fi
  args="$args
{\"tune\":${TUNE:-null},\"name\":\"$spec\",\"policy\":\"mixed\",\"matches\":$N,\"level\":\"$L\",\"human\":{$SK},\"jutsu\":$J}"
done
echo "$args" | sed '/^$/d' | tr '\n' '\0' | xargs -0 node sim/run.mjs | python3 -c "
import json,sys
for l in sys.stdin:
  d=json.loads(l); j=d.get('jutsu') or {}; r=max(1,d['rallies'])
  f=lambda m: ' '.join('%s:%d/%d'%(k,v['won'],v['n']) for k,v in sorted(m.items(), key=lambda kv:-kv[1]['n']))
  print(d['run']['name'][:40].ljust(40),'pts%%=%.3f'%d['ptWin'],'won=%d/%d'%(d['won'],d['matches']),'cpuJutsu/pt=%.2f'%(j.get('cpuPts',0)/r),'youJutsu/pt=%.2f'%(j.get('youPts',0)/r))
  if j.get('you'): print('   you (won/n):', f(j['you']))
  print('   cpu (cpu won/n):', f(j.get('cpu',{})))
"
