# agent-discovery

A runnable demonstration of three ideas that are usually explained separately:

1. **Agent swarms** — many narrow agents cooperating instead of one agent with many tools.
2. **A2A** — the Agent2Agent protocol, so agents can talk to agents across process, host, vendor and language boundaries.
3. **Discovery** — how your agent finds others, and how others find yours.

Five agents, in **two languages**, coordinating over the wire. Nothing is hardcoded about who exists: agents publish a card, a registry indexes it, and peers are resolved at runtime.

**Zero dependencies.** No `npm install`, no `pip install`, no API keys, no network access. Node ≥ 22.6 (for native TypeScript) and Python 3 are all you need.

## Start here: two agents talking

If you want the idea in one sitting, skip the swarm and read [poc/](poc/) — two agents, two ports, ~170 lines total, no dependencies:

```bash
./poc/run.sh
```

```
[alice] I can't do maths. Looking for a peer at http://localhost:5002...
[alice] found "bob" -- Evaluates arithmetic expressions.
[alice] its skills: math.evaluate [math, calculate, arithmetic]
[alice] "math.evaluate" is tagged "math" -- delegating
answer: I asked bob (math.evaluate) and it said: 12 * 34 + 7 = 415
```

Alice is told one thing about Bob: a URL. His name, description and skills she reads from his card at runtime, and she matches on the **tag** `math`, never on his skill's name. Swap in `carol.ts`, whose skill is called `arithmetic.compute` instead, and Alice works with her unchanged. See [poc/README.md](poc/README.md).

## Quick start

```bash
./scripts/swarm-up.sh        # registry + 5 agents
./scripts/demo-discovery.sh  # how agents find each other
./scripts/demo-orchestrator.sh
./scripts/demo-handoff.sh
./scripts/swarm-down.sh
```

Watch the agents think while a demo runs:

```bash
tail -f .swarm/logs/*.log
```

## The swarm

| Agent | Lang | Port | Skill | Tags (what it is discovered by) |
|---|---|---|---|---|
| `registry` | TS | 4000 | — | the yellow pages, not an agent |
| `researcher` | TS | 4101 | `research.gather` | research, gather, facts |
| `orchestrator` | TS | 4102 | `swarm.solve` | orchestrate, solve, plan, delegate |
| `notifier` | TS | 4103 | `notify.publish` | notify, publish, deliver |
| `summarizer` | **Py** | 4201 | `text.summarize` | summarize, condense, shorten |
| `translator` | **Py** | 4202 | `text.translate` | translate, french, language |
| `news` | TS | 4104 | `news.headlines` | news, headlines, current-events |

The TypeScript and Python agents share no library, no types and no codegen. They interoperate because they agree on the JSON on the wire — which is the entire argument for having a protocol.

## The two swarm patterns

**Orchestrator + specialists** (`demo-orchestrator.sh`) — one agent holds the plan, discovers specialists by capability, delegates, and merges. Legible and debuggable; the orchestrator is a bottleneck and a single point of failure.

```
request → orchestrator ─┬→ researcher (TS)
                        ├→ summarizer (Py)
                        ├→ translator (Py)
                        └→ notifier   (TS)     one contextId throughout
```

**Peer-to-peer handoff** (`demo-handoff.sh`) — no coordinator. The message carries a `route` of *capabilities, not addresses*. Each agent finishes its step, asks the registry who does the next one, and forwards.

```
researcher → summarizer → translator → notifier
   (TS)         (Py)          (Py)        (TS)
```

Each hop is resolved at the moment it is needed, so the swarm adapts to what is actually running. Kill the translator, wait ~10s for the registry health check, and re-run: the chain skips the missing capability and still delivers a briefing.

```
researcher → summarizer → notifier
```

That is the practical difference between the two patterns. Losing a specialist costs you that specialist's contribution, not the whole job.

## Exposing your agent, and finding others

Discovery works at two levels, covered in [docs/03-discovery.md](docs/03-discovery.md):

- **Agent Card** — every agent serves its own capability document at `/.well-known/agent-card.json`. If someone knows your host, they need nothing else. Try it: `curl localhost:4101/.well-known/agent-card.json`.
- **Registry** — agents `POST /register` their card URL; anyone can then ask `GET /agents?tag=translate`. This is what lets you find agents you did not already know about.

To make your agent discoverable beyond your laptop, see [docs/05-going-public.md](docs/05-going-public.md).

## Scan the real ecosystem

The registry can index public A2A agents from the internet next to your own, and ships a dashboard:

```bash
./scripts/swarm-up.sh
node ts/registry/scan.ts     # ~25s
open http://localhost:4000/ui
```

A real run indexed **318 reachable public agents advertising 2,290 skills**, alongside your 5 local ones. The dashboard filters by local/public, searches name, description, skill and tag, and shows the most common capability tags in the wild (`x402`, `trust`, `verification`, `mcp`, `a2a`…).

Scanning is polite by construction: candidates come from a published directory, one GET each, concurrency 12, 6s timeout, no retries, and public entries are never health-polled on a timer.

