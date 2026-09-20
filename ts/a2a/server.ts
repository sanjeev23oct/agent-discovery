/**
 * A minimal A2A server: serves an Agent Card at the well-known paths and
 * dispatches JSON-RPC calls to skill handlers.
 *
 * Deliberately dependency-free so you can read the whole protocol in one sitting.
 * In production use the official SDK (@a2a-js/sdk) -- see docs/02-a2a-protocol.md.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ERRORS,
  PROTOCOL_VERSION,
  TERMINAL_STATES,
  WELL_KNOWN_PATHS,
  messageText,
  newId,
  textPart,
} from "./types.ts";
import type {
  AgentCard,
  AgentSkill,
  Artifact,
  JsonRpcRequest,
  Message,
  Part,
  Task,
  TaskState,
} from "./types.ts";

export type HandlerContext = {
  message: Message;
  /** Convenience: all text parts of the incoming message, joined. */
  text: string;
  /**
   * What the caller wants done, when it sent one. Kept separate from `text` so
   * an agent never processes the instruction as if it were content.
   */
  instruction?: string;
  task: Task;
  /** Push an interim status update. Streaming subscribers see these live. */
  progress: (note: string) => void;
  log: (...args: unknown[]) => void;
};

export type HandlerResult = {
  parts: Part[];
  state?: TaskState;
  artifactName?: string;
  metadata?: Record<string, unknown>;
};

export type SkillHandler = (ctx: HandlerContext) => Promise<HandlerResult> | HandlerResult;

export type AgentDefinition = {
  name: string;
  description: string;
  version?: string;
  port: number;
  /** Public base URL. Change this when you expose the agent beyond localhost. */
  baseUrl?: string;
  skills: Array<AgentSkill & { handler: SkillHandler }>;
  provider?: { organization: string; url: string };
  documentationUrl?: string;
};

type Subscriber = (event: unknown) => void;

