/**
 * Demo 2 -- Orchestrator + specialists (centralised swarm).
 *
 * One request goes to the orchestrator. It plans, discovers specialists through
 * the registry, delegates to each in turn, and merges. Watch the agent logs in
 * the other terminal to see the delegation land on Python and TypeScript agents
 * alike, all sharing one contextId.
 */
import { A2AClient, taskOutput } from "../a2a/client.ts";

const request =
  process.argv.slice(2).join(" ") ||
  "Research the A2A protocol and give me a short briefing in French";

console.log(`\nrequest: ${request}\n`);

const orchestrator = await A2AClient.connect("http://localhost:4102");
console.log(`connected to "${orchestrator.card.name}" -- ${orchestrator.card.description}\n`);

const task = await orchestrator.send(request, { skill: "swarm.solve" });

console.log(`task ${task.id}  state=${task.status.state}  context=${task.contextId}\n`);

const data = (task.artifacts ?? []).flatMap((a) => a.parts).find((p) => p.kind === "data");
if (data && data.kind === "data") {
  console.log("delegation trace:");
  for (const step of data.data.trace as string[]) console.log(`  ${step}`);
  console.log();
}

console.log("result:");
console.log(taskOutput(task));
console.log();
