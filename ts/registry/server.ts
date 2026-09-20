/**
 * Agent registry: the "yellow pages" of the swarm.
 *
 * Agent Cards alone give you discovery only if you already know the host. A
 * registry closes the loop: agents register their card URL, the registry crawls
 * and indexes them, and any agent can then ask "who can translate to French?"
 * without knowing who exists in advance.
 *
 * This is NOT part of the A2A spec -- the spec names registries as a discovery
 * mechanism but does not standardise one. See docs/03-discovery.md.
 */
import http from "node:http";
import type { ServerResponse } from "node:http";
import { fetchAgentCard } from "../a2a/client.ts";
import type { AgentCard } from "../a2a/types.ts";

const PORT = Number(process.env.REGISTRY_PORT ?? 4000);
const HEALTH_INTERVAL_MS = 10_000;

type Entry = { cardUrl: string; card: AgentCard; lastSeen: string; online: boolean };

const agents = new Map<string, Entry>();
const log = (...args: unknown[]) => console.log("[registry]", ...args);

/** Re-fetch a card. This doubles as a liveness check -- a card you cannot fetch is an agent you cannot call. */
async function refresh(cardUrl: string): Promise<Entry> {
  try {
    const card = await fetchAgentCard(cardUrl);
    const entry: Entry = { cardUrl, card, lastSeen: new Date().toISOString(), online: true };
    agents.set(card.name, entry);
    return entry;
  } catch (err) {
    const existing = [...agents.values()].find((e) => e.cardUrl === cardUrl);
    if (existing) {
      existing.online = false;
      return existing;
    }
    throw err;
  }
}

setInterval(() => {
  for (const entry of agents.values()) {
    refresh(entry.cardUrl).catch(() => {});
  }
}, HEALTH_INTERVAL_MS).unref?.();

/**
 * Search across every registered card's skills.
 * Matching is intentionally simple: exact skill id, tag membership, or substring
 * over name/description. Swap in embeddings here for semantic capability search.
 */
function search(params: URLSearchParams) {
  const skill = params.get("skill")?.toLowerCase();
  const tag = params.get("tag")?.toLowerCase();
  const q = params.get("q")?.toLowerCase();
  const includeOffline = params.get("includeOffline") === "true";

  const results: Array<{ agent: AgentCard; matchedSkills: string[]; cardUrl: string; online: boolean }> = [];
  for (const entry of agents.values()) {
    if (!entry.online && !includeOffline) continue;
    const matched = entry.card.skills.filter((s) => {
      if (skill && s.id.toLowerCase() !== skill) return false;
      if (tag && !s.tags.some((t) => t.toLowerCase() === tag)) return false;
      if (q) {
        const haystack = `${s.id} ${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (matched.length === 0 && (skill || tag || q)) continue;
    results.push({
      agent: { ...entry.card, _registry: { cardUrl: entry.cardUrl, lastSeen: entry.lastSeen, online: entry.online } },
      matchedSkills: matched.map((s) => s.id),
      cardUrl: entry.cardUrl,
      online: entry.online,
    });
  }
  return results;
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    });
    return res.end();
  }

  // POST /register {"cardUrl": "http://host:port"} -- agents call this on boot.
  if (req.method === "POST" && url.pathname === "/register") {
    let body = "";
    req.on("data", (c) => (body += c));
    await new Promise((r) => req.on("end", r));
    let cardUrl: string;
    try {
      cardUrl = JSON.parse(body).cardUrl;
    } catch {
      return json(res, 400, { error: "body must be {\"cardUrl\": \"...\"}" });
    }
    try {
      const entry = await refresh(cardUrl);
      log(`registered ${entry.card.name} (${entry.card.skills.length} skills) from ${cardUrl}`);
      return json(res, 200, { registered: entry.card.name, skills: entry.card.skills.map((s) => s.id) });
    } catch (err) {
      log(`failed to register ${cardUrl}:`, err instanceof Error ? err.message : err);
      return json(res, 502, { error: `could not fetch agent card from ${cardUrl}` });
    }
  }

  // GET /agents?skill=&tag=&q= -- the discovery query agents actually use.
  if (req.method === "GET" && url.pathname === "/agents") {
    return json(res, 200, { count: agents.size, results: search(url.searchParams) });
  }

  if (req.method === "GET" && url.pathname.startsWith("/agents/")) {
    const entry = agents.get(decodeURIComponent(url.pathname.slice("/agents/".length)));
    return entry ? json(res, 200, entry) : json(res, 404, { error: "unknown agent" });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/agents/")) {
    const name = decodeURIComponent(url.pathname.slice("/agents/".length));
    return json(res, 200, { removed: agents.delete(name) });
  }

  // A flat index of every skill in the swarm -- handy for "what can this swarm do?"
  if (req.method === "GET" && url.pathname === "/skills") {
    const skills = [...agents.values()].flatMap((e) =>
      e.card.skills.map((s) => ({ agent: e.card.name, url: e.card.url, online: e.online, id: s.id, tags: s.tags, description: s.description })),
    );
    return json(res, 200, { skills });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, {
      service: "a2a-agent-registry",
      endpoints: {
        "POST /register": 'body {"cardUrl": "http://host:port"}',
        "GET /agents": "?skill= | ?tag= | ?q= | ?includeOffline=true",
        "GET /agents/:name": "one entry",
        "GET /skills": "flat skill index across the swarm",
        "DELETE /agents/:name": "deregister",
      },
      registered: [...agents.keys()],
    });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT}`);
  log("agents register with POST /register, discover with GET /agents?tag=...");
});
