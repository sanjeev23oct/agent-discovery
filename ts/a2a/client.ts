/**
 * A2A client: fetch a remote agent's card, then call it over JSON-RPC.
 *
 * Everything an agent needs to talk to another agent is in here. Note there is
 * no shared type library between caller and callee, no generated stubs, no
 * registry required -- the card is the contract.
 */
import { WELL_KNOWN_PATHS, newId, textPart } from "./types.ts";
import type { AgentCard, Message, Task } from "./types.ts";

/** Identify ourselves: CDNs in front of real agents block anonymous clients. */
export const USER_AGENT = "agent-discovery/1.0 (+https://github.com/topics/a2a-protocol)";

export class A2AError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "A2AError";
  }
}

/** Try each well-known path in turn, so we work against v0.3 and v1.0 agents. */
export async function fetchAgentCard(baseUrl: string, timeoutMs = 4000): Promise<AgentCard> {
  const errors: string[] = [];
  for (const path of WELL_KNOWN_PATHS) {
    const cardUrl = new URL(path, baseUrl).toString();
    try {
      const res = await fetch(cardUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      });
      if (!res.ok) {
        errors.push(`${cardUrl} -> HTTP ${res.status}`);
        continue;
      }
      const card = (await res.json()) as AgentCard;
      if (!card.name || !card.url) {
        errors.push(`${cardUrl} -> not an agent card`);
        continue;
      }
      return card;
    } catch (err) {
      errors.push(`${cardUrl} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`no agent card at ${baseUrl}\n  ${errors.join("\n  ")}`);
}

export type SendOptions = {
  /** Ask for a specific skill instead of letting the agent route by tags. */
  skill?: string;
  /** Reuse a contextId to keep several agents working on one conversation. */
  contextId?: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
};

export class A2AClient {
  card: AgentCard;

  constructor(card: AgentCard) {
    this.card = card;
  }

  static async connect(baseUrl: string) {
    return new A2AClient(await fetchAgentCard(baseUrl));
  }

  private async rpc(method: string, params: Record<string, unknown>, timeoutMs = 30000) {
    const res = await fetch(this.card.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ jsonrpc: "2.0", id: newId("req"), method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json();
    if (body.error) throw new A2AError(body.error.code, `${this.card.name}: ${body.error.message}`);
    return body.result;
  }

  /** Send text, get back a completed (or failed) Task. */
  async send(text: string, opts: SendOptions = {}): Promise<Task> {
    const message: Message = {
      kind: "message",
      role: "user",
      messageId: newId("msg"),
      parts: [textPart(text)],
      contextId: opts.contextId,
      metadata: { ...opts.metadata, ...(opts.skill ? { skill: opts.skill } : {}) },
    };
    return (await this.rpc("message/send", { message }, opts.timeoutMs)) as Task;
  }

  async getTask(id: string): Promise<Task> {
    return (await this.rpc("tasks/get", { id })) as Task;
  }

  async cancelTask(id: string): Promise<Task> {
    return (await this.rpc("tasks/cancel", { id })) as Task;
  }

  /** Streaming variant: yields each SSE event as it arrives. */
  async *stream(text: string, opts: SendOptions = {}): AsyncGenerator<any> {
    const message: Message = {
      kind: "message",
      role: "user",
      messageId: newId("msg"),
      parts: [textPart(text)],
      contextId: opts.contextId,
      metadata: { ...opts.metadata, ...(opts.skill ? { skill: opts.skill } : {}) },
    };
    const res = await fetch(this.card.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: newId("req"), method: "message/stream", params: { message } }),
    });
    if (!res.body) throw new Error("no stream body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) yield JSON.parse(line.slice(6));
      }
    }
  }
}

/**
 * Read a finished task's output.
 *
 * Reading only text parts is the obvious implementation and it is wrong against
 * real agents: several public agents answer with a `data` part and no text at
 * all, which made a completed task look empty. Some return no artifacts and put
 * the answer in `status.message`. And pre-0.3 agents spell the discriminator
 * `type` rather than `kind`.
 *
 * `message/send` may also return a bare Message instead of a Task, so this
 * accepts either.
 */
export function taskOutput(result: Task | Message | null | undefined): string {
  if (!result) return "";

  const partText = (p: any): string => {
    const kind = p?.kind ?? p?.type; // pre-0.3 agents use `type`
    if (kind === "text") return String(p.text ?? "");
    if (kind === "data") return JSON.stringify(p.data ?? p, null, 2);
    if (kind === "file") return `[file: ${p.file?.name ?? p.file?.uri ?? "unnamed"}]`;
    return "";
  };
  const collect = (parts: any[]) => parts.map(partText).filter(Boolean).join("\n");

  // A bare Message response.
  if ((result as any).kind === "message" || (!(result as any).status && Array.isArray((result as any).parts))) {
    return collect((result as any).parts ?? []);
  }

  const task = result as Task;
  const fromArtifacts = (task.artifacts ?? []).flatMap((a) => collect(a.parts ?? [])).filter(Boolean).join("\n");
  if (fromArtifacts) return fromArtifacts;

  // Fall back to whatever the agent said in its final status.
  return collect(task.status?.message?.parts ?? []);
}
