#!/usr/bin/env node
// Asserts ESLint REPORTS a known planted violation (no-unreachable) in the lint
// canary. A reported error = SUCCESS; a clean result means ESLint is dark
// (no-op glob / disabled rule) → fail CI.
import { ESLint } from "eslint";

const eslint = new ESLint({ ignore: false });
const results = await eslint.lintFiles(["src/__canary__/lint-canary.js"]);

const reported = results.some((r) =>
  (r.messages ?? []).some((m) => m.ruleId === "no-unreachable" && m.severity === 2),
);

if (reported) {
  console.log("[lint:canary] OK — ESLint reported the planted no-unreachable error; lint is live.");
  process.exit(0);
}

console.error(
  "[lint:canary] FAIL — the planted lint error was NOT reported. ESLint is DARK.\n" +
    JSON.stringify(results, null, 2),
);
process.exit(1);
