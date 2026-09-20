#!/usr/bin/env bash
# Usage: ./scripts/demo-orchestrator.sh ["your request here"]
set -euo pipefail
cd "$(dirname "$0")/.."
node ts/demos/orchestrator.ts "$@"
