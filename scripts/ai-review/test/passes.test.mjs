import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeConfidence, unfinishedReviewers } from "../src/confidence.mjs";
import { reviewerFacts } from "../src/auto-approve.mjs";
import {
  DEFAULT_COLD_PASSES,
  lostPassesNote,
  mergePassResults,
  parseColdPasses,
  passLabel,
  passPlan,
  reviewComplete,
  runPooled,
} from "../src/passes.mjs";
import { buildFallbackReview, partialFindingsBlock, selectFallbackFindings } from "../src/report.mjs";

const finding = (summary, { severity = "p1", file = "src/a.rs", line = "10", category = "correctness" } = {}) =>
  ({ category, severity, file, line, summary, description: "d", suggestion: "" });
const done = (agentKey, pass, findings = []) => ({ agentKey, agentName: `${agentKey} Reviewer`, pass, findings, parsed: true, error: null, fullDiff: true });
const failed = (agentKey, pass, extra = {}) => ({ agentKey, agentName: `${agentKey} Reviewer`, pass, findings: [], error: "boom", ...extra });

test("the cold pass count defaults to 2 and is clamped to 1..3", () => {
  const table = [
    [undefined, 2], [null, 2], ["", 2], ["  ", 2], ["abc", 2], ["2.5", 2], ["1e2", 2],
    ["1", 1], ["2", 2], ["3", 3], [" 3 ", 3], ["0", 1], ["-4", 1], ["9", 3], [3, 3],
  ];
  for (const [raw, expected] of table) assert.equal(parseColdPasses(raw), expected, String(raw));
  assert.equal(DEFAULT_COLD_PASSES, 2);
});

test("the plan runs every area's first pass before any second pass, and labels name the pass", () => {
  assert.deepEqual(passPlan(["security", "correctness"], 2), [
    { agentKey: "security", pass: 1 }, { agentKey: "correctness", pass: 1 },
    { agentKey: "security", pass: 2 }, { agentKey: "correctness", pass: 2 },
  ]);
  assert.equal(passLabel("Security Reviewer", 1, 2), "Security Reviewer, pass 1/2");
  assert.equal(passLabel("Security Reviewer", 1, 1), "Security Reviewer");
});

test("the pool never runs more than its limit at once and keeps results in plan order", async () => {
  let active = 0;
  let peak = 0;
  const results = await runPooled([5, 1, 3, 2, 4], 2, async n => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, n));
    active -= 1;
    if (n === 3) throw new Error("three");
    return n * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results.map(r => r.status === "fulfilled" ? r.value : r.reason.message), [50, 10, "three", 20, 40]);
});

test("an area is finished when any of its passes finished, and unfinished only when every pass failed", () => {
  const results = mergePassResults([
    done("security", 1), failed("correctness", 1), failed("quality", 1, { timedOut: true }),
    failed("security", 2, { timedOut: true }), done("correctness", 2), failed("quality", 2, { timedOut: true }),
  ]);
  assert.deepEqual(results.map(r => r.agentKey), ["security", "correctness", "quality"]);
  assert.deepEqual(unfinishedReviewers(results), ["quality Reviewer"]);
  assert.deepEqual(results.map(r => [r.passes, r.passesFinished]), [[2, 1], [2, 1], [2, 0]]);
  const quality = results[2];
  assert.equal(quality.error, "boom");
  assert.equal(quality.timedOut, true);
  assert.deepEqual(reviewerFacts(results).map(f => f.finished), [true, true, false]);
  assert.equal(mergeConfidence({ failedReviewers: unfinishedReviewers(results.slice(0, 2)), ranCount: 2 }).level, "high");
});

test("an area whose passes were all skipped stays skipped, not failed", () => {
  const skip = pass => ({ agentKey: "qa", agentName: "QA / Test Reviewer", pass, findings: [], error: null, skipped: true });
  const [qa] = mergePassResults([skip(1), skip(2)]);
  assert.equal(qa.skipped, true);
  assert.equal(lostPassesNote([qa]), "");
});

test("a lost pass is named while its area still counts as reviewed", () => {
  const results = mergePassResults([done("security", 1), failed("security", 2), done("correctness", 1), done("correctness", 2)]);
  assert.equal(lostPassesNote(results), "> ℹ️ Some reviewer passes did not finish (security: 1 of 2); those areas were still reviewed by the passes that finished.");
  assert.equal(lostPassesNote(mergePassResults([done("security", 1)])), "");
});

