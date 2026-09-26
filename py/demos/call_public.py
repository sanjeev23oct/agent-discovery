#!/usr/bin/env python3
"""
Demo -- Consume a real public agent, from Python.

The TypeScript equivalent is ts/demos/call-public.ts. This one exists because
of a real script a user pointed at this repo: a hand-rolled stdlib client
that called CarGene (https://car-gene.com), a genuine, currently-live A2A
v1.0 agent -- not just an agent that claims v1.0 in its card while actually
speaking v0.3 like everything else this repo had tested. That script is what
found the gaps this demo now proves are fixed: py/a2a/client.py didn't handle
a card whose endpoint lives in `supportedInterfaces` instead of a top-level
`url`, didn't speak v1.0's proto3-JSON wire shape (PascalCase methods,
`ROLE_USER`, part-as-oneof with no "kind" field), and didn't know CarGene's
server strictly requires an `A2A-Version` header -- omitting it isn't
ignored, it's rejected with a clear error. See docs/03-discovery.md.

Usage:
    python3 py/demos/call_public.py                      # a small curated set
    python3 py/demos/call_public.py https://host skill "message"
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from a2a.client import A2AClient, fetch_agent_card, task_output  # noqa: E402

DEFAULTS = [
    # A genuine A2A v1.0 agent, verified live: PascalCase methods, ROLE_USER,
    # no part-kind discriminator, and a strictly-enforced A2A-Version header.
    ("https://car-gene.com", "search_vehicles", "AE86"),
    ("https://agents.algovoi.co.uk/a2a", "verify-rfc9421", "What does this service verify?"),
]

argv = sys.argv[1:]
targets = [(argv[0], argv[1], argv[2] if len(argv) > 2 else "Hello")] if len(argv) >= 2 else DEFAULTS

ok = 0
for base, skill, text in targets:
    host = base.split("//", 1)[-1].split("/", 1)[0]
    print("\n=== {} ===".format(host))
    try:
        card = fetch_agent_card(base)
        print("  card     : \"{}\"  A2A {}".format(card.get("name"), card.get("protocolVersion")))
        print("  endpoint : {}".format(card.get("url")))

        client = A2AClient(card)
        result = client.send(text, skill=skill)
        out = task_output(result)
        print("  output   : {}".format(out[:280].replace("\n", " ") if out else "(no text parts)"))
        if out:
            ok += 1
    except Exception as err:
        print("  FAILED   : {}".format(str(err)[:200]))

print("\n{}/{} responded.\n".format(ok, len(targets)))
