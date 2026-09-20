# 1. Agent swarms

## The idea

A swarm is many narrow agents cooperating, instead of one agent holding every tool.

The distinction is not size, it is **ownership of context and control**. In a single-agent system, one model sees everything and decides everything. In a swarm, each agent sees only its slice of the problem, and coordination is something that happens *between* agents rather than inside one.

```
Single agent                      Swarm
────────────                      ─────
  ┌─────────────┐                 ┌────────┐   ┌────────┐
  │   agent     │                 │research│──▶│summary │
  │ ┌─────────┐ │                 └────────┘   └───┬────┘
  │ │ 14 tools│ │                                  ▼
  │ └─────────┘ │                 ┌────────┐   ┌────────┐
  └─────────────┘                 │ notify │◀──│translate│
                                  └────────┘   └────────┘
```

## Why bother

**Context stays small.** The single biggest failure mode of a big agent is context dilution: 14 tool definitions, a long history, and a model that picks the wrong tool on turn 30. Each agent in a swarm carries only what its own job needs.

**Specialisation is cheap.** Different agents can use different models, different prompts, different temperatures — or no model at all. The `translator` here is 40 lines of regex. It does not need a frontier model, and in a swarm it does not have to share one.

**Teams can ship independently.** An agent is a service with a published contract. Whoever owns the translator can rewrite it, redeploy it, or swap its model without asking anyone, as long as its Agent Card still says it translates.

**Failure is partial.** Run `demo-handoff.sh`, kill the translator, run it again. You lose the translation. You still get the briefing. In a single agent, a broken tool tends to break the turn.

**Composition crosses organisational boundaries.** This is the one that actually motivated A2A. Your agent and a vendor's agent will never share a codebase, a language, or a deployment. A protocol is the only thing they can share.

## When a swarm is the wrong answer

Be honest about the costs, because they are real:

- **Latency compounds.** The handoff demo is four sequential HTTP calls. Each hop that involves an LLM adds seconds.
- **Debugging gets harder.** One trace becomes five logs. This is why every agent here stamps a shared `contextId` on its work — see [02-a2a-protocol.md](02-a2a-protocol.md#contexts-tie-a-conversation-together).
- **Information is lost at every boundary.** Each hop compresses. The summarizer throws away detail the translator might have wanted.
- **More moving parts fail more often.** You have just traded a function call for a network call, with everything that implies.

A useful rule: **reach for a swarm when the agents are owned by different people, run on different infrastructure, or need genuinely different models.** If one team owns all of it and it all runs in one process, you probably want one agent with good tools — which is what MCP is for.

## Swarm vs. workflow

Not every multi-agent system is a swarm. If the sequence is fixed and known at build time, you have a **pipeline**, and a pipeline is usually better written as ordinary code — it is easier to test and debug.

What makes this repo's swarm a swarm is that **membership and routing are resolved at runtime**. The orchestrator does not know the summarizer exists until it asks the registry. Add a sixth agent while the swarm is running and it becomes usable immediately, with no redeploy of anyone. That is the property worth paying the distributed-systems tax for; if you are not using it, do not pay it.

## How this repo demonstrates it

| Claim | Where to see it |
|---|---|
| Agents find each other at runtime | `demo-discovery.sh` |
| A coordinator can compose specialists | `demo-orchestrator.sh` |
| Coordination can be emergent, with no coordinator | `demo-handoff.sh` |
| Language does not matter | Python and TS agents in the same chain |
| Failure is partial, not total | kill the translator, re-run the handoff |

Next: [2. The A2A protocol](02-a2a-protocol.md)
