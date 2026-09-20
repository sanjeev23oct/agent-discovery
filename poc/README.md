# Prod-support POC: a real-life discovery scenario

Alice and Bob are gone. This is the same protocol mechanics applied to something
you'd actually build: **a prod-support agent that investigates an issue by
discovering and delegating to whatever specialists are registered** -- Splunk
for logs, ServiceNow for incidents, Jira for tickets, PagerDuty for escalation.

> **Every specialist here is mocked.** No real Splunk, ServiceNow, Jira or
> PagerDuty is involved anywhere -- each agent is ~40 lines returning a small
> canned, realistic-looking response. What's real is the protocol: the cards,
> the registry, the discovery, the delegation. Swap the mock `handle()` in any
> one of them for a real API call and nothing else in the system changes.

```bash
./poc/run-ui.sh
```

## Where's the registry?

Right here -- this is the piece the earlier two-agent demo didn't have, because
with only two agents you can get away with knowing one hardcoded URL. The
moment you have several specialists, "where is Bob" stops being the question.
The question is **"who can do X"**, and answering that is what a registry is for.

```
poc/registry.ts         ~75 lines. POST /register, GET /agents?tag=X, GET /index.
```

Every specialist calls `registerWithRegistry()` once on boot -- the same
function, [poc/mini.ts](mini.ts), that `poc/commander.ts` calls to *find* them.
Registering and discovering are the same small API, used from both ends.

```bash
node poc/registry.ts &
node poc/agents/splunk.ts &
curl 'http://localhost:5010/agents?tag=logs'
# -> {"tag":"logs","results":[{"card":{"name":"splunk (mock)", ...}, "matchedSkill":"logs.search"}]}
```

## The "I can't do this myself" narrative

Before every registry lookup, the commander says out loud why it's asking:

```
prod-support  CANT-DO-IT-MYSELF   I have no way to search logs myself -- checking the registry for an agent that does
prod-support  QUERYING-REGISTRY   GET http://localhost:5010/agents?tag=logs
prod-support  REGISTRY-HIT        registry says "splunk (mock)" offers "logs" (skill: logs.search)
prod-support  CALLING             POST http://localhost:5011 -> message/send (skill: logs.search)
splunk (mock) ANSWERED            critical :: 247 ERROR events in the last 15 minutes...
```

That five-line cycle -- **can't do it myself → ask the registry → found someone → call them → got an answer** -- repeats once per capability (`logs`, `incident`, `bug-tracker`, `oncall`). It's the clearest single thing to watch in the live dashboard to understand what a registry actually buys you.

## What the commander actually does

[poc/commander.ts](commander.ts) never mentions Splunk, ServiceNow, Jira or
PagerDuty by name or address. For every step it asks the registry a question
by **tag**:

```ts
const logs = await findByTag(REGISTRY_URL, "logs", "prod-support");
const finding = await call(logs.card, text, logs.matchedSkill, "prod-support");
```

The pipeline, each step gated on a real registry lookup:

1. **`logs`** -- always. Ask whoever offers `logs` to search for the reported service.
2. **`incident`** -- only if the finding isn't clean. Open an incident.
3. **`bug-tracker`** -- same condition. File a ticket referencing the incident.
4. **`oncall`** -- only if the finding is *critical*. Page whoever is on call.

Three severities, three different paths, all driven by the same code:

| Ask | Splunk says | Path taken |
|---|---|---|
| "Investigate error spike on checkout-service" | `critical` | logs → incident → ticket → **page on-call** |
| "Check payment-service for anomalies" | `warning` | logs → incident → ticket (nobody paged) |
| "Check auth-service health" | `clean` | logs only -- stops immediately |

Try all three from the dashboard's preset buttons.

## The "and so on" part

Add a fifth specialist -- say, a Grafana agent tagged `metrics` -- and it
becomes usable **with no change to `commander.ts`, the registry, or any other
agent.** It only has to register.

