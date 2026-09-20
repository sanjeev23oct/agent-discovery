/**
 * Peer-to-peer handoff.
 *
 * There is no coordinator here. A message carries a `route`: the list of
 * capabilities still to be applied. Each agent does its own step, asks the
 * registry who can do the next one, and forwards. The swarm's shape is decided
 * hop by hop, at runtime, by whoever is holding the work.
 *
 * `hops` accumulates the trail so you can see the path the work actually took.
 */
import { findOne } from "./registry-client.ts";
import { taskOutput } from "./client.ts";
import type { Message } from "./types.ts";

export type HandoffState = {
  /** Capability tags still to be applied, in order. */
  route: string[];
  /** Agents that have already touched this work. */
  hops: string[];
};

export function readHandoff(message: Message): HandoffState {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  return {
    route: Array.isArray(meta.route) ? (meta.route as string[]) : [],
    hops: Array.isArray(meta.hops) ? (meta.hops as string[]) : [],
  };
}

/**
 * Forward work to whoever offers the next capability on the route.
 *
 * If a capability has no available provider, we skip it and try the one after
 * it rather than abandoning the rest of the route. That is what makes the swarm
 * degrade instead of break: losing the translator should cost you a
 * translation, not the briefing that was supposed to follow it.
 *
 * Returns null when nothing downstream could be reached, in which case the
 * caller keeps its own output.
 */
export async function forward(opts: {
  message: Message;
  selfName: string;
  /** What this agent produced, which becomes the next agent's input. */
  output: string;
  contextId: string;
  log: (...args: unknown[]) => void;
}): Promise<string | null> {
  const { route, hops } = readHandoff(opts.message);
  const trail = [...hops, opts.selfName];

  for (let i = 0; i < route.length; i++) {
    const next = route[i];
    const rest = route.slice(i + 1);

    // Discovery itself can fail (registry down). A swarm where one unreachable
    // service kills every chain is worse than no swarm, so we degrade.
    let peer: Awaited<ReturnType<typeof findOne>> = null;
    try {
      peer = await findOne({ tag: next }, trail);
    } catch (err) {
      opts.log(`registry lookup for "${next}" failed (${errText(err)}) -- keeping local result`);
      return null;
    }

    if (!peer) {
      opts.log(`no peer advertises "${next}" -- skipping it`);
      continue;
    }

    opts.log(`handing off to ${peer.client.card.name} for "${next}" (${rest.length} step(s) left)`);
    try {
      const task = await peer.client.send(opts.output, {
        contextId: opts.contextId, // same conversation, different agent
        skill: peer.skillId,
        metadata: { route: rest, hops: trail },
      });
      // message/send may legitimately answer with a bare Message instead of a
      // Task -- several public agents do. Only a Task carries a state to check.
      const state = (task as any)?.status?.state;
      if (state && state !== "completed") {
        opts.log(`${peer.client.card.name} returned "${state}" -- trying the next capability`);
        continue;
      }
      const output = taskOutput(task);
      if (!output) {
        opts.log(`${peer.client.card.name} returned no readable output -- trying the next capability`);
        continue;
      }
      return output;
    } catch (err) {
      // The registry can be up to one health-check interval out of date, so a
      // peer it lists as online may already be gone. Expect this, don't crash.
      opts.log(`handoff to ${peer.client.card.name} failed (${errText(err)}) -- trying the next capability`);
      continue;
    }
  }

  return null;
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
