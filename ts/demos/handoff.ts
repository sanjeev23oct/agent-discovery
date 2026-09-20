/**
 * Demo 3 -- Peer-to-peer handoff (decentralised swarm).
 *
 * We send one message to the researcher and never speak to anyone else. The
 * `route` metadata lists capabilities, not addresses: each agent resolves the
 * next hop itself, through the registry, at the moment it finishes its own work.
 *
 * researcher (TS) -> summarizer (PY) -> translator (PY) -> notifier (TS)
 */
import { A2AClient, taskOutput } from "../a2a/client.ts";

const topic = process.argv.slice(2).join(" ") || "agent swarms";
const route = ["summarize", "translate", "notify"];

console.log(`\ntopic: ${topic}`);
console.log(`route (capabilities, not addresses): ${route.join(" -> ")}\n`);

const researcher = await A2AClient.connect("http://localhost:4101");
const task = await researcher.send(topic, {
  skill: "research.gather",
  metadata: { route, hops: [] },
});

console.log(`task ${task.id}  state=${task.status.state}  context=${task.contextId}\n`);
console.log("result after the chain came back:");
console.log(taskOutput(task));
console.log();
console.log("No agent knew the full chain. Each one asked the registry 'who does X next?'");
console.log("Kill the translator and re-run: the chain re-routes around it automatically.");
console.log();
