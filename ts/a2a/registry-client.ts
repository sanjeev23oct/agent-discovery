/**
 * Client side of the registry: how an agent announces itself and how it finds peers.
 */
import { A2AClient } from "./client.ts";
import type { AgentCard } from "./types.ts";

export const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:4000";

/**
 * Whether this swarm may delegate work to agents scanned off the public
 * internet.
 *
 * Off by default, and deliberately so. Once the registry holds hundreds of
 * strangers' agents, an unscoped capability lookup will happily route your
 * users' data to one of them -- which is exactly what happened here the first
 * time: a request for tech news was delegated to a stranger's paid agent.
 * Reaching outside your own swarm should be a decision, not an accident.
 *
 *   SWARM_ALLOW_PUBLIC=1   opt in
 */
export const ALLOW_PUBLIC = process.env.SWARM_ALLOW_PUBLIC === "1";

export type Discovered = {
  agent: AgentCard;
  matchedSkills: string[];
  cardUrl: string;
  online: boolean;
};

/**
 * Announce this agent to the registry. Retries, because in a swarm you cannot
 * assume the registry booted before you did.
 */
export async function register(cardUrl: string, attempts = 10): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${REGISTRY_URL}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardUrl }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return true;
    } catch {
      // registry not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn(`[registry-client] could not register ${cardUrl} after ${attempts} attempts`);
  return false;
}

/** Find agents by skill id, tag, or free-text query. */
export async function discover(query: { skill?: string; tag?: string; q?: string; source?: "local" | "public" }): Promise<Discovered[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const res = await fetch(`${REGISTRY_URL}/agents?${params}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`registry query failed: HTTP ${res.status}`);
  return (await res.json()).results as Discovered[];
}

/**
 * Discover one agent for a capability and return a ready-to-use client.
 * `exclude` lets a peer-to-peer hop avoid bouncing work back to itself.
 */
export async function findOne(
  query: { skill?: string; tag?: string; q?: string },
  exclude: string[] = [],
  /** Defaults to this swarm's own agents; see ALLOW_PUBLIC. */
  source: "local" | "public" | "all" = ALLOW_PUBLIC ? "all" : "local",
): Promise<{ client: A2AClient; skillId: string } | null> {
  const scoped = source === "all" ? query : { ...query, source };
  const results = (await discover(scoped)).filter((r) => !exclude.includes(r.agent.name));
  const hit = results[0];
  if (!hit) return null;
  return { client: new A2AClient(hit.agent), skillId: hit.matchedSkills[0] ?? query.skill ?? "" };
}
