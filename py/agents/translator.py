#!/usr/bin/env python3
"""Translator (Python) -- another specialist, discoverable by tag.

The translation itself is a toy dictionary. What matters for the demo is that
neither the orchestrator nor the upstream agent has this agent's address
hardcoded: they find it by asking the registry for the "translate" tag.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from a2a import create_agent, forward, register, text_part  # noqa: E402

PORT = int(os.environ.get("PORT", 4202))
# Public address other agents will use. Must not be localhost once exposed.
BASE_URL = os.environ.get("BASE_URL")

# A real agent calls a translation API or an LLM here.
GLOSSARY = {
    "the": "le", "a": "un", "and": "et", "is": "est", "are": "sont",
    "agent": "agent", "agents": "agents", "protocol": "protocole",
    "summary": "résumé", "findings": "conclusions", "open": "ouvert",
    "for": "pour", "with": "avec", "not": "ne pas", "one": "un",
    "many": "beaucoup", "work": "travail", "tool": "outil", "tools": "outils",
    "data": "données", "swarm": "essaim", "can": "peut", "be": "être",
}


def translate(text):
    def swap(match):
        word = match.group(0)
        # Leave acronyms alone. Without this, the "A" inside "A2A" matches as a
        # standalone word and the protocol's own name comes out as "Un2Un".
        if word.isupper():
            return word
        hit = GLOSSARY.get(word.lower())
        if not hit:
            return word
        return hit.capitalize() if word[0].isupper() else hit

    # \b keeps us on word boundaries; the isupper() guard covers acronyms.
    return re.sub(r"\b[A-Za-z]+\b", swap, text)


def handle_translate(ctx):
    ctx["progress"]("translating to French")
    output = "Traduction (fr):\n" + translate(ctx["text"])

    downstream = forward(
        message=ctx["message"],
        self_name="translator",
        output=output,
        context_id=ctx["task"]["contextId"],
        log=ctx["log"],
    )

    return {
        "parts": [text_part(downstream if downstream is not None else output)],
        "artifactName": "translation",
        "metadata": {"handedOff": downstream is not None, "targetLanguage": "fr"},
    }


agent = create_agent(
    name="translator",
    description="Translates English text to French.",
    port=PORT,
    base_url=BASE_URL,
    provider={"organization": "agent-discovery demo", "url": "http://localhost:4000"},
    skills=[{
        "id": "text.translate",
        "name": "Translate to French",
        "description": "Translate English text into French.",
        "tags": ["translate", "translation", "french", "language"],
        "examples": ["Translate this to French"],
        "handler": handle_translate,
    }],
)

if __name__ == "__main__":
    import threading
    threading.Thread(target=register, args=(agent.base_url,), daemon=True).start()
    agent.serve_forever()
