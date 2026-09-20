"""Registry client: how a Python agent announces itself and finds peers.

Note there is nothing Python-specific here. The registry is a plain HTTP
service, and the TypeScript agents use the identical endpoints.
"""
import json
import os
import time
import urllib.parse
import urllib.request

from .client import A2AClient

REGISTRY_URL = os.environ.get("REGISTRY_URL", "http://localhost:4000")


def register(card_url, attempts=10):
    """Announce this agent, retrying since the registry may boot after us."""
    body = json.dumps({"cardUrl": card_url}).encode("utf-8")
    for _ in range(attempts):
        try:
            req = urllib.request.Request(
                REGISTRY_URL + "/register", data=body,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(req, timeout=3) as res:
                if res.status == 200:
                    return True
        except Exception:
            pass  # registry not up yet
        time.sleep(0.5)
    print("[registry-client] could not register {} after {} attempts".format(card_url, attempts), flush=True)
    return False


def discover(skill=None, tag=None, q=None):
    """Find agents by skill id, tag, or free-text query."""
    params = {k: v for k, v in (("skill", skill), ("tag", tag), ("q", q)) if v}
    url = REGISTRY_URL + "/agents?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=5) as res:
        return json.loads(res.read().decode("utf-8"))["results"]


def find_one(skill=None, tag=None, q=None, exclude=None):
    """Discover one agent for a capability and return (client, skill_id)."""
    exclude = exclude or []
    for hit in discover(skill=skill, tag=tag, q=q):
        if hit["agent"]["name"] in exclude:
            continue
        matched = hit.get("matchedSkills") or []
        return A2AClient(hit["agent"]), (matched[0] if matched else skill)
    return None, None
