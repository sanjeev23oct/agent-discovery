/**
 * Researcher (TypeScript) -- entry point of the peer-to-peer demo.
 *
 * Gathers raw findings on a topic, then hands the work onward to whoever the
 * registry says can handle the next capability. It never learns the full chain.
 */
import { createAgent } from "../a2a/server.ts";
import { register } from "../a2a/registry-client.ts";
import { forward } from "../a2a/handoff.ts";
import { textPart } from "../a2a/types.ts";

const PORT = Number(process.env.PORT ?? 4101);
// Public address other agents will use. Must not be localhost once exposed.
const BASE_URL = process.env.BASE_URL;

/** Stand-in for a real tool call (search API, database, vector store, an LLM). */
const NOTES: Record<string, string[]> = {
  a2a: [
    "A2A is an open protocol for agent-to-agent communication, donated to the Linux Foundation.",
    "Agents describe themselves with an Agent Card served at a well-known URL.",
    "Work is modelled as stateful Tasks, not one-shot request/response.",
  ],
  swarm: [
    "A swarm is many narrow agents cooperating, rather than one agent with many tools.",
    "Coordination can be centralised (an orchestrator) or emergent (peer handoff).",
    "The tradeoff is legibility versus adaptability.",
  ],
  mcp: [
    "MCP connects an agent to tools and data; A2A connects an agent to other agents.",
    "They are complementary layers, not competitors.",
  ],
};

function research(topic: string): string[] {
  const key = Object.keys(NOTES).find((k) => topic.toLowerCase().includes(k));
  const found = key ? NOTES[key] : [];
  return found.length
    ? found
    : [
        `No local notes on "${topic}".`,
        "A production researcher would call a search tool or an LLM here.",
      ];
}

const agent = createAgent({
  name: "researcher",
  description: "Gathers raw findings on a topic from its note store.",
  port: PORT,
  baseUrl: BASE_URL,
  provider: { organization: "agent-discovery demo", url: "http://localhost:4000" },
  skills: [
    {
      id: "research.gather",
      name: "Gather findings",
      description: "Collect raw, unsummarised findings about a topic.",
      tags: ["research", "gather", "facts"],
      examples: ["Research the A2A protocol", "What do we know about agent swarms?"],
      handler: async (ctx) => {
        ctx.progress(`searching notes for "${ctx.text.slice(0, 60)}"`);
        const findings = research(ctx.text);
        const output = [`Findings on: ${ctx.text}`, ...findings.map((f) => `- ${f}`)].join("\n");

        // Decentralised step: ask the registry who is next, not a coordinator.
        const downstream = await forward({
          message: ctx.message,
          selfName: "researcher",
          output,
          contextId: ctx.task.contextId,
          log: ctx.log,
        });

        return {
          parts: [textPart(downstream ?? output)],
          artifactName: "findings",
          metadata: { handedOff: downstream !== null, findingCount: findings.length },
        };
      },
    },
  ],
});

await agent.listen();
await register(agent.card.url);
