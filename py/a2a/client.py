"""A2A client for Python agents: fetch a card, then call over JSON-RPC."""
import json
import urllib.error
import urllib.request

from .types import WELL_KNOWN_PATHS, new_id, text_part


class A2AError(Exception):
    def __init__(self, code, message):
        super(A2AError, self).__init__(message)
        self.code = code


def _post_json(url, body, timeout=30):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _get_json(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as res:
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


def task_output(task):
    """Read the text out of a finished task's artifacts."""
    out = []
    for artifact in (task or {}).get("artifacts") or []:
        for part in artifact.get("parts", []):
            if part.get("kind") == "text":
                out.append(part["text"])
    return "\n".join(out)
