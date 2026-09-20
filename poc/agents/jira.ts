/**
 * Jira agent (mock) -- port 5013.
 *
 * Stands in for a real Jira integration. Files a bug ticket in an
 * in-memory counter and hands back a key in Jira's usual shape
 * (PROJ-10xx). No real Jira instance is involved.
 */
import { serve, registerWithRegistry } from "../mini.ts";

const PORT = Number(process.env.PORT ?? 5013);
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:5010";

let nextTicket = 1041;

const { card, ready } = serve({
  name: "jira (mock)",
  description: "Files engineering tickets. Mock -- not a real Jira instance.",
  port: PORT,
  skills: [
    {
      id: "ticket.create",
      description: "File a bug ticket for engineering to investigate or fix.",
      tags: ["jira", "ticket", "bug-tracker", "engineering"],
    },
  ],
  handle: (text) => {
    const key = `PROJ-${nextTicket++}`;
    const priority = /critical|active spike|urgent/i.test(text) ? "Highest" : "High";
    return `${key} filed. Type: Bug. Priority: ${priority}. Description: ${text.slice(0, 160)}`;
  },
});

await ready;
await registerWithRegistry(REGISTRY_URL, card.url, "jira (mock)");
