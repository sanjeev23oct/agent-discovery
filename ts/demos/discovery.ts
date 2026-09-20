/**
 * Demo 1 -- Discovery.
 *
 * Shows the two layers: an Agent Card fetched directly from an agent you
 * already know the address of, and a registry query that finds agents you
 * did not know existed.
 */
import { fetchAgentCard } from "../a2a/client.ts";
import { discover, REGISTRY_URL } from "../a2a/registry-client.ts";

const line = (s = "") => console.log(s);
const rule = (t: string) => {
  line();
  line(`── ${t} ${"─".repeat(Math.max(0, 62 - t.length))}`);
};

rule("1. Direct discovery: read one agent's card");
const card = await fetchAgentCard("http://localhost:4101");
line(`${card.name} v${card.version}  (A2A ${card.protocolVersion}, ${card.preferredTransport})`);
line(`  ${card.description}`);
line(`  endpoint: ${card.url}`);
line(`  streaming: ${card.capabilities.streaming}`);
for (const s of card.skills) {
  line(`  skill "${s.id}" -- ${s.description}`);
  line(`    tags: ${s.tags.join(", ")}`);
}

rule("2. Registry discovery: who is in this swarm?");
const all = await discover({});
line(`${REGISTRY_URL} knows ${all.length} online agent(s):`);
for (const r of all) {
  line(`  ${r.agent.name.padEnd(14)} ${r.agent.url.padEnd(24)} ${r.agent.skills.map((s) => s.id).join(", ")}`);
}

rule("3. Capability query: who can translate?");
const translators = await discover({ tag: "translate" });
for (const r of translators) {
  line(`  ${r.agent.name} -> matched skill(s): ${r.matchedSkills.join(", ")}`);
}
if (translators.length === 0) line("  nobody -- and the swarm degrades gracefully rather than erroring");

rule("4. Free-text query: 'shorten'");
for (const r of await discover({ q: "shorten" })) {
  line(`  ${r.agent.name} -> ${r.matchedSkills.join(", ")}`);
}

line();
line("Note: nothing above hardcoded an agent list. That is the whole point --");
line("add an agent to the swarm and it becomes usable without any redeploy.");
line();
