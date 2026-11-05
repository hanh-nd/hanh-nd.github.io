#!/bin/sh
# Build sim/_baseline.html from an older commit (default: HEAD) with the test hook the sim needs,
# so sim/compare.sh can play the same bots against it. Usage: sim/baseline.sh [commit]
set -e
cd "$(dirname "$0")/.."
git show "${1:-HEAD}:index.html" > sim/_baseline.html
python3 - <<'PY'
p = 'sim/_baseline.html'; s = open(p).read()
if 'test: {' not in s:
    old = "get simTime() { return simTime; } };"
    assert s.count(old) == 1, 'unknown PingPong hook layout'
    s = s.replace(old, "get simTime() { return simTime; }, test: { fixedUpdate, beginToss, setOpponent, setHome, ROSTER, ADAPT, AI_COMMON, AI_STYLES, AI_LEVELS, SIGNATURES, yourTurn, youServe, canHit, chakra } };")
    open(p, 'w').write(s)
PY
echo "sim/_baseline.html <- ${1:-HEAD}"
