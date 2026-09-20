/**
 * A live view of the two-agent POC (port 5000).
 *
 * Shows both Agent Cards side by side, and streams the real trace events the
 * agents emit while they discover and call each other. Nothing here is
 * simulated: every row in the timeline is an event an agent actually reported.
 */
import http from "node:http";
import { UI_HTML } from "./ui-html.ts";

const PORT = Number(process.env.UI_PORT ?? 5099);
const ALICE = process.env.ALICE_URL ?? "http://localhost:5001";
const BOB = process.env.BOB_URL ?? "http://localhost:5002";

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

  // The agents POST their trace events here.
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

  // Both cards, fetched live from the agents themselves.
  if (url.pathname === "/cards") {
    const load = async (base: string) => {
      try {
        const r = await fetch(`${base}/.well-known/agent-card.json`, {
          signal: AbortSignal.timeout(4000),
          headers: { "x-poc-ui-poll": "1" }, // this is housekeeping, not a protocol event -- see mini.ts
        });
        return { ok: r.ok, base, card: r.ok ? await r.json() : null };
      } catch (e) {
        return { ok: false, base, card: null, error: e instanceof Error ? e.message : String(e) };
      }
    };
    return json(200, { alice: await load(ALICE), bob: await load(BOB) });
  }

  // Ask alice a question; the trace arrives over /events as it happens.
  if (req.method === "POST" && url.pathname === "/ask") {
    let raw = "";
    for await (const c of req) raw += c;
    const { text } = JSON.parse(raw || "{}");
    try {
      const r = await fetch(ALICE, {
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
  console.log(`[ui] watching alice=${ALICE} bob=${BOB}`);
});
