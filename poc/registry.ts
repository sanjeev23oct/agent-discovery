/**
 * A tiny registry: the "who can do X" service the prod-support scenario
 * needs, and the two-agent alice/bob demo deliberately did not have.
 *
 * Specialists POST their card URL here on boot. The registry fetches the
 * card itself -- it never trusts a caller's description of its own
 * capabilities -- and indexes it by every tag on every skill. Anyone can
 * then ask "who offers logs.search-shaped work" without knowing an address.
 *
 * ~75 lines. The production version, with health checks, public-agent
 * scanning and a dashboard, is ../ts/registry/server.ts.
 */
import http from "node:http";
import { discover, trace } from "./mini.ts";
import type { Card, RegistryHit } from "./mini.ts";

const PORT = Number(process.env.REGISTRY_PORT ?? 5010);
const entries = new Map<string, { cardUrl: string; card: Card }>();

function tagIndex(): Record<string, string[]> {
  const idx: Record<string, string[]> = {};
  for (const { card } of entries.values()) {
    for (const skill of card.skills) {
      for (const tag of skill.tags) {
        idx[tag] = idx[tag] ?? [];
        if (!idx[tag].includes(card.name)) idx[tag].push(card.name);
      }
    }
  }
  return idx;
}

function findByTag(tag: string): RegistryHit[] {
  const hits: RegistryHit[] = [];
  for (const { card } of entries.values()) {
    const skill = card.skills.find((s) => s.tags.includes(tag));
    if (skill) hits.push({ card, matchedSkill: skill.id });
  }
  return hits;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (code: number, body: unknown) => {
    const s = JSON.stringify(body, null, 2);
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
    res.end(s);
  };

  // A specialist announces itself with its own base URL (the same URL its
  // card's `url` field points to). We fetch the card ourselves rather than
  // trusting whatever the registration claims -- the card, not the request,
  // is the source of truth for what an agent can do.
  if (req.method === "POST" && url.pathname === "/register") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { cardUrl: baseUrl } = JSON.parse(raw || "{}");
    try {
      const card = await discover(baseUrl, "registry");
      entries.set(card.name, { cardUrl: baseUrl, card });
      trace("registry", "registered", `indexed "${card.name}" under tags: ${[...new Set(card.skills.flatMap((s) => s.tags))].join(", ")}`);
      return send(200, { registered: card.name, skills: card.skills.map((s) => s.id) });
    } catch (err) {
      return send(502, { error: `could not fetch card from ${cardUrl}: ${err instanceof Error ? err.message : err}` });
    }
  }

  // GET /agents?tag=logs  -- the lookup every "discover the X agent" call makes.
  if (req.method === "GET" && url.pathname === "/agents") {
    const tag = url.searchParams.get("tag");
    if (tag) return send(200, { tag, results: findByTag(tag) });
    return send(200, { results: [...entries.values()].map(({ card }) => ({ card, matchedSkill: null })) });
  }

  // A flat view of the index, for the dashboard: tag -> which agents offer it.
  if (req.method === "GET" && url.pathname === "/index") {
    return send(200, { agents: entries.size, index: tagIndex() });
  }

  send(404, { error: "not found" });
}).listen(PORT, () => {
  console.log(`[registry] listening on http://localhost:${PORT}`);
  console.log(`[registry] register: POST /register {"cardUrl": "..."}`);
  console.log(`[registry] discover: GET /agents?tag=logs`);
});
