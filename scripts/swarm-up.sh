#!/usr/bin/env bash
# Start the whole swarm: registry + 3 TypeScript agents + 2 Python agents.
# Logs go to .swarm/logs/, PIDs to .swarm/pids so swarm-down.sh can stop them.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
mkdir -p .swarm/logs
: > .swarm/pids

start() {
  local name="$1"; shift
  "$@" > ".swarm/logs/$name.log" 2>&1 &
  echo "$!" >> .swarm/pids
  printf '  %-14s pid %-7s log .swarm/logs/%s.log\n' "$name" "$!" "$name"
}

echo "starting swarm..."
start registry     node ts/registry/server.ts
sleep 0.7   # let the registry bind before agents try to register
start researcher   node ts/agents/researcher.ts
start orchestrator node ts/agents/orchestrator.ts
start notifier     node ts/agents/notifier.ts
start summarizer   "$PY" py/agents/summarizer.py
start translator   "$PY" py/agents/translator.py

echo
echo "waiting for registration..."
for _ in $(seq 1 40); do
  count=$(curl -fsS http://localhost:4000/agents 2>/dev/null | grep -c '"name"' || true)
  [ "${count:-0}" -ge 5 ] && break
  sleep 0.25
done

echo
curl -fsS http://localhost:4000/skills 2>/dev/null \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const s of JSON.parse(d).skills)console.log(`  ${s.agent.padEnd(14)} ${s.id.padEnd(18)} [${s.tags.join(", ")}]`)})' \
  || echo "  (registry not answering yet -- check .swarm/logs/registry.log)"

echo
echo "swarm is up. try:"
echo "  ./scripts/demo-discovery.sh"
echo "  ./scripts/demo-orchestrator.sh"
echo "  ./scripts/demo-handoff.sh"
echo "  tail -f .swarm/logs/*.log"
echo "  ./scripts/swarm-down.sh"
