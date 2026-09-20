/**
 * Planning: the one place in this swarm where a language model clearly earns its cost.
 *
 * `planWithRules` matches substrings. It fails the moment someone writes "put it
 * in the language they speak in Paris" instead of "French".
 *
 * `planWithClaude` asks a model to choose from the capabilities the registry
 * reports as *actually online right now*. The schema's enum is built from that
 * live list, so structured outputs make it impossible for the model to plan a
 * step no agent can serve -- the classic failure of LLM planners.
 *
 * The SDK is an optional dependency. With no @anthropic-ai/sdk installed and no
 * credentials, the orchestrator silently uses the rule-based planner and the
 * repo keeps its zero-install property.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discover } from "../a2a/registry-client.ts";

const run = promisify(execFile);

export type Step = { capability: string; instruction: string };
export type PlannerKind = "claude-api" | "claude-code" | "rules";
export type Plan = { steps: Step[]; reasoning: string; planner: PlannerKind };

const MODEL = process.env.PLANNER_MODEL ?? "claude-opus-5";

/** What the swarm can currently do, straight from the registry. */
export async function capabilityCatalog() {
  const agents = await discover({});
  const capabilities = new Map<string, { description: string; agents: string[] }>();
  for (const entry of agents) {
    if (entry.agent.name === "orchestrator") continue; // don't plan to call ourselves
    for (const skill of entry.agent.skills) {
      for (const tag of skill.tags) {
        const existing = capabilities.get(tag);
        if (existing) existing.agents.push(entry.agent.name);
        else capabilities.set(tag, { description: skill.description, agents: [entry.agent.name] });
      }
    }
  }
  return capabilities;
}

/** Rule-based fallback: legible, deterministic, and brittle by construction. */
export function planWithRules(request: string): Plan {
  const lower = request.toLowerCase();
  const steps: Step[] = [{ capability: "research", instruction: request }];
  if (lower.includes("summar") || lower.includes("brief") || lower.includes("short")) {
    steps.push({ capability: "summarize", instruction: "Summarise the findings." });
  }
  if (lower.includes("translat") || lower.includes("french") || lower.includes("spanish")) {
    steps.push({ capability: "translate", instruction: "Translate the text." });
  }
  if (lower.includes("brief") || lower.includes("publish") || lower.includes("report")) {
    steps.push({ capability: "notify", instruction: "Publish this as a briefing." });
  }
  return { steps, reasoning: "matched keywords in the request", planner: "rules" };
}

const SYSTEM_PROMPT =
  "You plan work for a swarm of independent agents. You are given the capabilities " +
  "that are online right now. Choose the minimum ordered sequence of capabilities " +
  "that satisfies the request, and write a short instruction for each step. " +
  "Order matters: later steps receive the output of earlier ones, so gather " +
  "information before condensing it, and condense before formatting or delivering. " +
  "Use a capability only if the request genuinely needs it.";

function menuFor(catalog: Awaited<ReturnType<typeof capabilityCatalog>>) {
  return [...catalog.entries()]
    .map(([tag, v]) => `- ${tag}: ${v.description} (provided by: ${v.agents.join(", ")})`)
    .join("\n");
}

