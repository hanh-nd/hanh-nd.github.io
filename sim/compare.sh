#!/bin/sh
# Same bots vs the baseline (sim/_baseline.html) and the current game. Usage: sim/compare.sh LEVEL MATCHES
L=${1:-hard}; N=${2:-10}
SK='"reaction":0.15,"posErr":0.025,"timeErr":0.012,"smashV":16,"smashSl":[4,9],"takeDepth":1.7'
for url in ${URLS:-http://localhost:8765/sim/_baseline.html http://localhost:8765/index.html}; do
  SIM_URL=$url node sim/run.mjs \
    "{\"tune\":${TUNE:-null},\"name\":\"smash-all\",\"policy\":\"smash\",\"smashMinH\":0.12,\"matches\":$N,\"level\":\"$L\",\"human\":{$SK}}" \
    "{\"tune\":${TUNE:-null},\"name\":\"smasher\",\"policy\":\"smash\",\"smashMinH\":0.2,\"matches\":$N,\"level\":\"$L\",\"human\":{$SK}}" \
    "{\"tune\":${TUNE:-null},\"name\":\"mixed\",\"policy\":\"mixed\",\"matches\":$N,\"level\":\"$L\",\"human\":{$SK}}" \
  | python3 -c "
import json,sys
for l in sys.stdin:
  d=json.loads(l); w=d['why']; sm=d['smashes'] or 1
  print('$url'.split('/')[-1][:9], d['run']['name'].ljust(9), 'pts%%=%.3f'%d['ptWin'], 'won=%d/%d'%(d['won'],d['matches']), 'smash/pt=%.2f'%(d['smashes']/max(1,d['rallies'])), 'smash W/R/E=%d/%d/%d'%(d['smashWin'],d['smashRet'],d['smashErr']), 'smashRallyWon=%.2f'%(d.get('smashRalliesWon',0)/max(1,d.get('smashRallies',0))), 'rally=%.1f'%d['avgRally'], 'sitUp%%=%.3f'%(sum(v for k,v in d['hIn'].items() if k.startswith('normal') and k.split()[1] in ('.3-.45','.45-.7','>.7'))/max(1,sum(v for k,v in d['hIn'].items() if k.startswith('normal')))), 'afterSmashUp%%=%.2f'%(sum(v for k,v in d['hIn'].items() if k.startswith('after') and k.split()[1] in ('.3-.45','.45-.7','>.7'))/max(1,sum(v for k,v in d['hIn'].items() if k.startswith('after')))), 'overCap', d['hIn'].get('overCap',0), 'anti~%.2f'%(sum(d.get('anti',[0]))/max(1,len(d.get('anti',[1])))))
"
done
