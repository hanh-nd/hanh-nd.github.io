#!/bin/sh
# Every roster player (one row each, the hardest first is easy to spot) x the four policies at LEVEL, N matches each; one output file per player.
# (Names go in as JSON with   for spaces: human.sh splits its args on whitespace.)
L=${1:-hard}; N=${2:-4}
cd "$(dirname "$0")/.."; mkdir -p sim/_matrix
node -e "import('./js/config.js').then(m=>m.ROSTER.forEach(r=>console.log(r.name)))" 2>/dev/null > sim/_matrix/names.txt
while read n; do
  echo "$n"
done < sim/_matrix/names.txt | xargs -P 6 -I{} sh -c 'j=$(printf "%s" "{}" | sed "s/ /\\\\u0020/g"); OPP="\"$j\"" sh sim/human.sh '"$L $N"' "you youSpin youBlock mixer" > "sim/_matrix/'"$L"'-{}.txt" 2>&1'
# The table: each player's point share per policy, and the average.
python3 - "$L" <<'PY'
import glob,re,sys
L=sys.argv[1]; pol=['you','youSpin','youBlock','mixer']; rows=[]
for f in glob.glob(f'sim/_matrix/{L}-*.txt'):
    d={m.group(1):float(m.group(2)) for m in re.finditer(r'^\w+ (\w+)\s+pts=([\d.]+)',open(f).read(),re.M)}
    if d: rows.append((f.split(f'{L}-')[1][:-4],d))
print('player'.ljust(18),' '.join(p.rjust(8) for p in pol),'     avg')
for n,d in sorted(rows,key=lambda r:-sum(r[1].values())/len(r[1])):
    v=[d.get(p,float('nan')) for p in pol]; print(n[:18].ljust(18),' '.join(('%.2f'%x).rjust(8) for x in v),'   %.2f'%(sum(v)/len(v)))
PY