test("the fallback unions both passes and merges the same issue worded differently nearby", () => {
  const results = mergePassResults([
    done("correctness", 1, [
      finding("Unbounded retry loop never gives up on 429", { severity: "p2", line: "40" }),
      finding("Stream name is not escaped in the SQL filter", { line: "12" }),
    ]),
    done("correctness", 2, [
      finding("Retry loop on 429 is unbounded", { severity: "p1", line: "42" }),
      finding("Stream name interpolated into the SQL filter without escaping", { severity: "p2", line: "10" }),
      finding("Missing index on created_at", { severity: "p2", file: "src/b.rs", line: "5" }),
    ]),
  ]);
  const kept = selectFallbackFindings(results);
  assert.equal(kept.length, 3);
  const retry = kept.find(f => /retry/i.test(f.summary));
  assert.equal(retry.severity, "p1");
  assert.equal(kept.find(f => /stream name/i.test(f.summary)).severity, "p1");
  assert.ok(kept.some(f => f.file === "src/b.rs"));
  const review = buildFallbackReview(results, "full", [], "<!-- m -->");
  assert.match(review, /5 raw findings → 3 unique/);
  assert.match(partialFindingsBlock(results), /Findings so far \(3\)/);
});

test("the fallback keeps distinct issues apart even at the same place", () => {
  const results = mergePassResults([
    done("correctness", 1, [finding("Off-by-one in page offset", { line: "10" })]),
    done("correctness", 2, [
      finding("Lock held across await in flush", { line: "11" }),
      finding("Page offset is off by one", { line: "12", file: "src/other.rs" }),
      finding("Page offset off-by-one", { line: "50" }),
    ]),
  ]);
  assert.equal(selectFallbackFindings(results).length, 4);
});

test("the fallback never merges two different blockers that share most of their title", () => {
  const results = mergePassResults([
    done("correctness", 1, [finding("Delete query ignores the organization filter", { line: "40" })]),
    done("correctness", 2, [finding("Delete query ignores the stream filter", { line: "42" })]),
  ]);
  assert.equal(selectFallbackFindings(results).length, 2);
  const minor = mergePassResults([
    done("correctness", 1, [finding("Delete query ignores the organization filter", { severity: "p2", line: "40" })]),
    done("correctness", 2, [finding("Delete query ignores the stream filter", { severity: "p3", line: "42" })]),
  ]);
  assert.equal(selectFallbackFindings(minor).length, 2);
  const reworded = mergePassResults([
    done("correctness", 1, [finding("Retry loop on 429 is unbounded", { line: "40" })]),
    done("correctness", 2, [finding("Unbounded retry loop never gives up on 429", { line: "42" })]),
  ]);
  assert.equal(selectFallbackFindings(reworded).length, 2);
  const same = mergePassResults([
    done("correctness", 1, [finding("Delete query ignores the stream filter.", { line: "40", category: "security" })]),
    done("correctness", 2, [finding("delete query  ignores the stream filter", { line: "42" })]),
  ]);
  assert.equal(selectFallbackFindings(same).length, 1);
});

test("only a review whose every pass finished in time and whose coordinator merged may skip an unchanged diff next time", () => {
  const coordinator = { fallback: false };
  const skippedPass = { agentKey: "frontend", agentName: "frontend Reviewer", pass: 1, findings: [], error: null, skipped: true };
  assert.equal(reviewComplete([done("security", 1), done("security", 2), skippedPass], coordinator), true);
  assert.equal(reviewComplete([done("security", 1), failed("security", 2)], coordinator), false, "a lost cold pass is a partial review");
  assert.equal(reviewComplete([done("security", 1), failed("security", 2, { timedOut: true })], coordinator), false);
  assert.equal(reviewComplete([done("security", 1), { ...done("qa", 1), parsed: false }], coordinator), false, "unparseable output is unfinished");
  assert.equal(reviewComplete([done("security", 1), { ...done("qa", 1), wrappedUp: true }], coordinator), false, "a reviewer cut short at its soft deadline");
  assert.equal(reviewComplete([done("security", 1)], { fallback: true }), false, "the coordinator fell back");
  assert.equal(reviewComplete([done("security", 1)], null), false, "the coordinator never ran");
});

test("run-review writes the diff fingerprint only for a complete review", () => {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf-8");
  assert.match(source, /const complete = reviewComplete\(passResults, coordinatorResult\);/);
  assert.match(source, /diffFingerprint: complete && fullyRead && diffPinned && hunksLocatable\(diff, readBaseFile\) \? fingerprint : ""/);
  assert.equal((source.match(/diffFingerprint:/g) || []).length, 1, "every finishReviewBody call goes through the completeness check");
});
