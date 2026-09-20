#!/usr/bin/env bash
# Same two agents as run.sh, plus a live dashboard: both Agent Cards, and a
# real-time trace of discovery and delegation as they happen.
#
# The agents don't know a UI exists. TRACE_URL just makes them report what
# they're already doing -- fetching a card, matching a tag, calling a peer --
# to a listener. Unset the env var and they behave identically with no UI.
set -uo pipefail
cd "$(dirname "$0")"

UI_PORT="${UI_PORT:-5099}"

node ui.ts &
UI=$!
sleep 0.6

TRACE_URL="http://localhost:${UI_PORT}/trace" node bob.ts   & BOB=$!
TRACE_URL="http://localhost:${UI_PORT}/trace" node alice.ts & ALICE=$!
trap 'kill $UI $BOB $ALICE 2>/dev/null' EXIT
sleep 1

echo
echo "dashboard: http://localhost:${UI_PORT}"
echo "  - both Agent Cards, fetched live"
echo "  - ask alice a question, watch her discover + call bob in real time"
echo
echo "press Ctrl-C to stop all three"
echo

if command -v open >/dev/null 2>&1; then open "http://localhost:${UI_PORT}"; fi

wait
