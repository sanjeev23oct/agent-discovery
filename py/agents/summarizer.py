#!/usr/bin/env python3
"""Summarizer (Python) -- a specialist in the middle of the chain.

Proves the cross-language point: a TypeScript researcher hands work to this
Python agent, which hands it to a Python translator, which hands it back to a
TypeScript notifier. Nobody negotiated a shared type system.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from a2a import create_agent, forward, register, text_part  # noqa: E402

PORT = int(os.environ.get("PORT", 4201))
# Public address other agents will use. Must not be localhost once exposed.
BASE_URL = os.environ.get("BASE_URL")


def condense(text, max_points=3):
    """Stand-in for a real summariser (an LLM call, in practice).

    Keeps the most substantial lines. Deterministic on purpose: the demo runs
    offline and produces the same output every time.
    """
    lines = [ln.strip(" -•\t") for ln in text.splitlines() if ln.strip()]
    body = [ln for ln in lines if len(ln) > 30] or lines
    ranked = sorted(body, key=len, reverse=True)[:max_points]
    # Restore original order so the summary still reads top to bottom.
    return [ln for ln in body if ln in ranked]


def handle_summarize(ctx):
    ctx["progress"]("condensing {} chars".format(len(ctx["text"])))
    points = condense(ctx["text"])
    output = "\n".join(["Summary:"] + ["- " + p for p in points])

    # Decentralised: ask the registry who is next, not a coordinator.
    downstream = forward(
        message=ctx["message"],
        self_name="summarizer",
        output=output,
        context_id=ctx["task"]["contextId"],
        log=ctx["log"],
    )

    return {
        "parts": [text_part(downstream if downstream is not None else output)],
        "artifactName": "summary",
        "metadata": {"handedOff": downstream is not None, "points": len(points)},
    }


agent = create_agent(
    name="summarizer",
    description="Condenses long text down to its key points.",
    port=PORT,
    base_url=BASE_URL,
    provider={"organization": "agent-discovery demo", "url": "http://localhost:4000"},
    skills=[{
        "id": "text.summarize",
        "name": "Summarise text",
        "description": "Reduce a block of text to its most important points.",
        "tags": ["summarize", "summary", "condense", "shorten"],
        "examples": ["Summarise these findings", "Give me the key points"],
        "handler": handle_summarize,
    }],
)

if __name__ == "__main__":
    import threading
    threading.Thread(target=register, args=(agent.base_url,), daemon=True).start()
    agent.serve_forever()
