#!/bin/sh
# Signature strength: CPU's point win % when it plays each signature, vs an unaware and an aware bot.
# Only the signature owners. Usage: TUNE='{...}' sim/sig.sh LEVEL MATCHES
L=${1:-hard}; N=${2:-32}
SK='"reaction":0.15,"posErr":0.025,"timeErr":0.012,"smashV":16,"smashSl":[4,9],"takeDepth":1.7'
OWN='["Joo Se-hyuk","Jan-Ove Waldner","Tomokazu Harimoto","Ma Long","Zhang Jike","Ding Ning","Kim Kyung-ah","Mima Ito"]'
SIM_URL=${URL:-http://localhost:8765/index.html} node sim/run.mjs \
  "{\"tune\":${TUNE:-null},\"name\":\"unaware\",\"policy\":\"mixed\",\"owners\":$OWN,\"matches\":$N,\"level\":\"$L\",\"human\":{$SK}}" \
  "{\"tune\":${TUNE:-null},\"name\":\"aware\",\"aware\":true,\"policy\":\"mixed\",\"owners\":$OWN,\"matches\":$N,\"level\":\"$L\",\"human\":{$SK}}" \
| python3 -c "
import json,sys
for l in sys.stdin:
  d=json.loads(l); sg=d['sig']; n=sum(v['n'] for v in sg.values()); w=sum(v['cpuWon'] for v in sg.values())
  print(d['run']['name'].ljust(8), 'pts%%=%.3f'%d['ptWin'], 'sig/pt=%.3f'%(n/max(1,d['rallies'])), 'sigKills=%.2f'%(w/max(1,n)), ' '.join('%s:%d/%d'%(k[:7],v['cpuWon'],v['n']) for k,v in sorted(sg.items())))
"
