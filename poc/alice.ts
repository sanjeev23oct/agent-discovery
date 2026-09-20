/**
 * Alice -- port 5001. Cannot do arithmetic, and does not need to.
 *
 * When a question looks like maths, she reads Bob's Agent Card, checks his
 * advertised tags, and delegates. The only thing she is told about Bob is
 * where he lives -- everything else she learns from his card at runtime.
 */
import { serve, discover, call, trace } from "./mini.ts";

const PEER = process.env.PEER ?? "http://localhost:5002";

serve({
  name: "alice",
  description: "Answers questions, delegating anything mathematical to a peer.",
  port: 5001,
  skills: [
    { id: "ask.anything", description: "Ask a question; maths is delegated to a peer.", tags: ["ask", "question"] },
  ],
  handle: async (text) => {
    const looksLikeMaths = /[\d]+\s*[-+*/]\s*[\d]+/.test(text) || /\b(calculate|what is|multiply|plus|times)\b/i.test(text);
    if (!looksLikeMaths) return `I can only help with maths right now. You said: "${text}"`;

    // ---- discovery ----
    console.log(`[alice] I can't do maths. Looking for a peer at ${PEER}...`);
    const peerCard = await discover(PEER, "alice");
    console.log(`[alice] found "${peerCard.name}" -- ${peerCard.description}`);
    console.log(`[alice] its skills: ${peerCard.skills.map((s) => `${s.id} [${s.tags.join(", ")}]`).join(" | ")}`);

    // ---- capability matching: pick a skill by tag, not by name ----
    const skill = peerCard.skills.find((s) => s.tags.includes("math"));
    if (!skill) {
      trace("alice", "no-match", `no skill of ${peerCard.name} is tagged "math"`);
      return `${peerCard.name} cannot do maths either.`;
    }
    console.log(`[alice] "${skill.id}" is tagged "math" -- delegating`);
    trace("alice", "matched", `"${skill.id}" is tagged "math" -- I never named this skill in my code`, { skillId: skill.id });

    // ---- delegation ----
    const answer = await call(peerCard, text, skill.id, "alice");
    return `I asked ${peerCard.name} (${skill.id}) and it said: ${answer}`;
  },
});
