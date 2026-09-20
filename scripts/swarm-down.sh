#!/usr/bin/env bash
# Stop every process started by swarm-up.sh.
set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .swarm/pids ]; then
  echo "no .swarm/pids -- nothing to stop"
  exit 0
fi

while read -r pid; do
  [ -z "$pid" ] && continue
  if kill "$pid" 2>/dev/null; then
    echo "  stopped pid $pid"
  fi
done < .swarm/pids

rm -f .swarm/pids
echo "swarm down."
