"""Minimal, dependency-free A2A implementation for Python.

Mirrors ts/a2a/ field for field. The point of the duplication is to show that
A2A interop needs no shared library, no codegen, and no common runtime -- only
agreement on the JSON on the wire.
"""
from .types import (
    PROTOCOL_VERSION,
    TASK_STATES,
    TERMINAL_STATES,
    WELL_KNOWN_PATHS,
    message_text,
    new_id,
    text_part,
)
from .server import create_agent
from .client import A2AClient, A2AError, fetch_agent_card, task_output
from .registry_client import REGISTRY_URL, discover, find_one, register
from .handoff import forward, read_handoff

__all__ = [
    "PROTOCOL_VERSION", "TASK_STATES", "TERMINAL_STATES", "WELL_KNOWN_PATHS",
    "message_text", "new_id", "text_part", "create_agent",
    "A2AClient", "A2AError", "fetch_agent_card", "task_output",
    "REGISTRY_URL", "discover", "find_one", "register", "forward", "read_handoff",
]
