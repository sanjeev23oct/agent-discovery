# 4. Swarm patterns

Two patterns are implemented here; two more are sketched. The axis that separates them is simply: **who decides what happens next?**

## Pattern 1 — Orchestrator + specialists

One agent holds the plan. It discovers specialists by capability, delegates, and merges results.

```
                  ┌──────────────┐
  request ───────▶│ orchestrator │  owns the plan
                  └──────┬───────┘
         ┌───────────┬───┴───────┬────────────┐
         ▼           ▼           ▼            ▼
    researcher  summarizer  translator    notifier
       (TS)        (Py)        (Py)         (TS)
                  ── all under one contextId ──
```

```bash
./scripts/demo-orchestrator.sh "Research agent swarms and give me a short briefing in French"
```

[ts/agents/orchestrator.ts](../ts/agents/orchestrator.ts) is about 100 lines and does four things: plan, discover, delegate in sequence, merge.

The specialists are never named in the code. The plan is a list of *capabilities* (`research`, `summarize`, `translate`, `notify`), each resolved through the registry at execution time. Start a second translator and it participates without the orchestrator changing.

**Good for:** anything you need to debug. One agent holds the trace, one place to add retries, and the plan is inspectable before it runs — the demo prints it.

**Bad for:** availability and latency. The orchestrator is a single point of failure and a sequential bottleneck. It also has to know enough about every capability to plan with it, which is a real coupling even though no addresses are hardcoded.

### Instructions must not be content

One detail worth copying. When the orchestrator delegates, the instruction travels in `metadata.instruction` and **only the payload goes in the message parts**:

```ts
const task = await peer.client.send(payload, {
  contextId,
  skill: peer.skillId,
  metadata: { instruction: step.instruction, route: [], hops: ["orchestrator"] },
});
```

An earlier version of this demo prepended the instruction to the payload. The summarizer then summarised the instructions along with the findings, and the translator dutifully translated `"Publish this as a briefing"` into French and put it in the output. Agents receive both as `ctx.text` / `ctx["instruction"]` — see [ts/a2a/server.ts](../ts/a2a/server.ts). Keep the channels separate.

## Pattern 2 — Peer-to-peer handoff

No coordinator. The message carries a `route` of capabilities, and each agent resolves its own next hop.

```
researcher ──▶ summarizer ──▶ translator ──▶ notifier
   (TS)           (Py)            (Py)         (TS)

metadata.route:  [summarize, translate, notify]   ← at the researcher
                 [translate, notify]              ← at the summarizer
                 [notify]                         ← at the translator
                 []                               ← at the notifier
```

```bash
./scripts/demo-handoff.sh "agent swarms"
```

The route is **capabilities, not addresses**. Each agent finishes its work, pops the next capability, asks the registry who provides it, and forwards — see [ts/a2a/handoff.ts](../ts/a2a/handoff.ts) and its Python twin. No agent ever knows the whole chain.

`hops` accumulates the trail, which is what lets the notifier print the path the work actually took.

### Graceful degradation is the payoff

If nobody provides a capability, the agent **skips it and tries the next one** rather than abandoning the route. Watch it:

```bash
./scripts/demo-handoff.sh                       # researcher → summarizer → translator → notifier
kill $(lsof -nP -iTCP:4202 -sTCP:LISTEN -t)     # translator only
sleep 11                                        # let the health check notice
./scripts/demo-handoff.sh                       # researcher → summarizer → notifier
```

You lose the translation. You still get the briefing. Compare with the orchestrator, where losing the orchestrator loses everything.

This is not free — the failure is silent. The output is simply in English, and nothing says why unless you read the summarizer's log (`no peer advertises "translate" -- skipping it`). Whether silent degradation or loud failure is right depends on your product; make it a deliberate choice rather than an accident.

### Handoff, precisely

In this implementation, agent A awaits agent B's reply, which returns up the chain. **Control** is decentralised — each agent chooses its own successor — while **transport** is nested request/response. That is why the originator gets a complete answer from one call.

The alternative is fire-and-forget: A returns `input-required` or a receipt immediately and B delivers to a callback. That removes the nesting and lets chains run for hours, at the cost of needing push notifications (`tasks/pushNotificationConfig/set`) and somewhere durable to collect results. A2A supports it; this repo does not implement it.

## Pattern 3 — Parallel fan-out / fan-in (not implemented)

Independent steps have no reason to be sequential:

```ts
const peers = await discover({ tag: "research" });
const tasks = await Promise.all(
  peers.map((p) => new A2AClient(p.agent).send(question, { contextId })),
);
const merged = tasks.filter((t) => t.status.state === "completed").map(taskOutput);
```

Ask five researchers at once and merge, or ask three and take the first acceptable answer. The hard part is not the fan-out, it is the fan-in: deciding what to do when three agents disagree. That is a product decision, not a protocol one.

## Pattern 4 — Blackboard / emergent (not implemented)

Agents subscribe to a shared task board and volunteer when a posted task matches their skills. Closest to biological swarming, and the most adaptive — but the hardest to debug, and prone to both duplicated work and tasks nobody claims. Worth knowing about; rarely the right first choice.

## Where the LLM goes

Everything here is rule-based so the demo is deterministic, offline and free. There are exactly four places a model belongs, all marked in the code:

| Place | File | What the model would do |
|---|---|---|
| **Planning** | `plan()` in [orchestrator.ts](../ts/agents/orchestrator.ts) | Given the request and the skills the registry lists, decide which capabilities to use and in what order |
| **Routing** | `routeSkill()` in [server.ts](../ts/a2a/server.ts) | Decide which of this agent's own skills an incoming message wants |
| **The work** | each agent's handler | Actually research, summarise, translate |
| **Matching** | `search()` in [registry/server.ts](../ts/registry/server.ts) | Semantic capability matching instead of tag equality |

Start with planning. It is where a rule-based system is most obviously inadequate and where a model most obviously earns its cost: `plan()` currently matches substrings like `"french"`, which fails the moment someone writes "put it in the language they speak in Paris".

Keep the other three deterministic for as long as you can. Every model call is latency, cost and nondeterminism, and in a swarm those compound at every hop.

Next: [5. Going public](05-going-public.md)
