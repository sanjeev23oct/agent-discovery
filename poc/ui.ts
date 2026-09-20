/**
 * A live view of the prod-support scenario (port 5099).
 *
 * Shows every agent's card, the registry's current tag index, and streams
 * the real trace events agents emit while discovering and calling each
 * other. Nothing here is simulated: every row in the timeline is an event
 * an agent actually reported.
 */
import http from "node:http";
import { UI_HTML } from "./ui-html.ts";

const PORT = Number(process.env.UI_PORT ?? 5099);
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:5010";
const COMMANDER_URL = process.env.COMMANDER_URL ?? "http://localhost:5001";

// Every agent the dashboard knows how to show a card for. The registry may
// know about more (anything that registers itself), but this fixed list is
// what the "Agents" panel renders -- the registry panel below it is what
// shows what is *actually* registered right now.
const AGENTS: { key: string; name: string; url: string }[] = [
  { key: "commander", name: "prod-support", url: COMMANDER_URL },
  { key: "splunk", name: "splunk", url: "http://localhost:5011" },
  { key: "servicenow", name: "servicenow", url: "http://localhost:5012" },
  { key: "jira", name: "jira", url: "http://localhost:5013" },
  { key: "pagerduty", name: "pagerduty", url: "http://localhost:5014" },
];

type Event = { actor: string; kind: string; detail: string; at: number; [k: string]: unknown };
const listeners = new Set<(e: Event) => void>();

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const json = (code: number, body: unknown) => {
    const s = JSON.stringify(body);
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
    res.end(s);
  };

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(UI_HTML);
  }

  // Agents POST their trace events here.
  if (req.method === "POST" && url.pathname === "/trace") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const event = JSON.parse(raw) as Event;
      for (const send of listeners) send(event);
    } catch {}
    return json(200, { ok: true });
  }

  // Browser subscribes to the live timeline.
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: Event) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    listeners.add(send);
    req.on("close", () => listeners.delete(send));
    return;
  }

  // Every known agent's card, fetched live. The x-poc-ui-poll header tells
  // the agent this is dashboard housekeeping, not a protocol event -- see
  // mini.ts's card-served handler for why that matters to the timeline.
  if (url.pathname === "/cards") {
    const load = async (a: (typeof AGENTS)[number]) => {
      try {
        const r = await fetch(`${a.url}/.well-known/agent-card.json`, {
          signal: AbortSignal.timeout(4000),
          headers: { "x-poc-ui-poll": "1" },
        });
        return { key: a.key, ok: r.ok, base: a.url, card: r.ok ? await r.json() : null };
      } catch (e) {
        return { key: a.key, ok: false, base: a.url, card: null, error: e instanceof Error ? e.message : String(e) };
      }
    };
    return json(200, { agents: await Promise.all(AGENTS.map(load)) });
  }

  // The registry's own tag index -- this answers "where is the registry".
  if (url.pathname === "/registry") {
    try {
      const r = await fetch(`${REGISTRY_URL}/index`, { signal: AbortSignal.timeout(4000) });
      return json(200, { ok: r.ok, url: REGISTRY_URL, ...(await r.json()) });
    } catch (e) {
      return json(200, { ok: false, url: REGISTRY_URL, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Ask the commander a question; the trace arrives over /events as it happens.
  if (req.method === "POST" && url.pathname === "/ask") {
    let raw = "";
    for await (const c of req) raw += c;
    const { text } = JSON.parse(raw || "{}");
    try {
      const r = await fetch(COMMANDER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "ui", method: "message/send",
          params: { message: { kind: "message", role: "user", messageId: `ui-${Date.now()}`,
                               parts: [{ kind: "text", text }] } },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await r.json();
      return json(200, { result: body.result, error: body.error });
    } catch (e) {
      return json(200, { error: { message: e instanceof Error ? e.message : String(e) } });
    }
  }

  json(404, { error: "not found" });
}).listen(PORT, () => {
  console.log(`[ui] open http://localhost:${PORT}`);
  console.log(`[ui] commander=${COMMANDER_URL} registry=${REGISTRY_URL}`);
});
