/**
 * Demo 4 -- Consume a real public agent.
 *
 * Everything else in this repo talks to agents we wrote. This talks to
 * strangers' agents on the internet, using the same client, written only from
 * the spec. If A2A works, this should need no special-casing per agent.
 *
 * It does need some. See the notes this prints -- that is the interesting part.
 *
 * Usage:
 *   node ts/demos/call-public.ts                       # a small curated set
 *   node ts/demos/call-public.ts https://host/a2a skill-id "your message"
 */
import { A2AClient, fetchAgentCard, taskOutput } from "../a2a/client.ts";

type Target = [baseUrl: string, skill: string, message: string];

const DEFAULTS: Target[] = [
  ["https://ai.jakegaylor.com/a2a", "about-jake", "Briefly, what can you do?"],
  ["https://agents.kimetsu.dev/a2a/sidequest", "discover_sidequests", "What open source sidequests are available?"],
  ["https://a2apark.com/a2a", "list-rides", "List available rides."],
  ["https://agents.algovoi.co.uk/a2a", "verify-rfc9421", "What does this service verify?"],
  ["https://a2a-browser.digiant.nz", "browser/search", "What can you do?"],
];

const argv = process.argv.slice(2);
const targets: Target[] = argv.length >= 2 ? [[argv[0], argv[1], argv[2] ?? "Hello"]] : DEFAULTS;

let ok = 0;
for (const [base, skill, text] of targets) {
  console.log(`\n═══ ${new URL(base).host} ═══`);
  try {
    const card = await fetchAgentCard(base);
    console.log(`  card     : "${card.name}"  A2A ${card.protocolVersion}  transport=${card.preferredTransport ?? "?"}`);
    console.log(`  endpoint : ${card.url}`);

    const started = Date.now();
    const result: any = await new A2AClient(card).send(text, { skill, timeoutMs: 25000 });
    const ms = Date.now() - started;

    // A spec-compliant server returns a Task. Several return a bare Message
    // instead, so read both rather than assuming.
    const kind = result?.kind ?? "(none)";
    const state = result?.status?.state ?? "n/a";
    let out = taskOutput(result);
    if (!out && Array.isArray(result?.parts)) {
      out = result.parts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n");
    }
    console.log(`  response : kind=${kind} state=${state} in ${ms}ms`);
    console.log(`  output   : ${out ? out.slice(0, 300).replace(/\s+/g, " ") : "(no text parts)"}`);
    ok++;
  } catch (err) {
    console.log(`  FAILED   : ${err instanceof Error ? err.message.slice(0, 200) : err}`);
  }
}
console.log(`\n${ok}/${targets.length} responded.\n`);
