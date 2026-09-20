#!/usr/bin/env bash
# Registry + four specialists + the prod-support commander, all traced, plus
# a live dashboard: every Agent Card, the registry's tag index, and a
# real-time trace of discovery and delegation as it happens.
#
# TRACE_URL just makes each process report what it's already doing -- POST
# /register, GET /agents?tag=X, message/send -- to a listener. Unset it and
# every agent behaves identically with no UI attached.
set -uo pipefail
cd "$(dirname "$0")"

UI_PORT="${UI_PORT:-5099}"
TRACE="http://localhost:${UI_PORT}/trace"

node ui.ts &
UI=$!
sleep 0.6

TRACE_URL="$TRACE" node registry.ts & REGISTRY=$!
sleep 0.8
TRACE_URL="$TRACE" node agents/splunk.ts     & SPLUNK=$!
TRACE_URL="$TRACE" node agents/servicenow.ts & SERVICENOW=$!
TRACE_URL="$TRACE" node agents/jira.ts       & JIRA=$!
TRACE_URL="$TRACE" node agents/pagerduty.ts  & PAGERDUTY=$!
sleep 0.8
TRACE_URL="$TRACE" node commander.ts & COMMANDER=$!
trap 'kill $UI $REGISTRY $SPLUNK $SERVICENOW $JIRA $PAGERDUTY $COMMANDER 2>/dev/null' EXIT
sleep 1

echo
echo "dashboard: http://localhost:${UI_PORT}"
echo "  - every agent's card, fetched live"
echo "  - the registry's tag index -- who is discoverable right now"
echo "  - report an issue, watch the commander discover + call specialists in real time"
echo
echo "press Ctrl-C to stop everything"
echo

if command -v open >/dev/null 2>&1; then open "http://localhost:${UI_PORT}"; fi

wait
