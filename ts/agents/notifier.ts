/**
 * Notifier (TypeScript) -- typically the last hop in a chain.
 *
 * Formats whatever it is handed into a deliverable. It has no idea who called
 * it or how many agents touched the work before it: it just sees text and a
 * contextId, which is the whole point of a protocol boundary.
 */
import { createAgent } from "../a2a/server.ts";
import { register } from "../a2a/registry-client.ts";
import { readHandoff, forward } from "../a2a/handoff.ts";
import { textPart } from "../a2a/types.ts";

const PORT = Number(process.env.PORT ?? 4103);
// Public address other agents will use. Must not be localhost once exposed.
const BASE_URL = process.env.BASE_URL;

const agent = createAgent({
  name: "notifier",
  description: "Formats finished work into a deliverable briefing and 'publishes' it.",
  port: PORT,
  baseUrl: BASE_URL,
  skills: [
    {
      id: "notify.publish",
      name: "Publish briefing",
      description: "Wrap finished content in a dated briefing and deliver it.",
      tags: ["notify", "publish", "deliver"],
      examples: ["Publish this summary as a briefing"],
      handler: async (ctx) => {
        const { hops } = readHandoff(ctx.message);
        const trail = [...hops, "notifier"].join(" -> ");
        ctx.progress("formatting briefing");

        const briefing = [
          "=== BRIEFING ===",
          `date:    ${new Date().toISOString().slice(0, 10)}`,
          `context: ${ctx.task.contextId}`,
          `path:    ${trail}`,
          "",
          ctx.text,
          "",
          "=== END ===",
        ].join("\n");

        // Almost always null here, but the notifier does not assume it is last.
        const downstream = await forward({
          message: ctx.message,
          selfName: "notifier",
          output: briefing,
          contextId: ctx.task.contextId,
          log: ctx.log,
        });

        return { parts: [textPart(downstream ?? briefing)], artifactName: "briefing", metadata: { hops: trail } };
      },
    },
  ],
});

await agent.listen();
await register(agent.card.url);
