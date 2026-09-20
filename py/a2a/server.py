"""A2A server for Python agents: agent card + JSON-RPC dispatch, stdlib only."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .types import (
    ERRORS,
    PROTOCOL_VERSION,
    TERMINAL_STATES,
    WELL_KNOWN_PATHS,
    message_text,
    new_id,
    now,
)


class Agent(object):
    """One A2A agent: a card, a set of skills, and an in-memory task store."""

    def __init__(self, name, description, port, skills, version="1.0.0",
                 base_url=None, provider=None, documentation_url=None):
        self.name = name
        self.port = port
        self.base_url = base_url or "http://localhost:{}".format(port)
        self.skills = skills  # list of dicts, each with a "handler" callable
        self.tasks = {}
        self._lock = threading.Lock()
        self.card = {
            "protocolVersion": PROTOCOL_VERSION,
            "name": name,
            "description": description,
            "url": self.base_url,
            "version": version,
            "preferredTransport": "JSONRPC",
            "capabilities": {"streaming": False, "pushNotifications": False, "stateTransitionHistory": True},
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
            # The handler is server-side detail and never goes in the card.
            "skills": [{k: v for k, v in s.items() if k != "handler"} for s in skills],
        }
        if provider:
            self.card["provider"] = provider
        if documentation_url:
            self.card["documentationUrl"] = documentation_url

    def log(self, *args):
        print("[{}]".format(self.name), *args, flush=True)

    def route_skill(self, message):
        """Explicit metadata.skill wins; otherwise score skills by tag overlap."""
        requested = (message.get("metadata") or {}).get("skill")
        if requested:
            for skill in self.skills:
                if skill["id"] == requested:
                    return skill
        haystack = message_text(message).lower()
        best, best_score = self.skills[0], -1
        for skill in self.skills:
            score = sum(1 for tag in skill.get("tags", []) if tag.lower() in haystack)
            if score > best_score:
                best, best_score = skill, score
        return best

    def set_status(self, task, state, note=None):
        status = {"state": state, "timestamp": now()}
        if note:
            status["message"] = {
                "kind": "message", "role": "agent",
                "messageId": new_id("msg"), "parts": [{"kind": "text", "text": note}],
            }
        task["status"] = status

    def run_task(self, message):
        skill = self.route_skill(message)
        task = {
            "kind": "task",
            "id": message.get("taskId") or new_id("task"),
            "contextId": message.get("contextId") or new_id("ctx"),
            "status": {"state": "submitted", "timestamp": now()},
            "history": [message],
            "artifacts": [],
            "metadata": {"skill": skill["id"], "agent": self.name},
        }
        with self._lock:
            self.tasks[task["id"]] = task
        self.log('task {} -> skill "{}" (ctx {})'.format(task["id"], skill["id"], task["contextId"]))
        self.set_status(task, "working")

        def progress(note):
            self.log("  {}: {}".format(task["id"], note))
            self.set_status(task, "working", note)

        ctx = {
            "message": message,
            "text": message_text(message),
            # What the caller wants done, when it sent one. Kept separate from
            # "text" so an agent never processes the instruction as content.
            "instruction": (message.get("metadata") or {}).get("instruction"),
            "task": task,
            "progress": progress,
            "log": self.log,
            "agent": self,
        }

        try:
            result = skill["handler"](ctx)
            task["artifacts"] = [{
                "artifactId": new_id("artifact"),
                "name": result.get("artifactName", skill["id"]),
                "parts": result["parts"],
                "metadata": result.get("metadata"),
            }]
            self.set_status(task, result.get("state", "completed"))
        except Exception as err:  # a failed task is a normal A2A outcome, not a 500
            self.log("task {} failed: {}".format(task["id"], err))
            self.set_status(task, "failed", str(err))
        return task

    def dispatch(self, method, params):
        """Accept both v0.3 method names and their v1.0 renames."""
        if method in ("message/send", "SendMessage"):
            message = params.get("message")
            if not message or "parts" not in message:
                return {"error": ERRORS["invalid_params"]}
            return {"result": self.run_task(message)}
        if method in ("tasks/get", "GetTask"):
            task = self.tasks.get(params.get("id"))
            return {"result": task} if task else {"error": ERRORS["task_not_found"]}
        if method in ("tasks/list", "ListTasks"):
            return {"result": {"tasks": list(self.tasks.values())}}
        if method in ("tasks/cancel", "CancelTask"):
            task = self.tasks.get(params.get("id"))
            if not task:
                return {"error": ERRORS["task_not_found"]}
            if task["status"]["state"] in TERMINAL_STATES:
                return {"error": ERRORS["task_not_cancelable"]}
            self.set_status(task, "canceled")
            return {"result": task}
        return {"error": ERRORS["method_not_found"]}

    def serve_forever(self):
        agent = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _json(self, status, body):
                payload = json.dumps(body, indent=2).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass  # keep the demo output readable

            def do_OPTIONS(self):
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "content-type")
                self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                path = self.path.split("?")[0]
                if path in WELL_KNOWN_PATHS:
                    return self._json(200, agent.card)
                if path == "/":
                    return self._json(200, {
                        "agent": agent.name,
                        "card": agent.base_url + WELL_KNOWN_PATHS[0],
                        "skills": [s["id"] for s in agent.card["skills"]],
                        "rpc": "POST {}/ with a JSON-RPC 2.0 body".format(agent.base_url),
                    })
                return self._json(404, {"error": "not found"})

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                try:
                    req = json.loads(self.rfile.read(length) or b"{}")
                except ValueError:
                    return self._json(400, {"jsonrpc": "2.0", "id": None, "error": ERRORS["parse_error"]})
                if req.get("jsonrpc") != "2.0" or not isinstance(req.get("method"), str):
                    return self._json(400, {"jsonrpc": "2.0", "id": req.get("id"), "error": ERRORS["invalid_request"]})
                outcome = agent.dispatch(req["method"], req.get("params") or {})
                body = {"jsonrpc": "2.0", "id": req.get("id")}
                body.update(outcome)
                return self._json(200, body)

        server = ThreadingHTTPServer(("0.0.0.0", self.port), Handler)
        self.log("listening on {}".format(self.base_url))
        self.log("card at {}{}".format(self.base_url, WELL_KNOWN_PATHS[0]))
        server.serve_forever()


def create_agent(**kwargs):
    return Agent(**kwargs)
