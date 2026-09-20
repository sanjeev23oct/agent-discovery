#!/usr/bin/env bash
# Two agents, two ports, one question. Ctrl-C to stop.
set -uo pipefail
cd "$(dirname "$0")"

node bob.ts   & BOB=$!
node alice.ts & ALICE=$!
trap 'kill $BOB $ALICE 2>/dev/null' EXIT
sleep 1.2

echo
echo "─── asking alice a maths question she cannot answer herself ───"
curl -sS -X POST http://localhost:5001 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","role":"user","messageId":"m1","parts":[{"kind":"text","text":"What is 12 * 34 + 7?"}]}}}' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).result;console.log("\nstate:",t.status.state);console.log("answer:",t.artifacts[0].parts[0].text)})'
echo