> **Discovered cards are untrusted input.** 3% of live public cards contain instruction-shaped text aimed at a calling model, one of them 25,284 characters long. Render them escaped; never concatenate them into a prompt. [docs/03](docs/03-discovery.md#what-real-cards-actually-look-like)

## Where to find public agents

Verified live: [a2a-protocol.org](https://a2a-protocol.org) (official spec, Linux Foundation), [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A) (official repo/SDKs), [a2aregistry.org](https://a2aregistry.org) (**416 agents, JSON API at `/api/agents`**), [a2a-registry.org](https://www.a2a-registry.org), [agenstry.com](https://agenstry.com), [a2aagentlist.com](https://a2aagentlist.com), and [agentcard.net](https://www.agentcard.net/well-known-agent-json) to validate your own card. Details and caveats in [docs/03](docs/03-discovery.md#where-to-find-public-agents).

## Call a real public agent

```bash
node ts/demos/call-public.ts
```

Four of five live public agents answer. Better: because scanned agents share the registry with yours, a local agent hands work to a stranger's agent by capability, with no address in the code:

```
researcher (TS, localhost) → summarizer (Python, localhost) → Sidequest Commons Guide (public internet)
```

Getting there took four client fixes, each found by a live failure — bare `Message` responses instead of `Task`, `data` parts instead of text, a CDN 403 on Python's default User-Agent, and a pre-0.3 agent using `type` instead of `kind`. [docs/03](docs/03-discovery.md#four-bugs-real-agents-found-in-this-client)

## Docs

| | |
|---|---|
| [01-agent-swarms.md](docs/01-agent-swarms.md) | What a swarm is, when it beats one big agent, and when it does not |
| [02-a2a-protocol.md](docs/02-a2a-protocol.md) | The wire format, annotated — cards, tasks, messages, JSON-RPC |
| [03-discovery.md](docs/03-discovery.md) | Well-known URIs, registries, and capability matching |
| [04-swarm-patterns.md](docs/04-swarm-patterns.md) | Orchestrator vs. handoff vs. fan-out vs. blackboard |
| [05-going-public.md](docs/05-going-public.md) | Exposing your agent safely to the outside world |
| [06-does-this-pay-off.md](docs/06-does-this-pay-off.md) | **Honest assessment** — what 318 live public agents actually sell, and when a swarm is the wrong answer |

## Reading the code

Start with [ts/a2a/types.ts](ts/a2a/types.ts) — the whole protocol surface in one file, with the spec's field names. Then:

```
ts/a2a/server.ts        serve a card, dispatch JSON-RPC, run tasks
ts/a2a/client.ts        fetch a card, call another agent
ts/a2a/handoff.ts       decentralised next-hop routing
ts/registry/server.ts   the registry (~180 lines)
py/a2a/                 the same thing in Python, stdlib only
```

Each implementation is deliberately small enough to read in one sitting. For production, use the official SDKs (`@a2a-js/sdk`, `a2a-sdk` for Python) — see [docs/02-a2a-protocol.md](docs/02-a2a-protocol.md#using-the-official-sdks).

## A note on protocol versions

A2A v0.3.x and v1.0 disagree on two things this code has to care about:

| | v0.3.x | v1.0 |
|---|---|---|
| Card path | `/.well-known/agent-card.json` | `/.well-known/a2a-agent-card` |
| Send a message | `"message/send"` | `"SendMessage"` |

These agents **serve both paths and accept both method spellings**, so they interoperate either way. The cards advertise `protocolVersion: "0.3.0"`, since that is the shape of the payloads. Verify it yourself:

```bash
curl localhost:4201/.well-known/a2a-agent-card   # Python agent, v1.0 path
curl -X POST localhost:4201 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":
      {"kind":"message","role":"user","messageId":"m1",
       "parts":[{"kind":"text","text":"summarise this please"}]}}}'
```

## Optional: plan with a real model

The swarm runs with zero dependencies and plans with keyword rules. Those rules are brittle on purpose — ask for "the language they speak in Paris" and the plan collapses to a single `research` step.

To plan with a model instead, [ts/agents/planner.ts](ts/agents/planner.ts) tries three backends in order:

| Backend | Requirement | How the capability list is enforced |
|---|---|---|
| `claude-api` | `ANTHROPIC_API_KEY` + `npm i @anthropic-ai/sdk` | structured outputs — the schema `enum` **is** the live registry, so a bad step is unrepresentable |
| `claude-code` | the `claude` CLI, already logged in | **no API key needed** — runs on your Claude Code subscription; the plan is validated against the registry client-side |
| `rules` | nothing | keyword matching |

If you already use Claude Code, the second one needs no setup at all:

```bash
./scripts/swarm-up.sh
./scripts/demo-orchestrator.sh "Research agent swarms, then put the key points in the language they speak in Paris"
```

```
planner: claude-code  ("Gather raw findings on agent swarms, condense them to key
                        points, then translate into French; no delivery step was requested.")
plan:    research -> summarize -> translate
```

The rule-based planner returns just `research` for that sentence. The model also *declines* steps — no `notify`, because nothing asked for delivery.

**The plan follows the live swarm.** Kill the translator, wait for the health check, ask the identical question:

```
[orchestrator] asking the Claude Code CLI to plan over 10 live capabilities
plan:    research -> condense
```

No translate step, because no agent provides it. Restart the translator and it returns. Nothing is redeployed and no prompt is edited — the capability list *is* the registry. Any planner failure falls back down the chain, so the swarm always answers.

## What is deliberately not here

Apart from planning, the agents' *thinking* is rule-based — a note lookup, a longest-lines summariser, a toy French glossary. That keeps the demo deterministic, offline and free, and keeps your attention on coordination rather than model output. The remaining places an LLM belongs are marked in the code and tabled in [docs/04-swarm-patterns.md](docs/04-swarm-patterns.md#where-the-llm-goes).

Also out of scope: authentication, push notifications, task persistence, and signed cards. [docs/05-going-public.md](docs/05-going-public.md) explains what you must add before exposing any of this publicly.
