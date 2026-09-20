# 6. Does this actually pay off?

An honest assessment, written after scanning 318 live public agents and calling a dozen of them. If you are trying to work out whether agent swarms are worth your time, read this before the rest.

## What the public ecosystem actually sells

The top capability tags across 318 live public agents:

```
 299  x402          (machine payments)
 151  trust
 149  free
 139  verification
 112  attestation
 105  witness
  71  mcp
  64  discovery
  51  base          (an L2 blockchain)
  50  a2a
```

Read that list again. It is almost entirely **infrastructure for agents to pay and trust each other**. Payments, attestation, verification, discovery. Very little of it is work a person wanted done.

The ecosystem today is largely selling picks and shovels to other prospectors. That is not damning — early ecosystems often look like this — but you should not mistake 318 agents for 318 useful services.

## The news test

"Is there a news agent I can use?" is a fair question with a checkable answer. Eleven public agents in the registry advertised news-shaped skills. Calling every one of them with the same request:

| Result | Count |
|---|---|
| Returned actual headlines | **0** |
| Replied, but with an upsell or a catalogue | 4 |
| Empty response | 3 |
| Endpoint broken (404 / 530 / non-JSON) | 3 |
| Wrong payload schema, then demanded payment | 1 |

The closest to working was CONNSKILL's `news-search`, and getting there took three rounds of guessing: it wanted a `data` part rather than text, then the field `keyword` rather than `query`, and then it answered:

```json
{ "kind": "task", "status": { "state": "input-required" },
  "message": "Payment is required. Sign one of the accepts and resubmit with x402.payment.payload" }
```

That is a correct, spec-compliant response. `input-required` is exactly the state for "the caller must do something before I continue". The protocol worked perfectly. You still have no news.

Meanwhile:

```js
const xml = await fetch("https://hnrss.org/frontpage").then(r => r.text());
```

One line, no protocol, no payment, real headlines. [ts/agents/news.ts](../ts/agents/news.ts) is 60 lines of that and it works every time.

**The lesson is not that A2A is useless. It is that A2A is not a substitute for a data source.** If the other side is a feed, use the feed.

## So when is a swarm actually worth it?

A2A earns its cost when the other side is genuinely an *agent* — something that reasons, holds state, or does work you cannot specify in advance — and when it sits across a boundary you do not control.

Concretely, in rough order of how often it is the right answer:

1. **Across teams in one company.** Your platform team owns a deployment agent. Your support team wants to use it. A card plus an endpoint beats a shared library, a shared repo, and a shared release cycle. This is the most reliably valuable case and it needs no public directory at all.
2. **Across vendor boundaries.** You and a supplier automate a workflow neither side can unilaterally change. The card is the contract.
3. **When the specialists genuinely differ.** Different models, different data access, different security posture. A swarm lets each be right rather than forcing one compromise.
4. **When you need partial failure.** Kill the translator in this repo and you still get a briefing. That property is hard to get inside one agent.

And when it is not worth it:

- **The sequence is fixed and you own all of it.** That is a pipeline. Write a function. It will be faster, cheaper and far easier to debug.
- **The other side is a data source.** Use its API.
- **You want capability from strangers on the internet.** Today, mostly you will find paywalls, upsells and dead endpoints. The discovery mechanics work; the supply is not there yet.

## The honest cost

Building the swarm in this repo surfaced these, all of them real and all of them in the commit history:

- A completed task that looked empty, because the agent replied with a `data` part.
- A valid reply discarded, because it was a bare `Message` and the code demanded a `Task`.
- `HTTP 403` from Python but not curl, because of the default User-Agent.
- `spawn E2BIG` once the registry held 3,349 capabilities and the planner's prompt exceeded the OS argument limit.
- The orchestrator silently delegating a user request to **a stranger's paid agent**, because capability lookup was not scoped to our own swarm.

That last one is the one to take seriously. It is a one-word fix and it was invisible until the registry had real agents in it. In a system where routing is dynamic by design, "who can do X" must be bounded by "who am I willing to send data to" — which is why `SWARM_ALLOW_PUBLIC` now defaults to off.

## What to take away

The mechanics in this repo work, and they are worth understanding: cards, tasks, capability discovery, graceful degradation. They will matter.

But the value today is **inside and between organisations**, not in an open marketplace of agents. Build the swarm because your teams need a contract between their agents. Do not build it because you expect to find a useful stranger on the internet — check first, as this repo does, and decide with data.

Back to the [README](../README.md).
