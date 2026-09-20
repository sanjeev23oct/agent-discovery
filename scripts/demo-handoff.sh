#!/usr/bin/env bash
# Usage: ./scripts/demo-handoff.sh ["topic"]
set -euo pipefail
cd "$(dirname "$0")/.."
node ts/demos/handoff.ts "$@"
