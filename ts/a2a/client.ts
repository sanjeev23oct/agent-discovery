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

/**
 * Fill in `url` / `protocolVersion` when a real v1.0 card omits them at the
 * top level and puts them inside `supportedInterfaces` instead.
 *
 * A card like CarGene's (a genuine, currently-live A2A v1.0 agent) has no
 * top-level `url` at all -- the RPC endpoint lives at
 * `supportedInterfaces[0].url`, with that interface's own `protocolVersion`
 * and `protocolBinding` next to it (a card can offer several transports).
 * Everything else here assumes `card.url` / `card.protocolVersion` exist, so
 * this is the one place that difference gets absorbed.
 */
function normaliseCard(card: AgentCard): AgentCard {
  if (card.url) return card;
  const interfaces = (card as any).supportedInterfaces as Array<{ url: string; protocolVersion?: string; protocolBinding?: string }> | undefined;
  const iface = interfaces?.find((i) => i.protocolBinding === "JSONRPC") ?? interfaces?.[0];
  if (!iface) return card;
  return { ...card, url: iface.url, protocolVersion: card.protocolVersion ?? iface.protocolVersion ?? card.protocolVersion };
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
      const card = normaliseCard((await res.json()) as AgentCard);
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

  private isV1() {
    return String(this.card.protocolVersion ?? "").startsWith("1");
  }

  private async rpc(method: string, params: Record<string, unknown>, timeoutMs = 30000, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(this.card.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT, ...extraHeaders },
      body: JSON.stringify({ jsonrpc: "2.0", id: newId("req"), method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json();
    if (body.error) throw new A2AError(body.error.code, `${this.card.name}: ${body.error.message}`);
    return body.result;
  }

  /**
   * Send text, get back a completed (or failed) Task -- or, against a real
   * v1.0 agent, a bare Message wrapped in `{ message: ... }`.
   *
   * v1.0's JSON-RPC binding is proto3-JSON: PascalCase methods
   * ("SendMessage"), role as the enum string "ROLE_USER" rather than "user",
   * and Part as a proto `oneof` -- so a text part is `{ text: "..." }`, never
   * `{ kind: "text", text: "..." }`. Some v1.0 servers (CarGene, verified
   * live) also *require* an `A2A-Version` header and reject a request that
   * omits it -- stricter than the "generous in what you accept" servers this
   * repo's own agents implement.
   */
  async send(text: string, opts: SendOptions = {}): Promise<Task | Message> {
    if (this.isV1()) {
      const message: Record<string, unknown> = {
        role: "ROLE_USER",
        messageId: newId("msg"),
        parts: opts.skill ? [{ data: { ...opts.metadata, skill: opts.skill, query: text } }] : [{ text }],
        ...(opts.contextId ? { contextId: opts.contextId } : {}),
      };
      const version = this.card.protocolVersion!;
      return (await this.rpc("SendMessage", { message }, opts.timeoutMs, { "A2A-Version": version })) as Task | Message;
    }

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

  // A genuine v1.0 SendMessage response wraps its payload -- SendMessageResponse
  // is itself a proto oneof, so the real content is `{ message: ... }` or
  // `{ task: ... }`, not `result` directly. Unwrap that first.
  let r: any = result;
  if (r.message && typeof r.message === "object") r = r.message;
  else if (r.task && typeof r.task === "object") r = r.task;

  const partText = (p: any): string => {
    let kind = p?.kind ?? p?.type; // pre-0.3 agents use `type`
    if (!kind) {
      // v1.0's proto3-JSON binding has no discriminator at all -- Part is a
      // proto `oneof`, so JSON just contains whichever key was chosen
      // ("text", "data" or "file"). Verified live against CarGene.
      if ("text" in (p ?? {})) kind = "text";
      else if ("data" in (p ?? {})) kind = "data";
      else if ("file" in (p ?? {})) kind = "file";
    }
    if (kind === "text") return String(p.text ?? "");
    if (kind === "data") return JSON.stringify(p.data ?? p, null, 2);
    if (kind === "file") return `[file: ${p.file?.name ?? p.file?.uri ?? "unnamed"}]`;
    return "";
  };
  const collect = (parts: any[]) => parts.map(partText).filter(Boolean).join("\n");

  // A bare Message response.
  const roleLooksLikeMessage = r.role === "user" || r.role === "agent" || r.role === "ROLE_USER" || r.role === "ROLE_AGENT";
  if (r.kind === "message" || roleLooksLikeMessage || (!r.status && Array.isArray(r.parts))) {
    return collect(r.parts ?? []);
  }
  result = r;

  const task = result as Task;
  const fromArtifacts = (task.artifacts ?? []).flatMap((a) => collect(a.parts ?? [])).filter(Boolean).join("\n");
  if (fromArtifacts) return fromArtifacts;

  // Fall back to whatever the agent said in its final status.
  return collect(task.status?.message?.parts ?? []);
}
