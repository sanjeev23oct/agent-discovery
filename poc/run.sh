#!/usr/bin/env bash
# A prod-support agent, a registry, and four specialist agents on six ports.
# Ctrl-C to stop.
set -uo pipefail
cd "$(dirname "$0")"

node registry.ts             & REGISTRY=$!
sleep 0.8
node agents/splunk.ts         & SPLUNK=$!
node agents/servicenow.ts     & SERVICENOW=$!
node agents/jira.ts           & JIRA=$!
node agents/pagerduty.ts      & PAGERDUTY=$!
sleep 0.8
node commander.ts             & COMMANDER=$!
trap 'kill $REGISTRY $SPLUNK $SERVICENOW $JIRA $PAGERDUTY $COMMANDER 2>/dev/null' EXIT
sleep 1

ask() {
  echo
  echo "─── $1 ───"
  curl -sS -X POST http://localhost:5001 \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"message/send\",\"params\":{\"message\":{\"kind\":\"message\",\"role\":\"user\",\"messageId\":\"m1\",\"parts\":[{\"kind\":\"text\",\"text\":\"$1\"}]}}}" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result.artifacts[0].parts[0].text))'
}

ask "Investigate error spike on checkout-service"
ask "Check auth-service health"
echo
