# 3. Discovery

Two different questions hide under the word "discovery":

1. **"Here is an agent's address — what can it do?"** → the Agent Card.
2. **"I need something translated — who can do that?"** → a registry.

A2A standardises the first and only names the second. Most of the confusion around agent discovery comes from conflating them.

## Level 1: the Agent Card

Every agent publishes a capability document at a well-known path on its own domain. No central authority, no registration, no account — if you can reach the host, you can read the card.

```bash
curl localhost:4101/.well-known/agent-card.json
curl localhost:4201/.well-known/a2a-agent-card    # the v1.0 path, same card
```

This follows [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615), the same mechanism as `/.well-known/security.txt`. The consequence is that **the web's existing naming system is the agent naming system.** Your domain is your identity. There is no new namespace to register in.

Fetching is in [`fetchAgentCard()`](../ts/a2a/client.ts) — it tries each known path in turn, which is how one client works against both protocol revisions.

Level 1 alone is enough for a fixed set of partners. It is not enough for a swarm, because you have to already know every address.

## Level 2: a registry

A registry crawls and indexes cards so agents can be found by *capability* rather than by address. The spec explicitly names registries as a discovery mechanism but does not define one — so [ts/registry/server.ts](../ts/registry/server.ts) is this repo's own, about 180 lines.

```
agent boots ──POST /register {cardUrl}──▶ registry
                                            │ fetches the card
                                            │ indexes its skills + tags
                                            ▼
peer needs "translate" ──GET /agents?tag=translate──▶ [translator's card]
```

### The API

| Endpoint | Purpose |
|---|---|
| `POST /register` | `{"cardUrl": "http://host:port"}` — announce yourself |
| `GET /agents?tag=translate` | find agents by capability tag |
| `GET /agents?skill=text.translate` | find by exact skill id |
| `GET /agents?q=shorten` | free-text over id, name, description and tags |
| `GET /agents?includeOffline=true` | include agents that failed their health check |
| `GET /skills` | flat index of every skill in the swarm |
| `DELETE /agents/:name` | deregister |

Try it:

```bash
curl 'localhost:4000/skills'
curl 'localhost:4000/agents?tag=translate'
curl 'localhost:4000/agents?q=shorten'
```

### Registration is pull, not push

`POST /register` sends a **card URL, not a card**. The registry then fetches it itself.

This is a small decision with large consequences. An agent cannot lie about capabilities it does not serve, because the registry reads the card from the source of truth. Re-fetching also doubles as a health check: a card you cannot fetch is an agent you cannot call. That is the whole of [`refresh()`](../ts/registry/server.ts).

### Liveness is eventually consistent

The registry re-crawls every 10 seconds and marks unreachable agents `online: false`; queries exclude them by default. Kill an agent and watch:

```bash
curl 'localhost:4000/agents?includeOffline=true' | grep -A1 '"online"'
```

**The registry is always slightly stale.** A caller can be handed an agent that died a second ago. Callers must expect this — both handoff implementations catch the connection failure and move to the next capability rather than propagating the error. Treating the registry as authoritative about liveness is the most common way these systems break in practice.

## Capability matching

Matching here is deliberately crude: exact skill id, tag membership, or substring search. That is the seam where the interesting work goes.

The honest problem is that **tags are a shared vocabulary that nobody agreed on.** Your agent says `translate`; someone else's says `localization`. Within one swarm you can just standardise. Across organisations you cannot, and that is an open problem in the ecosystem today, not something A2A solves.

Practical upgrades, in order of effort:

1. **Synonym expansion** — map `localization`, `i18n` and `translate` onto one concept.
2. **Semantic search** — embed each skill's `description` and match by cosine similarity. Roughly a 30-line change to `search()` in the registry.
3. **LLM-based selection** — hand the model every candidate card and let it choose. Expensive per call, but it handles "I need someone who can explain this to a lawyer".

All three change only the registry's `search()`. Agents are unaffected, which is the benefit of keeping discovery out of the agents.

## Why the registry is not an agent

The registry serves no Agent Card and speaks no A2A. It is deliberately dumb infrastructure — closer to DNS than to a participant.

Keeping it dumb means it cannot become a bottleneck for reasoning, and it can be replaced (with DNS records, a service mesh, a public directory) without touching a single agent. The only thing agents depend on is "something can answer *who does X*".

## Scanning the public ecosystem

The registry does not have to index only your own agents. `ts/registry/scan.ts` pulls candidate card URLs from a public A2A directory, fetches each card, and loads the valid ones in alongside your swarm.

```bash
./scripts/swarm-up.sh
node ts/registry/scan.ts          # ~25s for ~380 candidates
open http://localhost:4000/ui
```

A real run, September 2026:

```
candidates : 383
reachable  : 318  (83%)
skills advertised : 2290

why the rest failed:
    49  not an agent card
     5  fetch failed
     4  timeout
     2  HTTP 404
     2  invalid JSON
```

### Scanning etiquette

These are other people's servers. The scanner takes candidates from a published directory or a file you supply — **never** from enumerating hosts or guessing domains — makes exactly one GET per agent to a path whose entire purpose is to be publicly fetched, and caps concurrency at 12 with a 6s timeout and no retries. The registry also refuses to health-poll public entries on its timer; re-polling hundreds of strangers' servers every 10 seconds would be abuse.

### What real cards actually look like

Three things the live ecosystem taught this codebase, each of which changed the code:

**1. "Required" fields are not required in practice.** The spec marks `skills` as required. Five of 318 live agents omit it entirely. Trusting that took the registry down with `TypeError: Cannot read properties of undefined (reading 'filter')` — one query, whole process gone. Every card is now coerced through `normaliseCard()` on the way in, and the HTTP handler has a catch-all so one bad record cannot kill the service.

**2. A fifth of agents serve only the legacy path.** 73 of 383 candidates publish at `/.well-known/agent.json`, not `agent-card.json`. A scanner that only tries the current path silently under-reports the ecosystem by ~19%, which is why `WELL_KNOWN_PATHS` has three entries.

**3. Cards carry content aimed at your model.** 11 of 318 descriptions (3%) contain instruction-shaped text — "you must", "USE THIS WHEN YOUR USER NEEDS", "do not", "ignore previous". The longest single description is **25,284 characters**. These are not documentation; they are written to be pasted into a calling agent's context window.

That third one is the important one. If you feed discovered cards to an LLM planner, **you have handed strangers a slot in your prompt.** Treat every field of a remote card as untrusted data: render it escaped, truncate it, and never concatenate it into a system prompt. See [5. Going public](05-going-public.md#step-3--treat-other-agents-as-untrusted-input).

## Making your own agent discoverable

Inside this swarm, three lines:

```ts
await agent.listen();
await register(agent.card.url);   // ts/a2a/registry-client.ts
```

```python
threading.Thread(target=register, args=(agent.base_url,), daemon=True).start()
agent.serve_forever()
```

`register()` retries, because in a swarm you cannot assume the registry booted before you did.

For the outside world — public URLs, TLS, authentication, public directories — see [5. Going public](05-going-public.md).

Next: [4. Swarm patterns](04-swarm-patterns.md)
