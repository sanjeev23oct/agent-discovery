"""A2A wire types and helpers.

Python has no structural typing on the wire, so these are plain dicts built by
helper functions. Field names are the spec's names verbatim.

Spec: https://a2a-protocol.org/v0.3.0/specification/
"""
import random
import string
from datetime import datetime, timezone

# Two paths because the spec renamed it: v0.3.x used the first, v1.0 registered
# the second. Serving and trying both is the cheap way to stay interoperable.
WELL_KNOWN_PATHS = [
    "/.well-known/agent-card.json",
    "/.well-known/a2a-agent-card",
    # Pre-0.3 legacy path. Roughly a fifth of live public agents still serve
    # only this one, so a scanner that skips it under-reports the ecosystem.
    "/.well-known/agent.json",
]

PROTOCOL_VERSION = "0.3.0"

TASK_STATES = {
    "submitted": "submitted",
    "working": "working",
    "input_required": "input-required",
    "completed": "completed",
    "canceled": "canceled",
    "failed": "failed",
    "rejected": "rejected",
    "auth_required": "auth-required",
    "unknown": "unknown",
}

TERMINAL_STATES = ["completed", "canceled", "failed", "rejected"]

# JSON-RPC reserved codes plus the A2A-specific range.
ERRORS = {
    "parse_error": {"code": -32700, "message": "Parse error"},
    "invalid_request": {"code": -32600, "message": "Invalid request"},
    "method_not_found": {"code": -32601, "message": "Method not found"},
    "invalid_params": {"code": -32602, "message": "Invalid params"},
    "internal_error": {"code": -32603, "message": "Internal error"},
    "task_not_found": {"code": -32001, "message": "Task not found"},
    "task_not_cancelable": {"code": -32002, "message": "Task cannot be canceled"},
}


def new_id(prefix):
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
    return "{}-{}".format(prefix, suffix)


def now():
    return datetime.now(timezone.utc).isoformat()


def text_part(text):
    return {"kind": "text", "text": text}


def message_text(message):
    """Join every text part of a message, ignoring other part kinds."""
    return "\n".join(p.get("text", "") for p in message.get("parts", []) if p.get("kind") == "text")
