/**
 * Bob -- port 5002. Knows arithmetic. Knows nothing about Alice.
 *
 * He never calls anyone. He just publishes what he can do and waits.
 */
import { serve } from "./mini.ts";

serve({
  name: "bob",
  description: "Evaluates arithmetic expressions.",
  port: 5002,
  skills: [
    {
      id: "math.evaluate",
      description: "Evaluate a simple arithmetic expression like 12 * 34.",
      tags: ["math", "calculate", "arithmetic"],
    },
  ],
  handle: (text) => {
    // Pull the arithmetic out of whatever sentence arrived.
    const expr = (text.match(/[-+*/(). \d]{3,}/g) ?? []).sort((a, b) => b.length - a.length)[0]?.trim();
    if (!expr) return "I could not find an arithmetic expression in that.";
    try {
      // Digits and operators only -- never eval arbitrary input from the network.
      if (!/^[-+*/(). \d]+$/.test(expr)) throw new Error("unsafe");
      const value = Function(`"use strict"; return (${expr})`)();
      return `${expr} = ${value}`;
    } catch {
      return `I could not evaluate "${expr}".`;
    }
  },
});