```bash
node -e '
import("./poc/mini.ts").then(async ({ serve, registerWithRegistry }) => {
  const { card, ready } = serve({
    name: "grafana (mock)", port: 5015,
    description: "Dashboards and metrics.",
    skills: [{ id: "metrics.query", description: "Query metrics.", tags: ["metrics","grafana"] }],
    handle: () => "CPU 82% (up from 40% baseline) on checkout-service pods.",
  });
  await ready;
  await registerWithRegistry("http://localhost:5010", card.url, "grafana (mock)");
});'
curl 'http://localhost:5010/agents?tag=metrics'
# -> grafana (mock) is there. The commander never had to know it would exist.
```

That's the actual claim "the swarm discovers new agents" is making. Registering
one process made it real.

## The live dashboard

```bash
./poc/run-ui.sh
```

Opens `http://localhost:5099` with three real, live views:

- **Every agent's card**, fetched from its own `/.well-known/agent-card.json` --
  not hardcoded text.
- **The registry's own tag index**, fetched from `GET /index` -- this is the
  direct answer to "where do I see the registry": it's its own panel, always
  current, refreshed every few seconds.
- **A live trace** of every registry lookup and every call, as it happens.

Nothing is simulated. `TRACE_URL` makes each of the six processes (registry +
4 specialists + commander) report what it's already doing, over fire-and-forget
HTTP, to the dashboard. Unset it and every agent behaves identically.

### A subtlety worth knowing about

Events arrive at the dashboard from **six independent processes** over
separate HTTP connections. Arrival order at the browser is not the same
thing as the true order things happened in -- a specialist's own
`received`/`answered` trace can physically land *after* the caller's next
step, even though the caller `await`ed that specialist's real response
before taking that step. The trace POST and the actual protocol response
are two unrelated races.

Every event carries `at`, a timestamp taken at the moment it genuinely
happened. All six processes share one machine clock, so those timestamps
are directly comparable. The dashboard buffers arrivals for ~120ms and
flushes them sorted by `at` -- a small, deliberate latency trade for a
timeline that is causally correct rather than merely arrival-ordered.
[poc/ui-html.ts](ui-html.ts) has the full reasoning where the buffer is built.

## The files

| File | What it is |
|---|---|
| [mini.ts](mini.ts) | The protocol, ~200 lines: cards, `message/send`, plus a registry client (`registerWithRegistry`, `findByTag`) |
| [registry.ts](registry.ts) | The registry: register, discover by tag, ~75 lines |
| [commander.ts](commander.ts) | The prod-support agent -- the entry point, discovers everything else |
| [agents/splunk.ts](agents/splunk.ts) | Mock: searches logs, returns a severity + finding |
| [agents/servicenow.ts](agents/servicenow.ts) | Mock: opens an incident, returns an INC number |
| [agents/jira.ts](agents/jira.ts) | Mock: files a ticket, returns a PROJ key |
| [agents/pagerduty.ts](agents/pagerduty.ts) | Mock: pages on-call, returns who and when |
| [ui.ts](ui.ts) + [ui-html.ts](ui-html.ts) | Optional: the live dashboard. Not part of the protocol; a spectator. |
| [run.sh](run.sh) | CLI: boot everything, ask two questions, print the answers |
| [run-ui.sh](run-ui.sh) | Boot everything traced, open the dashboard |

## What this leaves out

No LLM anywhere -- the commander's pipeline is a fixed sequence of tagged
lookups, not a planner. That keeps the demo deterministic and free to run.
The full swarm's [`ts/agents/planner.ts`](../ts/agents/planner.ts) shows where
a real planner would replace this fixed sequence, and why: "investigate this,
and if it's bad enough, escalate" is exactly the kind of judgment call a fixed
pipeline can't make well, and a model can.

Also missing, same as the two-agent version: task storage, `tasks/get`,
cancellation, streaming, JSON-RPC error codes, the `input-required` state,
authentication, and the real-world tolerances documented in
[../docs/03-discovery.md](../docs/03-discovery.md#four-bugs-real-agents-found-in-this-client).
All of that is in [../ts/a2a/](../ts/a2a/) and the full swarm under
`./scripts/swarm-up.sh`.
