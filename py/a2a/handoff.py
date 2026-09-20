"""Peer-to-peer handoff, Python side.

Identical semantics to ts/a2a/handoff.ts: the message carries the remaining
`route`, each agent pops the head, discovers a peer for it, and forwards. A
Python agent can hand off to a TypeScript agent and vice versa -- neither knows
nor cares what the other is written in.
"""
from .client import task_output
from .registry_client import find_one


def read_handoff(message):
    meta = message.get("metadata") or {}
    route = meta.get("route")
    hops = meta.get("hops")
    return {
        "route": route if isinstance(route, list) else [],
        "hops": hops if isinstance(hops, list) else [],
    }


def forward(message, self_name, output, context_id, log):
    """Forward work to whoever offers the next capability on the route.

    If a capability has no available provider, we skip it and try the one after
    it rather than abandoning the rest of the route. That is what makes the
    swarm degrade instead of break: losing the translator should cost you a
    translation, not the briefing that was supposed to follow it.

    Returns None when nothing downstream could be reached, in which case the
    caller keeps its own output.
    """
    state = read_handoff(message)
    route = state["route"]
    trail = state["hops"] + [self_name]

    for i, nxt in enumerate(route):
        rest = route[i + 1:]

        # Discovery itself can fail (registry down). A swarm where one
        # unreachable service kills every chain is worse than no swarm.
        try:
            client, skill_id = find_one(tag=nxt, exclude=trail)
        except Exception as err:
            log('registry lookup for "{}" failed ({}) -- keeping local result'.format(nxt, err))
            return None

        if client is None:
            log('no peer advertises "{}" -- skipping it'.format(nxt))
            continue

        log('handing off to {} for "{}" ({} step(s) left)'.format(client.card["name"], nxt, len(rest)))
        try:
            task = client.send(
                output,
                skill=skill_id,
                context_id=context_id,  # same conversation, different agent
                metadata={"route": rest, "hops": trail},
            )
        except Exception as err:
            # The registry can be up to one health-check interval out of date,
            # so a peer it lists as online may already be gone. Expect this.
            log('handoff to {} failed ({}) -- trying the next capability'.format(client.card["name"], err))
            continue

        if (task.get("status") or {}).get("state") != "completed":
            log('{} returned "{}" -- trying the next capability'.format(
                client.card["name"], (task.get("status") or {}).get("state")))
            continue
        return task_output(task)

    return None
