/**
 * A2A in ~150 lines: enough to serve an Agent Card, answer JSON-RPC calls,
 * find a peer through a registry, and call it. Shared by every agent in
 * poc/, including poc/registry.ts itself.
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

/**
 * Optional tracing. When TRACE_URL is set, each agent reports what it is doing
 * so poc/ui.ts can draw it. Fire-and-forget: tracing must never change or
 * delay the protocol, so failures are swallowed.
 */
const TRACE_URL = process.env.TRACE_URL;

/**
 * A single trace() call must never block the caller -- that would mean the
 * demo's *observability* changes the protocol's own timing, which defeats
 * the point of tracing in the first place.
 *
 * But two trace() calls made back-to-back (e.g. "matched" then "calling",
 * fired synchronously one after another before either's network request
 * lands) are not guaranteed to arrive at the UI server in the order they
 * were made -- two unawaited fetch()s can race. The fix is not to await
 * each call at the call site (that reintroduces the latency problem); it is
 * to chain the underlying sends onto one promise per process, so the sends
 * themselves go out strictly in program order while trace() itself still
 * returns immediately.
 */
let sendQueue: Promise<unknown> = Promise.resolve();
export function trace(actor: string, kind: string, detail: string, extra: Record<string, unknown> = {}) {
  if (!TRACE_URL) return;
  const body = JSON.stringify({ actor, kind, detail, at: Date.now(), ...extra });
  sendQueue = sendQueue.then(() =>
    fetch(TRACE_URL, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => {}),
  );
}

/** Start an agent: publish a card, answer `message/send`. Returns the card and a `ready` promise. */
export function serve(opts: {
  name: string; description: string; port: number;
  skills: Skill[];
  handle: (text: string, skillId: string) => Promise<string> | string;
}): { card: Card; ready: Promise<void> } {
  const url = `http://localhost:${opts.port}`;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
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
    if (req.method === "GET" && req.url === "/.well-known/agent-card.json") {
      // The UI's own side-panel polls this every few seconds to keep the
      // cards fresh. That is real traffic, but it is not a protocol event
      // worth showing in a "who called whom" timeline, so it identifies
      // itself and we skip tracing just that one source.
      if (req.headers["x-poc-ui-poll"] !== "1") {
        trace(opts.name, "card-served", `served my Agent Card (${card.skills.length} skill(s))`);
      }
      return send(200, card);
    }

    // 2. Work: one JSON-RPC method, `message/send`, returning a Task.
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw);
      const msg = rpc.params?.message;
      const text = (msg?.parts ?? []).filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n");
      const skillId = msg?.metadata?.skill ?? card.skills[0].id;

      console.log(`[${opts.name}] <- "${text}" (skill: ${skillId})`);
      trace(opts.name, "received", `got "${text}" for skill ${skillId}`, { skillId });
      const answer = await opts.handle(text, skillId);
      console.log(`[${opts.name}] -> "${answer}"`);
      trace(opts.name, "answered", answer);

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
    resolveReady();
  });
  return { card, ready };
}

/** Read another agent's card. This is discovery: no registry, no config. */
export async function discover(baseUrl: string, who = "?"): Promise<Card> {
  trace(who, "discovering", `fetching ${baseUrl}/.well-known/agent-card.json`);
  const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`no card at ${baseUrl} (HTTP ${res.status})`);
  const card = (await res.json()) as Card;
  trace(who, "discovered", `read ${card.name}'s card: ${card.skills.map((s) => s.id).join(", ")}`, { card });
  return card;
}

/** Call an agent described by a card, and return its answer text. */
export async function call(card: Card, text: string, skillId: string, who = "?"): Promise<string> {
  trace(who, "calling", `POST ${card.url} -> message/send (skill: ${skillId})`, { to: card.name, skillId });
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

/**
 * ------------------------------------------------------------------------
 * Registry client -- the piece the two-agent alice/bob demo deliberately
 * left out. With two agents, hardcoding a peer's URL is fine. The moment
 * you have several specialists, the useful question stops being "where is
 * Bob" and becomes "who can do X" -- and answering *that* is what a
 * registry is for. See poc/registry.ts for the ~70-line server this talks to.
 * ------------------------------------------------------------------------
 */

export type RegistryHit = { card: Card; matchedSkill: string };

/**
 * Tell the registry we exist. Called once, on boot, by every specialist.
 * `baseUrl` is the agent's own base URL (the same one its card's `url`
 * field carries) -- the registry fetches the card itself from there.
 */
export async function registerWithRegistry(registryUrl: string, baseUrl: string, who: string): Promise<void> {
  trace(who, "registering", `POST ${registryUrl}/register  { cardUrl: "${baseUrl}" }`);
  try {
    await fetch(`${registryUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardUrl: baseUrl }),
    });
  } catch (err) {
    console.error(`[${who}] could not reach the registry at ${registryUrl}:`, err);
  }
}

/**
 * Ask the registry who offers a capability, by tag. This is the call that
 * answers "discover the Splunk agent" -- the caller names a capability
 * ("logs"), never an address, and the registry is the only thing that knows
 * where every specialist actually lives.
 */
export async function findByTag(registryUrl: string, tag: string, who: string): Promise<RegistryHit | null> {
  trace(who, "querying-registry", `GET ${registryUrl}/agents?tag=${tag}`, { tag });
  const res = await fetch(`${registryUrl}/agents?tag=${encodeURIComponent(tag)}`);
  const body = (await res.json()) as { results: RegistryHit[] };
  const hits = body.results ?? [];
  if (hits.length === 0) {
    trace(who, "no-agent-found", `the registry has no agent tagged "${tag}"`, { tag });
    return null;
  }
  const hit = hits[0];
  trace(who, "registry-hit", `registry says "${hit.card.name}" offers "${tag}" (skill: ${hit.matchedSkill})`, {
    tag, agent: hit.card.name, skillId: hit.matchedSkill,
  });
  return hit;
}
