/**
 * News agent (TypeScript) -- a specialist that does real work.
 *
 * Every other agent in this demo is deliberately fake so the swarm stays
 * deterministic and offline. This one is not: it fetches live headlines from
 * public RSS feeds. It exists because of what scanning the public ecosystem
 * showed -- eleven public "news" agents were discoverable and none of them
 * returned a headline for free (see docs/06-does-this-pay-off.md).
 *
 * It is ~60 lines and needs no API key, which is rather the point.
 */
import { createAgent } from "../a2a/server.ts";
import { register } from "../a2a/registry-client.ts";
import { forward } from "../a2a/handoff.ts";
import { textPart } from "../a2a/types.ts";

const PORT = Number(process.env.PORT ?? 4104);
const BASE_URL = process.env.BASE_URL;

const FEEDS: Record<string, string> = {
  tech: "https://hnrss.org/frontpage",
  world: "https://feeds.bbci.co.uk/news/world/rss.xml",
  business: "https://feeds.bbci.co.uk/news/business/rss.xml",
  science: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
};

/** Minimal RSS extraction. A real deployment would use a parser; this keeps the repo dependency-free. */
function parseItems(xml: string, limit: number) {
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map((m) => m[0]);
  return items.slice(0, limit).map((item) => {
    const pick = (tag: string) => {
      const m = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return (m?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    };
    return { title: pick("title"), link: pick("link"), date: pick("pubDate") };
  }).filter((i) => i.title);
}

/** Pick a feed from the request text; default to tech. */
function chooseFeed(text: string) {
  const lower = text.toLowerCase();
  return Object.keys(FEEDS).find((k) => lower.includes(k)) ?? "tech";
}

const agent = createAgent({
  name: "news",
  description: "Fetches current headlines from public news feeds (tech, world, business, science).",
  port: PORT,
  baseUrl: BASE_URL,
  skills: [
    {
      id: "news.headlines",
      name: "Get headlines",
      description: "Fetch the latest real headlines on a topic from public RSS feeds.",
      tags: ["news", "headlines", "current-events", "feed"],
      examples: ["What is today's tech news?", "Latest world headlines"],
      handler: async (ctx) => {
        const topic = chooseFeed(ctx.text);
        ctx.progress(`fetching ${topic} headlines`);

        const res = await fetch(FEEDS[topic], {
          signal: AbortSignal.timeout(10000),
          headers: { "user-agent": "agent-discovery/1.0" },
        });
        if (!res.ok) throw new Error(`feed returned HTTP ${res.status}`);

        const items = parseItems(await res.text(), 6);
        ctx.log(`got ${items.length} ${topic} headlines`);

        const output = [
          `Top ${topic} headlines (${new Date().toISOString().slice(0, 10)}):`,
          ...items.map((i) => `- ${i.title}`),
        ].join("\n");

        const downstream = await forward({
          message: ctx.message,
          selfName: "news",
          output,
          contextId: ctx.task.contextId,
          log: ctx.log,
        });

        return {
          parts: [textPart(downstream ?? output)],
          artifactName: "headlines",
          metadata: { topic, count: items.length, source: FEEDS[topic] },
        };
      },
    },
  ],
});

await agent.listen();
await register(agent.card.url);
