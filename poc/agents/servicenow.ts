/**
 * ServiceNow agent (mock) -- port 5012.
 *
 * Stands in for a real ITSM integration. Opens an incident record in an
 * in-memory counter and hands back a ticket number in ServiceNow's usual
 * shape (INC00100xx). No real ServiceNow instance is involved.
 */
import { serve, registerWithRegistry } from "../mini.ts";

const PORT = Number(process.env.PORT ?? 5012);
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:5010";

let nextIncident = 10042;

const { card, ready } = serve({
  name: "servicenow (mock)",
  description: "Opens and tracks incident records. Mock -- not a real ServiceNow instance.",
  port: PORT,
  skills: [
    {
      id: "incident.create",
      description: "Open an incident record for an active production issue.",
      tags: ["itsm", "incident", "servicenow", "ticketing"],
    },
  ],
  handle: (text) => {
    const id = `INC00${nextIncident++}`;
    const priority = /critical|active spike|urgent/i.test(text) ? "P1 - Critical" : "P3 - Moderate";
    return `${id} opened. Priority: ${priority}. Assigned to: SRE-OnCall queue. Summary: ${text.slice(0, 140)}`;
  },
});

await ready;
await registerWithRegistry(REGISTRY_URL, card.url, "servicenow (mock)");