/** True when the Claude Code CLI is installed and logged in. */
async function claudeCodeAvailable(): Promise<boolean> {
  try {
    await run("claude", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Plan using the Claude Code CLI in headless mode.
 *
 * This runs on the user's existing Claude Code subscription -- no API key, and
 * no reaching into their credential store. We shell out to `claude -p` and let
 * it authenticate however it already does.
 *
 * The tradeoff against the API path: there is no `output_config.format` here,
 * so the model is not *constrained* to the live capability list -- it is only
 * asked for it. We therefore validate the plan against the registry ourselves
 * and drop any step no running agent can serve.
 */
async function planWithClaudeCode(request: string, log: (...a: unknown[]) => void): Promise<Plan> {
  const catalog = await capabilityCatalog();
  const tags = [...catalog.keys()].sort();
  if (tags.length === 0) throw new Error("registry reports no capabilities to plan with");

  const prompt = [
    `Capabilities online right now:\n${menuFor(catalog)}`,
    ``,
    `Request: ${request}`,
    ``,
    `Reply with ONLY a JSON object, no prose and no code fences:`,
    `{"reasoning": "<one sentence>", "steps": [{"capability": "<one of: ${tags.join(", ")}>", "instruction": "<short>"}]}`,
  ].join("\n");

  log(`asking the Claude Code CLI to plan over ${tags.length} live capabilities`);

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--system-prompt", SYSTEM_PROMPT,
    // Keep the planner cheap: no tools, no Claude Code's own dynamic preamble.
    "--exclude-dynamic-system-prompt-sections",
    "--allowed-tools", "",
  ];
  if (process.env.PLANNER_MODEL) args.push("--model", process.env.PLANNER_MODEL);

  const { stdout } = await run("claude", args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  const envelope = JSON.parse(stdout);
  if (envelope.is_error) throw new Error(envelope.result ?? "claude CLI reported an error");

  // Strip a ```json fence if the model added one anyway.
  const raw = String(envelope.result ?? "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as { reasoning: string; steps: Step[] };

  // Client-side validation stands in for the schema enum the API path gets.
  const valid = (parsed.steps ?? []).filter((step) => {
    const known = tags.includes(step.capability);
    if (!known) log(`dropping planned step "${step.capability}": no agent provides it`);
    return known;
  });
  if (valid.length === 0) throw new Error("plan contained no capability this swarm provides");

  const cost = typeof envelope.total_cost_usd === "number" ? ` $${envelope.total_cost_usd.toFixed(4)}` : "";
  log(`plan: ${valid.map((s) => s.capability).join(" -> ")} (${envelope.duration_api_ms}ms${cost})`);
  return { steps: valid, reasoning: parsed.reasoning, planner: "claude-code" };
}

/** True when the optional SDK is installed AND some credential is resolvable. */
async function claudeAvailable(): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return false;
  try {
    await import("@anthropic-ai/sdk");
    return true;
  } catch {
    return false;
  }
}

async function planWithClaude(request: string, log: (...a: unknown[]) => void): Promise<Plan> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY / auth token from env

  const catalog = await capabilityCatalog();
  const tags = [...catalog.keys()].sort();
  if (tags.length === 0) throw new Error("registry reports no capabilities to plan with");

  const menu = [...catalog.entries()]
    .map(([tag, v]) => `- ${tag}: ${v.description} (provided by: ${v.agents.join(", ")})`)
    .join("\n");

  log(`asking ${MODEL} to plan over ${tags.length} live capabilities`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      "You plan work for a swarm of independent agents. You are given the capabilities " +
      "that are online right now. Choose the minimum ordered sequence of capabilities " +
      "that satisfies the request, and write a short instruction for each step. " +
      "Order matters: later steps receive the output of earlier ones, so gather " +
      "information before condensing it, and condense before formatting or delivering. " +
      "Use a capability only if the request genuinely needs it.",
    messages: [
      {
        role: "user",
        content: `Capabilities online right now:\n${menu}\n\nRequest: ${request}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            reasoning: { type: "string", description: "One sentence on why this sequence." },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  // The enum is the live capability list, so a step that no
                  // running agent can serve is not representable.
                  capability: { type: "string", enum: tags },
                  instruction: { type: "string" },
                },
                required: ["capability", "instruction"],
                additionalProperties: false,
              },
            },
          },
          required: ["reasoning", "steps"],
          additionalProperties: false,
        },
      },
    },
  });

  // A refusal returns HTTP 200 with no schema-conforming content -- check before parsing.
  if (response.stop_reason === "refusal") {
    throw new Error(`planner refused: ${response.stop_details?.explanation ?? "no explanation"}`);
  }

  const text = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as { reasoning: string; steps: Step[] };

  log(`plan: ${parsed.steps.map((s) => s.capability).join(" -> ")}  (${response.usage.input_tokens}in/${response.usage.output_tokens}out tokens)`);
  return { steps: parsed.steps, reasoning: parsed.reasoning, planner: "claude-api" };
}

/**
 * Plan with Claude when it is available, otherwise with rules.
 * A planner failure is never fatal: a degraded plan beats no answer.
 */
export async function plan(request: string, log: (...a: unknown[]) => void): Promise<Plan> {
  // Preference order: an explicit API key, then the user's Claude Code
  // subscription, then rules. Each step down is logged, never silent.
  if (await claudeAvailable()) {
    try {
      return await planWithClaude(request, log);
    } catch (err) {
      log(`Claude API planner failed (${errText(err)}) -- trying the Claude Code CLI`);
    }
  }

  if (process.env.PLANNER !== "rules" && (await claudeCodeAvailable())) {
    try {
      return await planWithClaudeCode(request, log);
    } catch (err) {
      log(`Claude Code planner failed (${errText(err)}) -- falling back to rules`);
    }
  }

  log("no model planner available -- using the rule-based planner");
  return planWithRules(request);
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
