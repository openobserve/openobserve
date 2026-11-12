import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_USER_PROMPT_CHARS, fitCoordinatorPrompt } from "../src/coordinator-input.mjs";
import { mergePassResults } from "../src/passes.mjs";
import { buildFallbackReview, selectFallbackFindings } from "../src/report.mjs";

const AGENTS = ["Security", "Performance", "Correctness", "Code Quality", "Documentation", "Release", "Frontend", "QA"];

function passResults({ perReviewer, descriptionChars, passes = 2 }) {
  const results = [];
  for (let pass = 1; pass <= passes; pass += 1) {
    for (const [a, agentName] of AGENTS.entries()) {
      const findings = Array.from({ length: perReviewer }, (_, i) => ({
        category: "correctness",
        severity: "p2",
        file: `src/area${a}/file${i}.rs`,
        line: String(10 + i),
        summary: `pass ${pass} ${agentName} finding ${i}`,
        description: `${"d".repeat(descriptionChars)} pass${pass}-${a}-${i}`,
        suggestion: `fix ${pass}-${a}-${i}`,
      }));
      results.push({ agentKey: `a${a}`, agentName, pass, findings, rawText: "", error: null, parsed: true, genAIResponseId: "" });
    }
  }
  const last = results.at(-1).findings.at(-1);
  Object.assign(last, { severity: "p0", summary: "LAST PASS BLOCKER drops every row", file: "src/qa/last.rs", line: "99" });
  return results;
}

const build = findingsXml => `<coordinator_task>\n<all_findings>${findingsXml}</all_findings>\n</coordinator_task>`;

test("an oversized two-pass set is compacted so the last pass's blocker still reaches the coordinator", () => {
  const results = passResults({ perReviewer: 8, descriptionChars: 945 });
  const fit = fitCoordinatorPrompt(results, 2, build);
  assert.equal(fit.mode, "compacted");
  assert.ok(fit.prompt.length <= MAX_USER_PROMPT_CHARS, `prompt ${fit.prompt.length} over the limit`);
  assert.ok(fit.prompt.includes("LAST PASS BLOCKER drops every row"));
  assert.ok(fit.prompt.includes("<severity>p0</severity>"));
  assert.ok(fit.prompt.includes("fix 2-7-7"), "suggestions are kept whole");
  assert.equal((fit.prompt.match(/<finding>/g) ?? []).length, 8 * 8 * 2, "no finding is dropped");
});

test("a set that fits is sent unchanged", () => {
  const results = passResults({ perReviewer: 2, descriptionChars: 100 });
  const fit = fitCoordinatorPrompt(results, 2, build);
  assert.equal(fit.mode, "full");
  assert.ok(fit.prompt.includes(`${"d".repeat(100)} pass2-7-1`));
});

test("a set too large even compacted skips the coordinator and the fallback keeps the last pass's blocker", () => {
  const results = passResults({ perReviewer: 400, descriptionChars: 945 });
  const fit = fitCoordinatorPrompt(results, 2, build);
  assert.equal(fit.mode, "too_large");
  assert.equal(fit.prompt, null);
  const merged = mergePassResults(results);
  assert.ok(selectFallbackFindings(merged).some(f => f.summary === "LAST PASS BLOCKER drops every row"));
  assert.ok(buildFallbackReview(merged, "full", [], "<!-- m -->").includes("LAST PASS BLOCKER drops every row"));
});

test("exact duplicate findings across passes are sent once when compacting", () => {
  const results = passResults({ perReviewer: 8, descriptionChars: 2000 });
  for (const r of results.filter(r => r.pass === 2)) {
    r.findings = results.find(p => p.pass === 1 && p.agentKey === r.agentKey).findings.map(f => ({ ...f }));
  }
  results.at(-1).findings.push({ category: "qa", severity: "p0", file: "src/qa/last.rs", line: "99", summary: "LAST PASS BLOCKER", description: "x", suggestion: "y" });
  const fit = fitCoordinatorPrompt(results, 2, build);
  assert.ok(fit.prompt.length <= MAX_USER_PROMPT_CHARS);
  assert.equal((fit.prompt.match(/<finding>/g) ?? []).length, 8 * 8 + 1);
  assert.ok(fit.prompt.includes("LAST PASS BLOCKER"));
});

test("the runner never lets the transport slice the coordinator prompt", () => {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  assert.match(source, /userPrompt\.slice\(0, MAX_USER_PROMPT_CHARS\)/);
  const coordinator = source.slice(source.indexOf("async function runCoordinator"), source.indexOf("// ─── GitHub integration"));
  assert.match(coordinator, /fitCoordinatorPrompt\(/);
  assert.match(coordinator, /too_large/);
  assert.match(coordinator, /"review\.coordinator_input"/);
});
