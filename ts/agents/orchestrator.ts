/**
 * Orchestrator (TypeScript) -- the centralised swarm pattern.
 *
 * It owns the plan. It discovers specialists at runtime through the registry,
 * delegates each step, and merges the results. Nothing about the specialists is
 * hardcoded: add a new agent to the swarm and the orchestrator can use it
 * without a redeploy, as long as its card advertises the right tags.
 *
 * Contrast with ts/a2a/handoff.ts, where no single agent holds the plan.
 */
import { createAgent } from "../a2a/server.ts";
import { register, discover, findOne } from "../a2a/registry-client.ts";
import { taskOutput } from "../a2a/client.ts";
import { textPart } from "../a2a/types.ts";
import { plan } from "./planner.ts";
import type { Step } from "./planner.ts";

const PORT = Number(process.env.PORT ?? 4102);
// Public address other agents will use. Must not be localhost once exposed.
const BASE_URL = process.env.BASE_URL;

const agent = createAgent({
  name: "orchestrator",
  description: "Plans a request, discovers specialist agents, delegates to them, and merges the result.",
  port: PORT,
  baseUrl: BASE_URL,
  skills: [
    {
      id: "swarm.solve",
      name: "Solve with the swarm",
      description: "Decompose a request and delegate each step to a discovered specialist agent.",
      tags: ["orchestrate", "solve", "plan", "delegate"],
      examples: ["Research the A2A protocol and give me a short briefing in French"],
      handler: async (ctx) => {
        const contextId = ctx.task.contextId;

        const available = await discover({});
        ctx.log(`swarm has ${available.length} agent(s) online: ${available.map((a) => a.agent.name).join(", ")}`);

        // Planning is the seam where a model replaces rules. Either way the
        // plan is a list of capabilities resolved against the live registry.
        const { steps, reasoning, planner } = await plan(ctx.text, ctx.log);
        ctx.progress(`[${planner}] planned ${steps.length} step(s): ${steps.map((s: Step) => s.capability).join(" -> ")}`);
        ctx.log(`reasoning: ${reasoning}`);

        const trace: string[] = [];
        let payload = ctx.text;

        for (const step of steps) {
          const peer = await findOne({ tag: step.capability }, ["orchestrator"]);
          if (!peer) {
            ctx.log(`no agent advertises "${step.capability}" -- skipping`);
            trace.push(`${step.capability}: SKIPPED (nobody advertises it)`);
            continue;
          }
          const name = peer.client.card.name;
          ctx.progress(`delegating "${step.capability}" to ${name}`);

          // The instruction travels as metadata, NOT prepended to the content.
          // Mixing them means the next agent summarises/translates your own
          // instructions along with the payload -- a real and common bug.
          const task = await peer.client.send(payload, {
            contextId, // every specialist works inside the same conversation
            skill: peer.skillId,
            metadata: {
              instruction: step.instruction,
              // Empty route: the orchestrator owns the plan, so peers must not hand off.
              route: [],
              hops: ["orchestrator"],
              delegatedBy: "orchestrator",
            },
          });

          if (task.status.state !== "completed") {
            trace.push(`${step.capability}: ${name} -> ${task.status.state}`);
            ctx.log(`${name} returned ${task.status.state}, keeping previous payload`);
            continue;
          }
          payload = taskOutput(task);
          trace.push(`${step.capability}: ${name} (task ${task.id})`);
        }

        return {
          parts: [
            textPart(payload),
            { kind: "data", data: { planner, reasoning, plan: steps.map((s: Step) => s.capability), trace, contextId } },
          ],
          artifactName: "swarm-result",
          metadata: { steps: steps.length, planner, contextId },
        };
      },
    },
  ],
});

await agent.listen();
await register(agent.card.url);
