/**
 * Prod-support agent -- port 5001. The entry point.
 *
 * Given "investigate X", it does not know Splunk, ServiceNow, Jira or
 * PagerDuty exist. For every step it asks the registry "who offers this
 * capability" by tag, gets back whichever agent currently provides it, and
 * calls that agent. Nothing here names an agent or a port -- only tags:
 * "logs", "incident", "bug-tracker", "oncall".
 *
 * That is the entire point of this file. Compare it with poc/registry.ts's
 * findByTag(): the commander never knows an address, only a capability.
 */
import { serve, findByTag, call, registerWithRegistry } from "./mini.ts";

const PORT = Number(process.env.PORT ?? 5001);
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:5010";

function severityOf(splunkAnswer: string): "critical" | "warning" | "clean" {
  if (splunkAnswer.startsWith("critical")) return "critical";
  if (splunkAnswer.startsWith("warning")) return "warning";
  return "clean";
}

const { card, ready } = serve({
  name: "prod-support",
  description: "Investigates a production issue by discovering and delegating to whatever specialists are registered.",
  port: PORT,
  skills: [
    {
      id: "incident.investigate",
      description: "Investigate a reported production issue: check logs, open an incident and a ticket, and escalate if it's critical.",
      tags: ["support", "investigate", "triage"],
    },
  ],
  handle: async (text) => {
    const steps: string[] = [];

    // ---- 1. logs: discover whoever is tagged "logs" and ask them ----
    const logs = await findByTag(REGISTRY_URL, "logs", "prod-support");
    if (!logs) return "I couldn't find a logs agent registered. Nothing to investigate with.";
    const finding = await call(logs.card, text, logs.matchedSkill, "prod-support");
    steps.push(`Logs (${logs.card.name}): ${finding}`);

    const severity = severityOf(finding);
    if (severity === "clean") {
      return [`Investigated: "${text}"`, ...steps, "", "No anomalies found. No incident opened."].join("\n");
    }

    // ---- 2. incident: discover whoever is tagged "incident" ----
    const incidentAgent = await findByTag(REGISTRY_URL, "incident", "prod-support");
    let incidentRef = "";
    if (incidentAgent) {
      const incidentText = await call(
        incidentAgent.card, `${text} -- ${finding}`, incidentAgent.matchedSkill, "prod-support",
      );
      steps.push(`Incident (${incidentAgent.card.name}): ${incidentText}`);
      incidentRef = incidentText.split(" ")[0]; // e.g. "INC0010042"
    } else {
      steps.push("Incident: no incident agent registered -- skipped.");
    }

    // ---- 3. bug-tracker: discover whoever is tagged "bug-tracker" ----
    const ticketAgent = await findByTag(REGISTRY_URL, "bug-tracker", "prod-support");
    if (ticketAgent) {
      const ticketText = await call(
        ticketAgent.card, `${text} -- ${finding}${incidentRef ? ` -- ref ${incidentRef}` : ""}`,
        ticketAgent.matchedSkill, "prod-support",
      );
      steps.push(`Ticket (${ticketAgent.card.name}): ${ticketText}`);
    } else {
      steps.push("Ticket: no bug-tracker agent registered -- skipped.");
    }

    // ---- 4. oncall: only for a critical finding, discover whoever is tagged "oncall" ----
    if (severity === "critical") {
      const oncallAgent = await findByTag(REGISTRY_URL, "oncall", "prod-support");
      if (oncallAgent) {
        const pageText = await call(
          oncallAgent.card, `${text} -- ${finding}${incidentRef ? ` -- ref ${incidentRef}` : ""}`,
          oncallAgent.matchedSkill, "prod-support",
        );
        steps.push(`Escalation (${oncallAgent.card.name}): ${pageText}`);
      } else {
        steps.push("Escalation: this looks critical but no on-call agent is registered -- nobody was paged.");
      }
    }

    return [`Investigated: "${text}"  (severity: ${severity})`, ...steps].join("\n");
  },
});

await ready;
await registerWithRegistry(REGISTRY_URL, card.url, "prod-support");
