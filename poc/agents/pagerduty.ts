/**
 * PagerDuty agent (mock) -- port 5014.
 *
 * Stands in for a real on-call escalation integration. Pages a name off a
 * small fixed rotation and reports an acknowledgement time. No real
 * PagerDuty account is involved and nobody's phone actually rings.
 */
import { serve, registerWithRegistry } from "../mini.ts";

const PORT = Number(process.env.PORT ?? 5014);
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:5010";

const ROTATION = ["Priya Shah (SRE)", "Marcus Webb (SRE)", "Ana Torres (SRE)"];
let rotationIndex = 0;

const { card, ready } = serve({
  name: "pagerduty (mock)",
  description: "Pages the on-call engineer for critical incidents. Mock -- nobody is actually paged.",
  port: PORT,
  skills: [
    {
      id: "oncall.page",
      description: "Escalate a critical incident to the on-call engineer.",
      tags: ["oncall", "escalation", "pagerduty", "alerting"],
    },
  ],
  handle: (text) => {
    const engineer = ROTATION[rotationIndex++ % ROTATION.length];
    return `Paged ${engineer} via the checkout-service-P1 escalation policy. Acknowledged in 2m. Regarding: ${text.slice(0, 100)}`;
  },
});

await ready;
await registerWithRegistry(REGISTRY_URL, card.url, "pagerduty (mock)");
