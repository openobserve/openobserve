import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeConfidence, unfinishedReviewers } from "../src/confidence.mjs";
import { reviewerFacts } from "../src/auto-approve.mjs";
import {
  DEFAULT_COLD_PASSES,
  PRIMER_WAIT_MS,
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

// The stagger (arm A): the first item runs alone, and the pool is released by its first model response, its failure or skip, or the wait bound.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function staggerRun({ limit = 16, count = 5, primer, waitMs = 80 }) {
  const t0 = Date.now();
  const events = [];
  let active = 0;
  let peak = 0;
  const worker = async (item, index, hooks) => {
    events.push({ index, at: Date.now() - t0, kind: "start", hooks });
    active += 1;
    peak = Math.max(peak, active);
    try {
      if (index === 0) return await primer({ hooks, mark: kind => events.push({ index, at: Date.now() - t0, kind }) });
      await wait(5);
      return `item-${item}`;
    } finally {
      active -= 1;
    }
  };
  const promise = runPooled(Array.from({ length: count }, (_, i) => i), limit, worker, { primer: true, waitMs });
  return { promise, events, peak: () => peak };
}

const startOf = (events, index) => events.find(e => e.index === index && e.kind === "start").at;

test("the pool waits for the primer's first model response, not for its session to end", async () => {
  const run = staggerRun({
    primer: async ({ hooks, mark }) => {
      await wait(30);
      mark("first-response");
      hooks.onFirstResponse();
      await wait(250);
      return "primer";
    },
  });
  const results = await run.promise;
  const first = run.events.find(e => e.kind === "first-response").at;
  for (const index of [1, 2, 3, 4]) {
    assert.ok(startOf(run.events, index) >= first, `item ${index} started before the first response`);
    assert.ok(startOf(run.events, index) < first + 120, `item ${index} waited for the session to end (${startOf(run.events, index) - first} ms after the response)`);
  }
  assert.deepEqual(results.map(r => r.value), ["primer", "item-1", "item-2", "item-3", "item-4"]);
});

test("the primer's first response releases every waiting item together, with no further spacing between them", async () => {
  const run = staggerRun({ count: 7, primer: async ({ hooks }) => { await wait(20); hooks.onFirstResponse(); await wait(150); } });
  await run.promise;
  const starts = [1, 2, 3, 4, 5, 6].map(i => startOf(run.events, i));
  assert.ok(Math.max(...starts) - Math.min(...starts) < 40, `starts spread over ${Math.max(...starts) - Math.min(...starts)} ms`);
});

test("a primer that never responds holds the pool only for the bounded wait", async () => {
  const run = staggerRun({ waitMs: 80, primer: async () => { await wait(400); return "slow"; } });
  await run.promise;
  for (const index of [1, 2, 3, 4]) {
    const at = startOf(run.events, index);
    assert.ok(at >= 70, `item ${index} started at ${at} ms, before the bound`);
    assert.ok(at < 250, `item ${index} started at ${at} ms, long after the bound`);
  }
});

test("a primer that fails releases the pool at once, and its failure stays its own", async () => {
  const run = staggerRun({ waitMs: 5_000, primer: async () => { await wait(20); throw new Error("provider down"); } });
  const results = await run.promise;
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.message, "provider down");
  assert.deepEqual(results.slice(1).map(r => r.status), ["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
  assert.ok(startOf(run.events, 1) < 500, "the wait bound was never needed");
});

test("a primer that is skipped (returns without a model call) releases the pool at once", async () => {
  const run = staggerRun({ waitMs: 5_000, primer: async () => ({ skipped: true }) });
  const results = await run.promise;
  assert.equal(results.every(r => r.status === "fulfilled"), true);
  assert.ok(startOf(run.events, 4) < 500);
});

test("only the first item gets a hook, nothing runs beside the primer, and the pool limit still holds", async () => {
  const run = staggerRun({
    limit: 2,
    count: 6,
    primer: async ({ hooks }) => { await wait(20); hooks.onFirstResponse(); await wait(60); },
  });
  await run.promise;
  assert.equal(typeof run.events.find(e => e.index === 0).hooks.onFirstResponse, "function");
  for (const index of [1, 2, 3, 4, 5]) assert.equal(run.events.find(e => e.index === index).hooks.onFirstResponse, undefined);
  assert.ok(run.peak() <= 2, `peak concurrency ${run.peak()}`);
  assert.ok(startOf(run.events, 1) >= 20, "item 1 started while the primer was still waiting for its response");
});

test("a repeated or late first-response signal changes nothing", async () => {
  const run = staggerRun({ primer: async ({ hooks }) => { hooks.onFirstResponse(); hooks.onFirstResponse(); await wait(30); hooks.onFirstResponse(); } });
  const results = await run.promise;
  assert.equal(results.every(r => r.status === "fulfilled"), true);
});

test("without the stagger the pool starts every lane at once and hands the worker no hooks", async () => {
  const seen = [];
  await runPooled([1, 2, 3], 3, async (item, index, hooks) => { seen.push([item, index, hooks]); });
  assert.deepEqual(seen, [[1, 0, undefined], [2, 1, undefined], [3, 2, undefined]]);
  assert.equal(PRIMER_WAIT_MS, 90_000);
});

test("the runner staggers only when the arm asks, and routes the hook to the model call of the first pass", () => {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf-8");
  assert.match(source, /\{ primer: ARMS\.stagger \}/);
  assert.match(source, /REVIEWER_HOOKS\.run\(hooks, \(\) => runReviewer\(/);
  assert.match(source, /onFirstResponse: REVIEWER_HOOKS\.getStore\(\)\?\.onFirstResponse,/);
});
