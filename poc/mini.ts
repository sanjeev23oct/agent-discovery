/**
 * A2A in ~90 lines: enough to serve an Agent Card, answer JSON-RPC calls,
 * and call another agent. Shared by alice.ts and bob.ts.
 *
 * The full version lives in ../ts/a2a/. This one drops streaming, task
 * storage, cancellation and error codes so the shape stays visible.
 */
import http from "node:http";

export type Skill = { id: string; description: string; tags: string[] };
export type Card = {
  protocolVersion: string; name: string; description: string;
  url: string; version: string; capabilities: Record<string, boolean>;
  defaultInputModes: string[]; defaultOutputModes: string[]; skills: Skill[];
};

const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

/** Start an agent: publish a card, answer `message/send`. */
export function serve(opts: {
  name: string; description: string; port: number;
  skills: Skill[];
  handle: (text: string, skillId: string) => Promise<string> | string;
}) {
  const url = `http://localhost:${opts.port}`;
  const card: Card = {
    protocolVersion: "0.3.0",
    name: opts.name,
    description: opts.description,
    url,
    version: "1.0.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: opts.skills,
  };

  http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      const s = JSON.stringify(body, null, 2);
      res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
      res.end(s);
    };

    // 1. Discovery: anyone who can reach this host can read what we do.
    if (req.method === "GET" && req.url === "/.well-known/agent-card.json") return send(200, card);

    // 2. Work: one JSON-RPC method, `message/send`, returning a Task.
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw);
      const msg = rpc.params?.message;
      const text = (msg?.parts ?? []).filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n");
      const skillId = msg?.metadata?.skill ?? card.skills[0].id;

      console.log(`[${opts.name}] <- "${text}" (skill: ${skillId})`);
      const answer = await opts.handle(text, skillId);
      console.log(`[${opts.name}] -> "${answer}"`);

      return send(200, {
        jsonrpc: "2.0", id: rpc.id,
        result: {
          kind: "task", id: id("task"), contextId: msg?.contextId ?? id("ctx"),
          status: { state: "completed", timestamp: new Date().toISOString() },
          artifacts: [{ artifactId: id("art"), parts: [{ kind: "text", text: answer }] }],
        },
      });
    }
    send(404, { error: "not found" });
  }).listen(opts.port, () => {
    console.log(`[${opts.name}] listening on ${url}`);
    console.log(`[${opts.name}] card at ${url}/.well-known/agent-card.json`);
  });
}

/** Read another agent's card. This is discovery: no registry, no config. */
export async function discover(baseUrl: string): Promise<Card> {
  const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`no card at ${baseUrl} (HTTP ${res.status})`);
  return res.json() as Promise<Card>;
}

/** Call an agent described by a card, and return its answer text. */
export async function call(card: Card, text: string, skillId: string): Promise<string> {
  const res = await fetch(card.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: id("req"), method: "message/send",
      params: { message: { kind: "message", role: "user", messageId: id("msg"),
                           parts: [{ kind: "text", text }], metadata: { skill: skillId } } },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${card.name}: ${body.error.message}`);
  return (body.result.artifacts ?? [])
    .flatMap((a: any) => a.parts).filter((p: any) => p.kind === "text")
    .map((p: any) => p.text).join("\n");
}
