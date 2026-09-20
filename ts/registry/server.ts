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
import { DASHBOARD_HTML } from "./dashboard.ts";
import type { AgentCard } from "../a2a/types.ts";

const PORT = Number(process.env.REGISTRY_PORT ?? 4000);
const HEALTH_INTERVAL_MS = 10_000;

/**
 * `source` separates our own swarm from agents scanned off the public internet.
 * It drives both the dashboard and the health checker: we re-poll our own
 * agents every few seconds, but re-polling hundreds of other people's servers
 * on a timer would be rude, so public entries are only checked when scanned.
 */
type Source = "local" | "public";
type Entry = { cardUrl: string; card: AgentCard; lastSeen: string; online: boolean; source: Source };

const agents = new Map<string, Entry>();
const log = (...args: unknown[]) => console.log("[registry]", ...args);

/** Re-fetch a card. This doubles as a liveness check -- a card you cannot fetch is an agent you cannot call. */
/**
 * Coerce a card fetched from a stranger into a shape the rest of this service
 * can rely on.
 *
 * The spec marks `skills`, `tags` and `description` as required. Real public
 * agents omit them anyway -- roughly 1 in 60 of the agents scanned off the
 * public internet has no `skills` array at all. Trusting "required" on data
 * from other people's servers took this registry down with a TypeError, so
 * every card is normalised here, once, on the way in.
 */
function normaliseCard(raw: any, cardUrl: string): AgentCard {
  const skills = Array.isArray(raw?.skills) ? raw.skills : [];
  return {
    ...raw,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : new URL(cardUrl).host,
    description: typeof raw?.description === "string" ? raw.description : "",
    url: typeof raw?.url === "string" && raw.url ? raw.url : new URL(cardUrl).origin,
    protocolVersion: typeof raw?.protocolVersion === "string" ? raw.protocolVersion : "unknown",
    capabilities: typeof raw?.capabilities === "object" && raw.capabilities ? raw.capabilities : {},
    skills: skills.map((s: any, i: number) => ({
      ...s,
      id: typeof s?.id === "string" && s.id ? s.id : `skill-${i}`,
      name: typeof s?.name === "string" ? s.name : "",
      description: typeof s?.description === "string" ? s.description : "",
      tags: Array.isArray(s?.tags) ? s.tags.filter((t: unknown) => typeof t === "string") : [],
    })),
  } as AgentCard;
}

async function refresh(cardUrl: string, source: Source = "local", prefetched?: AgentCard): Promise<Entry> {
  try {
    const card = normaliseCard(prefetched ?? (await fetchAgentCard(cardUrl)), cardUrl);
    const entry: Entry = { cardUrl, card, lastSeen: new Date().toISOString(), online: true, source };
    // Public agents collide on common names ("Agent", "assistant"), so key
    // public entries by their URL and keep local names clean.
    agents.set(source === "public" ? `${card.name} @ ${new URL(cardUrl).host}` : card.name, entry);
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
    if (entry.source !== "local") continue; // don't poll other people's servers on a timer
    refresh(entry.cardUrl, "local").catch(() => {});
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

  const source = params.get("source");
  const results: Array<{ agent: AgentCard; matchedSkills: string[]; cardUrl: string; online: boolean; source: Source; name: string }> = [];
  for (const [name, entry] of agents.entries()) {
    if (!entry.online && !includeOffline) continue;
    if (source && entry.source !== source) continue;
    const matched = (entry.card.skills ?? []).filter((s) => {
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
      source: entry.source,
      name,
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
  try {
    await handle(req, res);
  } catch (err) {
    // One bad card or one bad query must never take the registry down with it.
    log("request failed:", err instanceof Error ? err.stack : err);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
    else res.end();
  }
});

async function handle(req: http.IncomingMessage, res: ServerResponse) {
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
    let source: Source = "local";
    let prefetched: AgentCard | undefined;
    try {
      const parsed = JSON.parse(body);
      cardUrl = parsed.cardUrl;
      if (parsed.source === "public") source = "public";
      prefetched = parsed.card; // scanners already fetched it; don't make them pay twice
    } catch {
      return json(res, 400, { error: "body must be {\"cardUrl\": \"...\"}" });
    }
    try {
      const entry = await refresh(cardUrl, source, prefetched);
      if (source === "local") log(`registered ${entry.card.name} (${entry.card.skills.length} skills) from ${cardUrl}`);
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
      (e.card.skills ?? []).map((s) => ({ agent: e.card.name, url: e.card.url, online: e.online, id: s.id, tags: s.tags, description: s.description })),
    );
    return json(res, 200, { skills });
  }

  if (req.method === "GET" && url.pathname === "/ui") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(DASHBOARD_HTML);
  }

  if (req.method === "GET" && url.pathname === "/stats") {
    const entries = [...agents.values()];
    const tags = new Map<string, number>();
    for (const e of entries) for (const s of e.card.skills ?? []) for (const t of s.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
    return json(res, 200, {
      total: entries.length,
      local: entries.filter((e) => e.source === "local").length,
      public: entries.filter((e) => e.source === "public").length,
      online: entries.filter((e) => e.online).length,
      skills: entries.reduce((n, e) => n + (e.card.skills?.length ?? 0), 0),
      topTags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count })),
    });
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
      dashboard: `http://localhost:${PORT}/ui`,
      registered: [...agents.keys()],
    });
  }

  json(res, 404, { error: "not found" });
}

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT}`);
  log("agents register with POST /register, discover with GET /agents?tag=...");
});
