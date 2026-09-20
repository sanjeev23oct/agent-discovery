/**
 * A2A wire types.
 *
 * These mirror the Agent2Agent specification. We implement the JSON-RPC 2.0
 * binding, which is the most widely deployed one. Field names here are the
 * spec's field names verbatim -- do not "tidy" them into camelCase variants of
 * your own, or you stop being interoperable.
 *
 * Spec: https://a2a-protocol.org/v0.3.0/specification/
 */

/** Where an agent publishes its card. See docs/03-discovery.md for why there are two. */
export const WELL_KNOWN_PATHS = [
  "/.well-known/agent-card.json", // v0.3.x, what almost everything deployed today uses
  "/.well-known/a2a-agent-card",  // v1.0 registered well-known URI
];

export const PROTOCOL_VERSION = "0.3.0";

/** A single capability an agent advertises. This is the unit of discovery. */
export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  /** Free-form labels. Registries index these, so choose them like you'd choose keywords. */
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
};

export type AgentCapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
};

/** The agent's public identity document, served at the well-known paths. */
export type AgentCard = {
  protocolVersion: string;
  name: string;
  description: string;
  /** Absolute base URL other agents POST JSON-RPC requests to. */
  url: string;
  version: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  preferredTransport?: string;
  provider?: { organization: string; url: string };
  documentationUrl?: string;
  iconUrl?: string;
  /** Not in the spec: our registry stamps liveness info on its copy of the card. */
  _registry?: { cardUrl: string; lastSeen: string; online: boolean };
};

export type TextPart = { kind: "text"; text: string; metadata?: Record<string, unknown> };
export type DataPart = { kind: "data"; data: Record<string, unknown>; metadata?: Record<string, unknown> };
export type Part = TextPart | DataPart;

export type Role = "user" | "agent";

/** One utterance. `contextId` is what threads many messages into one conversation. */
export type Message = {
  kind: "message";
  role: Role;
  parts: Part[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  referenceTaskIds?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * Terminal states end the task; interrupted states mean the caller must do
 * something (answer a question, authenticate) before work resumes.
 */
export const TASK_STATES = {
  submitted: "submitted",
  working: "working",
  inputRequired: "input-required",
  completed: "completed",
  canceled: "canceled",
  failed: "failed",
  rejected: "rejected",
  authRequired: "auth-required",
  unknown: "unknown",
} as const;

export type TaskState = (typeof TASK_STATES)[keyof typeof TASK_STATES];

export const TERMINAL_STATES: TaskState[] = ["completed", "canceled", "failed", "rejected"];

export type TaskStatus = {
  state: TaskState;
  message?: Message;
  timestamp: string;
};

export type Artifact = {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
};

/**
 * The unit of work. A Task is stateful and addressable -- this is the main
 * thing A2A gives you over "just POST some JSON at an HTTP endpoint".
 */
export type Task = {
  kind: "task";
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC reserved codes, plus the A2A-specific range starting at -32001. */
export const ERRORS = {
  parseError: { code: -32700, message: "Parse error" },
  invalidRequest: { code: -32600, message: "Invalid request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  invalidParams: { code: -32602, message: "Invalid params" },
  internalError: { code: -32603, message: "Internal error" },
  taskNotFound: { code: -32001, message: "Task not found" },
  taskNotCancelable: { code: -32002, message: "Task cannot be canceled" },
  unsupportedOperation: { code: -32004, message: "This operation is not supported" },
};

export function textPart(text: string): TextPart {
  return { kind: "text", text };
}

/** Pull all text out of a message, ignoring non-text parts. */
export function messageText(message: Message): string {
  return message.parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text)
    .join("\n");
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
