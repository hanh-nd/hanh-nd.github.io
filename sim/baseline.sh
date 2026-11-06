#!/bin/sh
# Build sim/_baseline/ (the whole game tree) from an older commit (default: HEAD), with the test hook
# the sim needs, so the same bots can play it: SIM_URL=http://localhost:8765/sim/_baseline/index.html
# (sim/compare.sh does that by default). Usage: sim/baseline.sh [commit]
set -e
cd "$(dirname "$0")/.."
rm -rf sim/_baseline && mkdir sim/_baseline
git archive "${1:-HEAD}" index.html $(git ls-tree --name-only "${1:-HEAD}" | grep -E '^(js|css)$') | tar -x -C sim/_baseline
python3 - <<'PY'
import os
# Before the split into js/ (single-file builds), the hook lived in index.html — and older ones lacked parts of it.
p = 'sim/_baseline/index.html'
if not os.path.exists('sim/_baseline/js/main.js'):
    s = open(p).read()
    if 'test: {' not in s:
        old = "get simTime() { return simTime; } };"
        assert s.count(old) == 1, 'unknown PingPong hook layout'
        s = s.replace(old, "get simTime() { return simTime; }, test: { fixedUpdate, beginToss, setOpponent, setHome, ROSTER, ADAPT, AI_COMMON, AI_STYLES, AI_LEVELS, SIGNATURES, yourTurn, youServe, canHit, chakra } };")
    if 'touchSens' not in s.split('test: {', 1)[1][:300]:   # the bot sets your touch sensitivity (H.sens)
        s = s.replace('test: {', 'test: { touchSens,', 1)
    open(p, 'w').write(s)
PY
echo "sim/_baseline/ <- ${1:-HEAD}"
