# Two-agent POC

The smallest thing that is honestly A2A: **two agents, two ports, discovering and calling each other.** No registry, no orchestrator, no LLM, no dependencies.

```bash
./poc/run.sh
```

```
[alice] listening on http://localhost:5001
[bob]   listening on http://localhost:5002

[alice] <- "What is 12 * 34 + 7?" (skill: ask.anything)
[alice] I can't do maths. Looking for a peer at http://localhost:5002...
[alice] found "bob" -- Evaluates arithmetic expressions.
[alice] its skills: math.evaluate [math, calculate, arithmetic]
[alice] "math.evaluate" is tagged "math" -- delegating
[bob]   <- "What is 12 * 34 + 7?" (skill: math.evaluate)
[bob]   -> "12 * 34 + 7 = 415"

state:  completed
answer: I asked bob (math.evaluate) and it said: 12 * 34 + 7 = 415
```

## The three files

| File | Lines | What it is |
|---|---|---|
| [mini.ts](mini.ts) | 100 | The whole protocol: serve a card, answer `message/send`, fetch a card, call an agent |
| [bob.ts](bob.ts) | 32 | Does arithmetic. Publishes a card. Never calls anyone. |
| [alice.ts](alice.ts) | 38 | Cannot do arithmetic. Reads Bob's card and delegates. |

Read `mini.ts` once and the other two are trivial.

## What actually happens

1. **Both publish a card** at `/.well-known/agent-card.json`. Nothing else is needed to be discoverable — try `curl localhost:5002/.well-known/agent-card.json`.
2. **Alice discovers Bob at runtime.** She is told one thing: a URL. Everything else — his name, his description, what he can do — she reads from his card when she needs it.
3. **She matches on a tag, not a name.** She looks for a skill tagged `math`. She never mentions `math.evaluate` in her code.
4. **She calls him** with one JSON-RPC `message/send` and gets a Task back.

## Proof the discovery is real

`carol.ts` (port 5003) does the same job as Bob under a **different skill id** — `arithmetic.compute`, not `math.evaluate`. The only thing she shares with Bob is the tag `math`.

```bash
node poc/carol.ts &
PEER=http://localhost:5003 node poc/alice.ts &
# ask alice the same question
```

```
[alice] found "carol" -- A different agent that also happens to do sums.
[alice] its skills: arithmetic.compute [math, sums]
[alice] "arithmetic.compute" is tagged "math" -- delegating
answer: I asked carol (arithmetic.compute) and it said: Carol computes 99 * 11 to be 1089.
```

**`alice.ts` did not change.** That is the difference between discovery and configuration.

And when the peer genuinely cannot help, she says so rather than failing. Pointing her at the Python translator from the main swarm:

```
[alice] found "translator" -- Translates English text to French.
[alice] its skills: text.translate [translate, translation, french, language]
answer: translator cannot do maths either.
```

That peer is a Python agent from the main swarm and Alice is TypeScript. Neither knows nor cares.

## What this leaves out

Everything that makes it production-worthy, all of which is in [../ts/a2a/](../ts/a2a/): task storage and `tasks/get`, cancellation, streaming, JSON-RPC error codes, the `input-required` state, both well-known card paths, and tolerance for the real-world quirks in [../docs/03-discovery.md](../docs/03-discovery.md#four-bugs-real-agents-found-in-this-client).

Also missing: a **registry**. With two agents, knowing one URL is fine. The moment you have six, you want to ask "who can do X?" instead of holding a list of addresses — that is [../ts/registry/](../ts/registry/) and [../docs/03-discovery.md](../docs/03-discovery.md).

Next: `./scripts/swarm-up.sh` for the full version.
