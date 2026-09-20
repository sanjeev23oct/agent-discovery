/**
 * Public agent scanner.
 *
 * Fetches Agent Cards from public A2A agents on the internet and loads the
 * valid ones into the local registry, so the dashboard shows the real
 * ecosystem next to your own swarm.
 *
 * Scanning etiquette, because these are other people's servers:
 *   - candidates come from a public directory or a file you supply, never from
 *     enumerating hosts or guessing domains;
 *   - one GET per agent, to a path (`/.well-known/...`) whose entire purpose is
 *     to be publicly fetched;
 *   - bounded concurrency, a short timeout, and no retries.
 *
 * Usage:
 *   node ts/registry/scan.ts                     # fetch candidates from the public directory
 *   node ts/registry/scan.ts seeds.txt           # one card URL per line
 *   node ts/registry/scan.ts --limit 50          # stop after 50 candidates
 */
import fs from "node:fs/promises";
import { REGISTRY_URL } from "../a2a/registry-client.ts";
import type { AgentCard } from "../a2a/types.ts";

const DIRECTORY_URL = process.env.DIRECTORY_URL ?? "https://a2aregistry.org/";
/** Paginated JSON index. Preferred over scraping the directory's HTML. */
const DIRECTORY_API = process.env.DIRECTORY_API ?? "https://a2aregistry.org/api/agents";
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 12);
const TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS ?? 6000);

const args = process.argv.slice(2);
const limitFlag = args.indexOf("--limit");
const LIMIT = limitFlag >= 0 ? Number(args[limitFlag + 1]) : Infinity;
const seedFile = args.find((a) => !a.startsWith("--") && a !== String(LIMIT));

const log = (...a: unknown[]) => console.log("[scan]", ...a);

/**
 * Candidate card URLs from a public directory.
 *
 * Prefer the directory's JSON API: it paginates, and it carries health and
 * conformance metadata the HTML does not. Fall back to scraping the page only
 * if the API is unavailable, since a directory's markup can change any day.
 */
async function candidatesFromApi(): Promise<string[] | null> {
  try {
    const urls: string[] = [];
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const res = await fetch(`${DIRECTORY_API}?limit=100&offset=${offset}`, {
        signal: AbortSignal.timeout(20000),
        headers: { accept: "application/json", "user-agent": "agent-discovery-scanner/1.0" },
      });
      if (!res.ok) return null;
      const body: any = await res.json();
      const agents: any[] = body.agents ?? body.results ?? [];
      if (agents.length === 0) break;
      for (const a of agents) {
        // wellKnownURI is the card; `url` is the RPC endpoint. Prefer the card.
        const card = a.wellKnownURI ?? a.cardUrl ?? (a.url ? new URL("/.well-known/agent-card.json", a.url).toString() : null);
        if (card) urls.push(card);
      }
      offset += agents.length;
      if (body.total && urls.length >= body.total) break;
    }
    log(`directory API returned ${urls.length} candidate(s)`);
    return [...new Set(urls)];
  } catch (err) {
    log(`directory API unavailable (${err instanceof Error ? err.message : err}) -- falling back to HTML`);
    return null;
  }
}

/** Last resort: pull card URLs out of the directory's rendered page. */
async function candidatesFromHtml(): Promise<string[]> {
  log(`scraping candidate list from ${DIRECTORY_URL}`);
  const res = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30000) });
  const html = await res.text();
  const found = html.match(/https?:\/\/[^"&\\\s]+\/\.well-known\/agent(-card)?\.json/g) ?? [];
  return [...new Set(found)];
}

async function candidates(): Promise<string[]> {
  if (seedFile) {
    log(`reading candidates from ${seedFile}`);
    const text = await fs.readFile(seedFile, "utf8");
    return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  }
  return (await candidatesFromApi()) ?? candidatesFromHtml();
}

type Probe =
  | { ok: true; cardUrl: string; card: AgentCard; ms: number }
  | { ok: false; cardUrl: string; reason: string; ms: number };

/** One GET, strictly bounded. Anything unexpected is a failed probe, not a crash. */
async function probe(cardUrl: string): Promise<Probe> {
  const started = Date.now();
  try {
    const res = await fetch(cardUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "agent-discovery-scanner/1.0" },
      redirect: "follow",
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, cardUrl, reason: `HTTP ${res.status}`, ms };

    const card = (await res.json()) as AgentCard;
    // A card is only useful if it says who it is and where to call it.
    if (!card?.name || !card?.url) return { ok: false, cardUrl, reason: "not an agent card", ms };
    return { ok: true, cardUrl, card, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const reason = /timed? ?out|abort/i.test(msg) ? "timeout"
      : /json/i.test(msg) ? "invalid JSON"
      : /certificate|TLS|SSL/i.test(msg) ? "TLS error"
      : /ENOTFOUND|getaddrinfo/i.test(msg) ? "DNS failure"
      : /ECONNREFUSED/i.test(msg) ? "connection refused"
      : msg.slice(0, 60);
    return { ok: false, cardUrl, reason, ms };
  }
}

/** Fixed-size worker pool: never more than CONCURRENCY requests in flight. */
async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

const all = (await candidates()).slice(0, LIMIT);
log(`${all.length} candidate(s), concurrency ${CONCURRENCY}, timeout ${TIMEOUT_MS}ms`);

const started = Date.now();
let done = 0;
const results = await pool(all, CONCURRENCY, async (url) => {
  const r = await probe(url);
  done++;
  if (done % 25 === 0 || done === all.length) log(`  probed ${done}/${all.length}`);
  return r;
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const live = results.filter((r): r is Extract<Probe, { ok: true }> => r.ok);
const dead = results.filter((r): r is Extract<Probe, { ok: false }> => !r.ok);

// Load the live ones into the local registry, tagged as public so the
// dashboard and the health checker can treat them differently from our swarm.
let loaded = 0;
for (const hit of live) {
  try {
    const res = await fetch(`${REGISTRY_URL}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardUrl: hit.cardUrl, source: "public", card: hit.card }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) loaded++;
  } catch {
    // registry down -- the scan report below is still useful
  }
}

const skills = live.flatMap((h) => h.card.skills ?? []);
const tags = new Map<string, number>();
for (const s of skills) for (const t of s.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);

const reasons = new Map<string, number>();
for (const d of dead) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);

console.log(`
═══ scan complete in ${elapsed}s ═══
  candidates : ${all.length}
  reachable  : ${live.length}  (${((live.length / all.length) * 100).toFixed(0)}%)
  unreachable: ${dead.length}
  loaded into registry: ${loaded}
  skills advertised   : ${skills.length}
`);

console.log("why the rest failed:");
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}

console.log("\nmost common capability tags in the wild:");
for (const [tag, n] of [...tags].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(4)}  ${tag}`);
}

console.log(`\nopen the dashboard: ${REGISTRY_URL}/ui`);
