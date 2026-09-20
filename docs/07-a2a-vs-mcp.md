# 7. A2A vs MCP, with sources

You asked, reasonably, whether the Agent Card you clicked in the dashboard is
a real standard, and how it relates to MCP. Answered plainly: **yes, it's
real and specified, and it is not MCP.** Here is the sourced version.

## The one-sentence version, from each protocol's own docs

> "The Model Context Protocol (MCP) defines how an AI agent uses individual
> tools and resources, such as a database or an API."
> — [A2A's own comparison page, "A2A and MCP"](https://a2a-protocol.org/latest/topics/a2a-and-mcp/)

> "The Agent2Agent Protocol lets different agents collaborate to reach a
> common goal."
> — [same source](https://a2a-protocol.org/latest/topics/a2a-and-mcp/)

That page also gives A2A's own illustration: a mechanic agent diagnosing a
car uses **MCP** to call a diagnostic scanner and a repair-manual database —
tools inside its own system. When it needs a part, it uses **A2A** to
negotiate with an external supplier agent — a different organisation
entirely. Their own framing: **MCP is vertical** (an agent reaching down into
its own tools), **A2A is horizontal** (an agent reaching sideways to a peer).

## Side by side, verified against each spec

| | MCP | A2A |
|---|---|---|
| Connects | one agent → tools, data, prompts | one agent → another agent |
| Wire format | JSON-RPC 2.0 | JSON-RPC 2.0 (also REST and gRPC bindings in v1.0) |
| Roles | Host, Client, Server | Client agent, Server agent |
| Core primitives | Resources, Prompts, Tools (server→client); Elicitation (client→server) | Agent Card, Message, Task, Artifact |
| Discovery document | none | Agent Card at `/.well-known/agent-card.json` (v0.3.x) or `/.well-known/a2a-agent-card` (v1.0) |
| Current spec version | `2026-07-28` (dated releases) | `1.0.0` (latest released; most deployed agents still speak `0.3.x`) |
| Origin | Anthropic, 2024-11-25 | Google, 2025 |
| Governance today | [Agentic AI Foundation](https://aaif.io) (AAIF) | Agentic AI Foundation (AAIF) — **the same foundation**, as of 2026-08-20 |

Sources for each row:
[MCP specification](https://modelcontextprotocol.io/specification/latest) (transport, roles, primitives, version date) ·
[A2A specification](https://a2a-protocol.org/latest/specification/) (version, discovery path) ·
[A2A and MCP](https://a2a-protocol.org/latest/topics/a2a-and-mcp/) (the comparison itself) ·
[Linux Foundation: A2A joins AAIF](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) and [AAIF's own post](https://aaif.io/blog/a2a-joins-aaif) (governance, dated 2026-08-20) ·
[Anthropic: Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol) (MCP origin date).

## The part worth pausing on: they now share a governance home

Until August 2026 it would have been fair to call these "Google's protocol"
and "Anthropic's protocol." That's no longer the framing that matters. Both
now live under the **Agentic AI Foundation**, a Linux Foundation-directed
body launched in December 2025 that had grown to 250+ member organisations
by mid-2026, including Google, Microsoft, Amazon, Anthropic, OpenAI,
Bloomberg and Shopify. MCP, A2A, `goose`, and `AGENTS.md` are sibling
projects under it. Neither protocol is vendor-controlled; a company shipping
both isn't hedging between competitors, it's implementing two different
layers of the same open stack.

## What this means for the code in this repo

- [ts/a2a/](../ts/a2a/) and [py/a2a/](../py/a2a/) implement **A2A only** —
  cards, tasks, `message/send`. There is no MCP code here, and nothing in
  this repo connects an agent to a tool or a data source the way MCP does.
- The **mock specialists** (`splunk`, `servicenow`, `jira`, `pagerduty` in
  [poc/agents/](../poc/agents/)) are exactly where MCP would sit in a real
  deployment: `splunk (mock)`'s `handle()` function returns a canned string
  today; a real version would use MCP internally to query an actual Splunk
  index, then still expose the same A2A Agent Card so `prod-support` could
  find and call it. Swapping that in changes nothing about discovery or
  delegation — that's the point of the two protocols occupying different
  layers.
- This repo targets **A2A v0.3.x wire shapes** (see
  [docs/02-a2a-protocol.md](02-a2a-protocol.md#two-protocol-revisions)),
  because that's what [scanning 318 reachable public agents](03-discovery.md) showed
  as overwhelmingly deployed (310 of 383 candidates serve the v0.3 card path), even though `1.0.0` is the current released spec
  version. Both well-known paths and both method spellings are supported so
  the code interoperates with either.

Back to the [README](../README.md), or the protocol details in
[docs/02-a2a-protocol.md](02-a2a-protocol.md).
