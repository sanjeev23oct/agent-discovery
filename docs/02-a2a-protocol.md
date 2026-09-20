# 2. The A2A protocol

A2A (Agent2Agent) is an open protocol for agents to call other agents. Google published it in 2025 under the Linux Foundation; on 2026-08-20 it moved to the [Agentic AI Foundation](https://aaif.io) (AAIF) — a Linux Foundation-directed body — where it now sits alongside Anthropic's MCP under the same neutral governance. See [docs/07-a2a-vs-mcp.md](07-a2a-vs-mcp.md) for how the two protocols relate.

Its bet is narrow and sensible: **agents are opaque to each other.** You do not get to see another agent's prompts, tools, memory or model. You see a capability description, and you exchange messages about tasks. Everything else is private.

> **A2A vs MCP.** MCP connects an agent to *tools and data*. A2A connects an agent to *other agents*. They sit at different layers and compose fine — an A2A agent commonly uses MCP internally to reach its own tools.

## The four objects

Everything in this repo is built from four things.

### Agent Card — who you are

A JSON document served at a well-known URL. It is the only thing another agent needs to start working with you.

```bash
curl localhost:4101/.well-known/agent-card.json
```

```json
{
  "protocolVersion": "0.3.0",
  "name": "researcher",
  "description": "Gathers raw findings on a topic from its note store.",
  "url": "http://localhost:4101",
  "version": "1.0.0",
  "preferredTransport": "JSONRPC",
  "capabilities": { "streaming": true, "pushNotifications": false,
                    "stateTransitionHistory": true },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [{
    "id": "research.gather",
    "name": "Gather findings",
    "description": "Collect raw, unsummarised findings about a topic.",
    "tags": ["research", "gather", "facts"],
    "examples": ["Research the A2A protocol"]
  }]
}
```

`url` is where requests go; the card itself lives at the well-known path. The two are separate on purpose, so an agent can be fronted by a gateway.

**`skills` is the part that matters for discovery.** `tags` is what registries index and what callers search — treat them the way you would treat search keywords, not internal identifiers. Built in [ts/a2a/server.ts](../ts/a2a/server.ts).

### Message — one utterance

```json
{
  "kind": "message",
  "role": "user",
  "messageId": "msg-a1b2c3d4",
  "contextId": "ctx-5u5y8vju",
  "parts": [{ "kind": "text", "text": "Research the A2A protocol" }],
  "metadata": { "skill": "research.gather" }
}
```

`role` is `user` or `agent` — and "user" means *whoever is calling*, which is usually another agent. `parts` is a list because a message can mix text, files and structured data.

### Task — the unit of work

This is what A2A gives you over "just POST some JSON". A Task is **stateful and addressable**: it has an id you can poll, cancel, and come back to tomorrow.

```json
{
  "kind": "task",
  "id": "task-v3itwjiu",
  "contextId": "ctx-5u5y8vju",
  "status": { "state": "completed", "timestamp": "2026-09-20T10:31:02.511Z" },
  "artifacts": [{
    "artifactId": "artifact-9xk2",
    "name": "findings",
    "parts": [{ "kind": "text", "text": "Findings on: ..." }]
  }],
  "history": [ /* every message on this task */ ]
}
```

Task states, from [ts/a2a/types.ts](../ts/a2a/types.ts):

| State | Meaning |
|---|---|
| `submitted` | accepted, not started |
| `working` | in progress |
| `input-required` | **interrupted** — the caller must reply before work continues |
| `auth-required` | **interrupted** — credentials needed |
| `completed` | **terminal** — success |
| `failed` | **terminal** — error |
| `canceled` | **terminal** — caller gave up |
| `rejected` | **terminal** — agent declined |

`input-required` is the state people miss. Agent work is not always one-shot; an agent is allowed to come back and ask a question, and the task stays alive while it waits.

### Artifact — the output

Outputs are separate from the conversation. `history` is what was said; `artifacts` are what was produced. Downstream agents read artifacts, which is why [`taskOutput()`](../ts/a2a/client.ts) only ever looks there.

## Contexts tie a conversation together

`contextId` groups messages and tasks across *different agents*. In `demo-orchestrator.sh`, all four specialists run under one `contextId` — five tasks, five agents, one conversation. This is the thread you correlate logs on when debugging a swarm, and the main reason to propagate it faithfully.

## The wire: JSON-RPC 2.0

Every call is a `POST` to the agent's `url` with a JSON-RPC 2.0 body.

```bash
curl -X POST localhost:4201 -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "message/send",
  "params": { "message": {
    "kind": "message", "role": "user", "messageId": "m1",
    "parts": [{"kind": "text", "text": "summarise this long text ..."}]
  }}
}'
```

Methods implemented here:

| Method (v0.3) | v1.0 name | What it does |
|---|---|---|
| `message/send` | `SendMessage` | send a message, get a Task back |
| `message/stream` | `SendStreamingMessage` | same, with SSE status updates (TS agents only) |
| `tasks/get` | `GetTask` | poll a task by id |
| `tasks/list` | `ListTasks` | list this agent's tasks |
| `tasks/cancel` | `CancelTask` | cancel a non-terminal task |

Errors use JSON-RPC codes, with A2A's own range from `-32001`:

```json
{ "jsonrpc": "2.0", "id": "req-1",
  "error": { "code": -32001, "message": "Task not found" } }
```

Note the distinction that trips people up: **a failed task is a successful RPC.** `message/send` returns HTTP 200 with a Task whose state is `failed`. JSON-RPC errors are for malformed calls; task failure is normal business. Both handoff implementations check `task.status.state` rather than assuming a returned task succeeded.

## Two protocol revisions

The spec renamed things between v0.3.x and v1.0:

| | v0.3.x | v1.0 |
|---|---|---|
| Card path | `/.well-known/agent-card.json` | `/.well-known/a2a-agent-card` |
| Method names | `message/send`, `tasks/get` | `SendMessage`, `GetTask` |
| Bindings | JSON-RPC | JSON-RPC + REST + gRPC |

Almost everything deployed today speaks v0.3.x, so these agents use its payload shapes — but they **serve both card paths** and **accept both method spellings**. The cost is a few lines ([`WELL_KNOWN_PATHS`](../ts/a2a/types.ts), the `case` fallthroughs in [`dispatch`](../ts/a2a/server.ts)); the benefit is that a client written against either revision can talk to them.

That is a broadly useful habit for a young protocol: **be strict in what you publish, generous in what you accept.**

## Using the official SDKs

The implementation here is hand-rolled so the whole protocol is readable in one sitting, and so the repo has no dependencies. For production, use the official SDKs:

```bash
npm install @a2a-js/sdk     # TypeScript
pip install a2a-sdk         # Python (needs 3.10+)
```

They add what this deliberately omits: signed cards, authenticated extended cards, push notification config, streaming reconnection (`tasks/resubscribe`), and transport negotiation. The concepts map one to one — the objects on your screen are the objects in this doc.

Next: [3. Discovery](03-discovery.md)
