/**
 * Splunk agent (mock) -- port 5011.
 *
 * Stands in for a real Splunk integration: a wrapper agent whose skill
 * searches logs and returns findings. The search results below are a small
 * canned dataset keyed by service name, not a real Splunk connection --
 * this demo has no network access to a real log platform and doesn't need
 * one to show the discovery and delegation mechanics.
 */
import { serve, registerWithRegistry } from "../mini.ts";

const PORT = Number(process.env.PORT ?? 5011);
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:5010";

/**
 * Canned findings. Each entry carries a `severity` the caller can act on:
 * "critical" (active incident, page someone), "warning" (worth a ticket,
 * nobody needs waking up), or "clean" (nothing to do).
 */
const FINDINGS: Record<string, { severity: "critical" | "warning" | "clean"; report: string }> = {
  checkout: {
    severity: "critical",
    report:
      "247 ERROR events in the last 15 minutes (baseline: 12) -- active spike. " +
      "Top signature: PaymentGatewayTimeoutException at checkout.PaymentController:142 (91% of errors). " +
      "First occurrence: 14:02 UTC, correlates with the payment-gateway-v2 deploy at 13:58 UTC.",
  },
  payment: {
    severity: "warning",
    report:
      "38 WARN events in the last hour (baseline: 30) -- elevated latency, no errors. " +
      "p95 on POST /v1/charge is 340ms (baseline 120ms). Trending up since 13:00 UTC.",
  },
};

const { card, ready } = serve({
  name: "splunk (mock)",
  description: "Searches application logs for errors and anomalies. Mock -- not a real Splunk connection.",
  port: PORT,
  skills: [
    {
      id: "logs.search",
      description: "Search a service's logs for recent errors, spikes or anomalies.",
      tags: ["logs", "splunk", "search", "observability"],
    },
  ],
  handle: (text) => {
    const service = Object.keys(FINDINGS).find((k) => text.toLowerCase().includes(k));
    if (!service) return "clean :: No anomalies found for that query in the last 24h. All error rates within baseline.";
    const { severity, report } = FINDINGS[service];
    return `${severity} :: ${report}`;
  },
});

await ready;
await registerWithRegistry(REGISTRY_URL, card.url, "splunk (mock)");
