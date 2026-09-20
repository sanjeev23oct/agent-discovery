/**
 * Carol -- port 5003. Not part of the two-agent POC.
 *
 * She exists to prove Alice's discovery is real rather than hardcoded. Her
 * skill has a completely different id from Bob's (`arithmetic.compute`, not
 * `math.evaluate`) and she answers in a different style. The one thing she
 * shares with Bob is the tag "math".
 *
 *   PEER=http://localhost:5003 node poc/alice.ts
 *
 * Alice works with her immediately, with no change to alice.ts.
 */
import { serve } from "./mini.ts";

serve({
  name: "carol",
  description: "A different agent that also happens to do sums.",
  port: 5003,
  skills: [
    { id: "arithmetic.compute", description: "Compute an arithmetic expression.", tags: ["math", "sums"] },
  ],
  handle: (text) => {
    const expr = (text.match(/[-+*/(). \d]{3,}/g) ?? []).sort((a, b) => b.length - a.length)[0]?.trim();
    if (!expr || !/^[-+*/(). \d]+$/.test(expr)) return "No expression found.";
    return `Carol computes ${expr} to be ${Function(`"use strict"; return (${expr})`)()}.`;
  },
});