export function createAgent(def: AgentDefinition) {
  const baseUrl = def.baseUrl ?? `http://localhost:${def.port}`;
  const tasks = new Map<string, Task>();
  const subscribers = new Map<string, Set<Subscriber>>();
  const log = (...args: unknown[]) => console.log(`[${def.name}]`, ...args);

  const card: AgentCard = {
    protocolVersion: PROTOCOL_VERSION,
    name: def.name,
    description: def.description,
    url: baseUrl,
    version: def.version ?? "1.0.0",
    preferredTransport: "JSONRPC",
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    provider: def.provider,
    documentationUrl: def.documentationUrl,
    // Strip the handler off each skill -- it is server-side detail, not public API.
    skills: def.skills.map(({ handler, ...skill }) => skill),
  };

  function emit(taskId: string, event: unknown) {
    for (const send of subscribers.get(taskId) ?? []) send(event);
  }

  function setStatus(task: Task, state: TaskState, note?: string) {
    task.status = {
      state,
      timestamp: new Date().toISOString(),
      message: note
        ? { kind: "message", role: "agent", messageId: newId("msg"), parts: [textPart(note)] }
        : undefined,
    };
    emit(task.id, { kind: "status-update", taskId: task.id, status: task.status, final: TERMINAL_STATES.includes(state) });
  }

  /**
   * Pick which skill handles a message. Explicit `metadata.skill` wins; otherwise
   * we score each skill by how many of its tags appear in the message text. A real
   * agent would put an LLM here -- see docs/04-swarm-patterns.md.
   */
  function routeSkill(message: Message) {
    const requested = message.metadata?.skill;
    if (typeof requested === "string") {
      const found = def.skills.find((s) => s.id === requested);
      if (found) return found;
    }
    const haystack = messageText(message).toLowerCase();
    let best = def.skills[0];
    let bestScore = -1;
    for (const skill of def.skills) {
      const score = skill.tags.filter((t) => haystack.includes(t.toLowerCase())).length;
      if (score > bestScore) {
        best = skill;
        bestScore = score;
      }
    }
    return best;
  }

  async function runTask(message: Message): Promise<Task> {
    const skill = routeSkill(message);
    const task: Task = {
      kind: "task",
      id: message.taskId ?? newId("task"),
      contextId: message.contextId ?? newId("ctx"),
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [message],
      artifacts: [],
      metadata: { skill: skill.id, agent: def.name },
    };
    tasks.set(task.id, task);
    log(`task ${task.id} -> skill "${skill.id}" (ctx ${task.contextId})`);
    setStatus(task, "working");

    const ctx: HandlerContext = {
      message,
      text: messageText(message),
      instruction: typeof message.metadata?.instruction === "string" ? message.metadata.instruction : undefined,
      task,
      progress: (note) => {
        log(`  ${task.id}: ${note}`);
        setStatus(task, "working", note);
      },
      log,
    };

    try {
      const result = await skill.handler(ctx);
      const artifact: Artifact = {
        artifactId: newId("artifact"),
        name: result.artifactName ?? skill.id,
        parts: result.parts,
        metadata: result.metadata,
      };
      task.artifacts = [artifact];
      emit(task.id, { kind: "artifact-update", taskId: task.id, artifact, lastChunk: true });
      setStatus(task, result.state ?? "completed");
    } catch (err) {
      log(`task ${task.id} failed:`, err);
      setStatus(task, "failed", err instanceof Error ? err.message : String(err));
    }
    return task;
  }

  async function dispatch(req: JsonRpcRequest) {
    // Accept both the v0.3 method names and the v1.0 renames, so this agent
    // interoperates with clients written against either revision.
    const method = req.method;
    const params = (req.params ?? {}) as Record<string, any>;

    switch (method) {
      case "message/send":
      case "SendMessage": {
        const message = params.message as Message | undefined;
        if (!message?.parts) return { error: ERRORS.invalidParams };
        return { result: await runTask(message) };
      }
      case "tasks/get":
      case "GetTask": {
        const task = tasks.get(params.id);
        return task ? { result: task } : { error: ERRORS.taskNotFound };
      }
      case "tasks/list":
      case "ListTasks":
        return { result: { tasks: [...tasks.values()] } };
      case "tasks/cancel":
      case "CancelTask": {
        const task = tasks.get(params.id);
        if (!task) return { error: ERRORS.taskNotFound };
        if (TERMINAL_STATES.includes(task.status.state)) return { error: ERRORS.taskNotCancelable };
        setStatus(task, "canceled");
        return { result: task };
      }
      default:
        return { error: ERRORS.methodNotFound };
    }
  }

  function json(res: ServerResponse, status: number, body: unknown) {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "access-control-allow-origin": "*",
    });
    res.end(payload);
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  /** message/stream: same work as message/send, but statuses arrive as SSE. */
  async function handleStream(res: ServerResponse, message: Message) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const taskId = message.taskId ?? newId("task");
    message.taskId = taskId;
    const send: Subscriber = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const set = subscribers.get(taskId) ?? new Set();
    set.add(send);
    subscribers.set(taskId, set);
    const task = await runTask(message);
    send({ kind: "task", task });
    set.delete(send);
    res.end();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      return res.end();
    }

    if (req.method === "GET" && WELL_KNOWN_PATHS.includes(url.pathname)) {
      return json(res, 200, card);
    }

    // A human-readable landing page, so `open http://localhost:PORT` is useful.
    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        agent: card.name,
        card: `${baseUrl}${WELL_KNOWN_PATHS[0]}`,
        skills: card.skills.map((s) => s.id),
        rpc: `POST ${baseUrl}/ with a JSON-RPC 2.0 body`,
      });
    }

    if (req.method === "POST") {
      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { jsonrpc: "2.0", id: null, error: ERRORS.parseError });
      }
      if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
        return json(res, 400, { jsonrpc: "2.0", id: parsed.id ?? null, error: ERRORS.invalidRequest });
      }
      if (parsed.method === "message/stream" || parsed.method === "SendStreamingMessage") {
        const message = (parsed.params as any)?.message as Message;
        if (!message?.parts) return json(res, 400, { jsonrpc: "2.0", id: parsed.id, error: ERRORS.invalidParams });
        return handleStream(res, message);
      }
      const outcome = await dispatch(parsed);
      return json(res, 200, { jsonrpc: "2.0", id: parsed.id, ...outcome });
    }

    json(res, 404, { error: "not found" });
  });

  return {
    card,
    tasks,
    listen: () =>
      new Promise<void>((resolve) =>
        server.listen(def.port, () => {
          log(`listening on ${baseUrl}`);
          log(`card at ${baseUrl}${WELL_KNOWN_PATHS[0]}`);
          resolve();
        }),
      ),
    close: () => server.close(),
  };
}
