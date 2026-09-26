"""A2A client for Python agents: fetch a card, then call over JSON-RPC."""
import json
import urllib.error
import urllib.parse
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


def _post_json(url, body, timeout=30, extra_headers=None):
    data = json.dumps(body).encode("utf-8")
    headers = dict(DEFAULT_HEADERS)
    headers["Content-Type"] = "application/json"
    headers.update(extra_headers or {})
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _get_json(url, timeout=5):
    req = urllib.request.Request(url, headers=dict(DEFAULT_HEADERS))
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _normalise_card(card):
    """
    Fill in card["url"] and card["protocolVersion"] when a real v1.0 card omits
    them at the top level and puts them inside `supportedInterfaces` instead.

    A card like CarGene's (a genuine, currently-live A2A v1.0 agent) has no
    top-level `url` at all -- the RPC endpoint lives at
    `supportedInterfaces[0].url`, with that interface's own `protocolVersion`
    and `protocolBinding` next to it (a card can offer several transports).
    Everything else in this client assumes `card["url"]` / `card["protocolVersion"]`
    exist, so this is the one place that difference gets absorbed rather than
    every call site having to know two card shapes.
    """
    if not card.get("url"):
        interfaces = card.get("supportedInterfaces") or []
        jsonrpc = next((i for i in interfaces if i.get("protocolBinding") == "JSONRPC"), None)
        iface = jsonrpc or (interfaces[0] if interfaces else None)
        if iface:
            card = dict(card)
            card["url"] = iface.get("url")
            card.setdefault("protocolVersion", iface.get("protocolVersion"))
    return card


def fetch_agent_card(base_url, timeout=4):
    """Try each well-known path so we work against v0.3 and v1.0 agents alike.

    Well-known URIs are always resolved against the *origin* -- scheme, host
    and port -- never against whatever path the base URL happens to carry
    (RFC 8615). `agents.algovoi.co.uk/a2a` is a real agent whose RPC endpoint
    lives under `/a2a`, but its card is still at the domain root, not
    `/a2a/.well-known/...`. String-concatenating the base URL and the
    well-known path gets this wrong; resolving through the origin gets it
    right regardless of what path the base URL carries.
    """
    parsed = urllib.parse.urlsplit(base_url)
    origin = "{}://{}".format(parsed.scheme, parsed.netloc)
    errors = []
    for path in WELL_KNOWN_PATHS:
        card_url = origin + path
        try:
            card = _normalise_card(_get_json(card_url, timeout))
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

    def _is_v1(self):
        return str(self.card.get("protocolVersion") or "").startswith("1")

    def _rpc(self, method, params, timeout=30, extra_headers=None):
        body = _post_json(self.card["url"], {
            "jsonrpc": "2.0", "id": new_id("req"), "method": method, "params": params,
        }, timeout, extra_headers)
        if "error" in body and body["error"]:
            raise A2AError(body["error"]["code"], "{}: {}".format(self.card["name"], body["error"]["message"]))
        return body.get("result")

    def send(self, text, skill=None, context_id=None, metadata=None, timeout=30):
        """
        Send text, get back a completed (or failed) Task -- or, against a real
        v1.0 agent, a bare Message wrapped in {"message": ...}.

        v1.0's JSON-RPC binding is proto3-JSON, not the free-form JSON of
        v0.3: the method name is PascalCase ("SendMessage"), role is the enum
        string "ROLE_USER" rather than "user", and Part is a proto `oneof` --
        JSON represents that as the chosen field appearing directly (a text
        part is `{"text": "..."}`, never `{"kind": "text", "text": "..."}`).
        Some v1.0 servers (CarGene, verified live) also *require* an
        `A2A-Version` header and reject a request that omits it, treating
        "no header" as an explicit but unsupported "0.3" -- this is stricter
        than the "generous in what you accept" servers this repo's own
        agents implement.
        """
        if self._is_v1():
            message = {
                "role": "ROLE_USER",
                "messageId": new_id("msg"),
                "parts": [{"text": text}] if not skill else [{"data": dict(metadata or {}, skill=skill, query=text)}],
            }
            if context_id:
                message["contextId"] = context_id
            version = self.card.get("protocolVersion")
            return self._rpc("SendMessage", {"message": message}, timeout, extra_headers={"A2A-Version": version})

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
    if not kind:
        # v1.0's proto3-JSON binding has no discriminator field at all: Part
        # is a proto `oneof`, so JSON just contains whichever key was chosen
        # ("text", "data" or "file") with no "kind"/"type" wrapper around it.
        # Verified live against CarGene, a real v1.0 agent.
        if "text" in p:
            kind = "text"
        elif "data" in p:
            kind = "data"
        elif "file" in p:
            kind = "file"
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

    A genuine v1.0 SendMessage response goes one step further: the payload
    isn't `result` itself, it's wrapped -- {"message": {...}} or {"task": {...}}
    -- since SendMessageResponse is itself a proto oneof. Unwrap that first.
    """
    if not result:
        return ""
    if "message" in result and isinstance(result["message"], dict):
        result = result["message"]
    elif "task" in result and isinstance(result["task"], dict):
        result = result["task"]

    def collect(parts):
        return "\n".join(t for t in (_part_text(p) for p in parts or []) if t)

    if result.get("kind") == "message" or result.get("role") in ("user", "agent", "ROLE_USER", "ROLE_AGENT") or (not result.get("status") and result.get("parts")):
        return collect(result.get("parts"))

    from_artifacts = "\n".join(
        t for t in (collect(a.get("parts")) for a in result.get("artifacts") or []) if t
    )
    if from_artifacts:
        return from_artifacts

    return collect(((result.get("status") or {}).get("message") or {}).get("parts"))
