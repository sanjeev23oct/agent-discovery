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

## Where to find public agents

Verified live, September 2026. The first two are the sources of truth; the rest are third-party directories of varying usefulness.

| Site | What it is | Machine-readable? |
|---|---|---|
| [a2a-protocol.org](https://a2a-protocol.org) | The official spec, under the Linux Foundation. Start here for the protocol itself, not for agents. | spec only |
| [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A) | The official project repo and SDKs (★25.8k). | schemas, SDKs |
| [a2aregistry.org](https://a2aregistry.org) | The largest working directory: **416 agents, 393 reporting healthy**. | **yes** — `GET /api/agents?limit=100&offset=0`, paginated, with `is_healthy`, `conformance`, `uptime_percentage`, `avg_response_time_ms` |
| [a2a-registry.org](https://www.a2a-registry.org) | A separate curated registry; also defines an `agents.json` multi-agent card format. | no public JSON API found |
| [agenstry.com](https://agenstry.com) | Independent directory that tracks A2A and MCP agents. | no public JSON API found |
| [a2aagentlist.com](https://a2aagentlist.com) | Browsable list, lighter metadata. | no public JSON API found |
| [agentcard.net](https://www.agentcard.net/well-known-agent-json) | Card validator — paste a domain, check your own card is served correctly. | validator |

**Note the two similar names.** `a2aregistry.org` and `a2a-registry.org` are different sites run by different people. Only the first exposed a usable JSON API when tested.

This repo's scanner uses that API, with HTML scraping as a fallback:

```bash
node ts/registry/scan.ts              # pulls all 416 from the JSON API
node ts/registry/scan.ts --limit 60   # smaller sample
DIRECTORY_API=https://your-registry/api/agents node ts/registry/scan.ts
```

### Read the directory's metadata sceptically

The registry API exposes a `pricing` field. All 416 agents leave it `unspecified`, so you cannot tell what a call will cost until you make one — and a good number answer with `input-required` and an x402 payment demand. `is_healthy` means the card is fetchable, not that the agent does anything useful: 393 were "healthy" and none of the eleven news agents returned a headline. See [6. Does this pay off?](06-does-this-pay-off.md).

## Consuming a public agent

Discovery is only half of it. `ts/demos/call-public.ts` calls real public agents with this repo's own client:

```bash
node ts/demos/call-public.ts
node ts/demos/call-public.ts https://host/a2a some-skill "your message"
```

And because scanned agents land in the same registry as your own, a **local agent can hand work to a stranger's agent with no code change** — `open-source` is a tag only a public agent advertises:

```ts
await researcher.send("agent swarms", {
  skill: "research.gather",
  metadata: { route: ["summarize", "open-source"], hops: [] },
});
```

```
researcher (TS, localhost) → summarizer (Python, localhost) → Sidequest Commons Guide (public internet)
```

No address appears anywhere in that call. Both hops are capability names resolved through the registry.

### Four bugs real agents found in this client

A client written only from the spec talked to four of five strangers' agents. Getting there took four fixes, each from a live failure:

| Symptom | Cause | Fix |
|---|---|---|
| Completed task looked empty | Agent answered with a `data` part; `taskOutput()` read only text | Read `data` and `file` parts too, and fall back to `status.message` |
| Handoff silently dropped the reply | `message/send` may return a bare **Message**, not a Task; our code required `status.state === "completed"` | Only check state when a state exists |
| `HTTP 403 Forbidden` from Python, while curl worked | stdlib default UA `Python-urllib/3.9` blocked at the CDN before reaching the agent | Send a real `User-Agent` from both clients |
| `message.parts[0] must be type=text` | Pre-0.3 agent expects `type`, not `kind`, as the part discriminator | Read either spelling; that agent still times out, so it stays unreachable |

The pattern is that **the spec describes a happy path and the wire has a long tail.** Anything you write against A2A needs to accept Task *or* Message, text *or* data parts, `kind` *or* `type`, and must identify itself over HTTP. None of that is exotic; all of it is invisible until you call someone else's server.

### A genuine v1.0 agent breaks all four assumptions above again

Every agent in the table above claims a version but actually speaks v0.3-shaped JSON regardless. [CarGene](https://car-gene.com) doesn't -- it's a real, currently-live agent (Japanese car genealogy data) that speaks proto3-JSON A2A v1.0 for real, and calling it correctly needed three more fixes:

| Symptom | Cause | Fix |
|---|---|---|
| Card fetch succeeds, then rejected as "not an agent card" | v1.0 card has no top-level `url` -- the endpoint lives in `supportedInterfaces[].url`, alongside that interface's own `protocolVersion` | Normalise the card: promote the JSON-RPC interface's `url`/`protocolVersion` to the top level before anything else reads them |
| Every request rejected with JSON-RPC code `-32009`, even a correctly-v0.3-shaped one | This server strictly requires an `A2A-Version` header and treats its absence as an explicit (and refused) "0.3" -- verified directly: identical body, only the header differs, `-32009` either way it's missing | Send `SendMessage` (not `message/send`), role `"ROLE_USER"` (not `"user"`), parts as a bare `{text: ...}` with **no** `kind` key at all -- v1.0's binding is proto3-JSON, where `Part` is a proto `oneof` and the chosen field *is* the discriminator -- and the `A2A-Version` header, only when the card says v1.0 |
| A successful response still produced empty output | `SendMessageResponse` is itself a oneof: the payload is wrapped as `{"message": {...}}` or `{"task": {...}}`, not `result` directly | Unwrap the envelope before reading parts; parts with neither `kind` nor `type` are read by which of `text`/`data`/`file` is actually present |

One more, found only because a real agent used a path-prefixed base URL: the Python client resolved `/.well-known/...` by string-concatenating it onto the base URL, so `agents.algovoi.co.uk/a2a` produced `.../a2a/.well-known/agent-card.json` -- wrong, since [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) well-known URIs resolve against the **origin**, dropping any path. The TypeScript client already got this right via `new URL(path, baseUrl)`; Python needed the equivalent origin-only resolution.

Try it: `node ts/demos/call-public.ts https://car-gene.com search_vehicles "AE86"` or `python3 py/demos/call_public.py`.

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
