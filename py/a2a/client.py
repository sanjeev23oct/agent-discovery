"""A2A client for Python agents: fetch a card, then call over JSON-RPC."""
import json
import urllib.error
import urllib.request

from .types import WELL_KNOWN_PATHS, new_id, text_part


# Real public agents sit behind CDNs that block the stdlib default
# ("Python-urllib/3.9") with a 403 before the request ever reaches the agent.
# Identify ourselves properly or interop silently fails on someone else's edge.
USER_AGENT = "agent-discovery/1.0 (+https://github.com/topics/a2a-protocol)"
DEFAULT_HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}


class A2AError(Exception):
    def __init__(self, code, message):
        super(A2AError, self).__init__(message)
        self.code = code


def _post_json(url, body, timeout=30):
    data = json.dumps(body).encode("utf-8")
    headers = dict(DEFAULT_HEADERS)
    headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _get_json(url, timeout=5):
    req = urllib.request.Request(url, headers=dict(DEFAULT_HEADERS))
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def fetch_agent_card(base_url, timeout=4):
    """Try each well-known path so we work against v0.3 and v1.0 agents alike."""
    errors = []
    for path in WELL_KNOWN_PATHS:
        card_url = base_url.rstrip("/") + path
        try:
            card = _get_json(card_url, timeout)
            if card.get("name") and card.get("url"):
                return card
            errors.append("{} -> not an agent card".format(card_url))
        except Exception as err:
            errors.append("{} -> {}".format(card_url, err))
    raise RuntimeError("no agent card at {}\n  {}".format(base_url, "\n  ".join(errors)))


class A2AClient(object):
    def __init__(self, card):
        self.card = card

    @classmethod
    def connect(cls, base_url):
        return cls(fetch_agent_card(base_url))

    def _rpc(self, method, params, timeout=30):
        body = _post_json(self.card["url"], {
            "jsonrpc": "2.0", "id": new_id("req"), "method": method, "params": params,
        }, timeout)
        if "error" in body and body["error"]:
            raise A2AError(body["error"]["code"], "{}: {}".format(self.card["name"], body["error"]["message"]))
        return body.get("result")

    def send(self, text, skill=None, context_id=None, metadata=None, timeout=30):
        """Send text, get back a completed (or failed) Task."""
        meta = dict(metadata or {})
        if skill:
            meta["skill"] = skill
        message = {
            "kind": "message",
            "role": "user",
            "messageId": new_id("msg"),
            "parts": [text_part(text)],
            "metadata": meta,
        }
        if context_id:
            message["contextId"] = context_id
        return self._rpc("message/send", {"message": message}, timeout)

    def get_task(self, task_id):
        return self._rpc("tasks/get", {"id": task_id})

    def cancel_task(self, task_id):
        return self._rpc("tasks/cancel", {"id": task_id})


def _part_text(p):
    kind = p.get("kind") or p.get("type")  # pre-0.3 agents use "type"
    if kind == "text":
        return str(p.get("text") or "")
    if kind == "data":
        return json.dumps(p.get("data", p), indent=2)
    if kind == "file":
        f = p.get("file") or {}
        return "[file: {}]".format(f.get("name") or f.get("uri") or "unnamed")
    return ""


def task_output(result):
    """Read a finished task's output.

    Reading only text parts is the obvious implementation and it is wrong
    against real agents: several public agents answer with a "data" part and no
    text, some put the answer in status.message with no artifacts at all, and
    pre-0.3 agents spell the part discriminator "type". message/send may also
    return a bare Message instead of a Task, so accept either.
    """
    if not result:
        return ""

    def collect(parts):
        return "\n".join(t for t in (_part_text(p) for p in parts or []) if t)

    if result.get("kind") == "message" or (not result.get("status") and result.get("parts")):
        return collect(result.get("parts"))

    from_artifacts = "\n".join(
        t for t in (collect(a.get("parts")) for a in result.get("artifacts") or []) if t
    )
    if from_artifacts:
        return from_artifacts

    return collect(((result.get("status") or {}).get("message") or {}).get("parts"))
