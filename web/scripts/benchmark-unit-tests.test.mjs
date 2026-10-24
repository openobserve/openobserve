import assert from "node:assert/strict";
import { test } from "node:test";
import { compareResults } from "./benchmark-unit-tests.mjs";

function fixture() {
  const run = {
    sha: "candidate",
    node: "v24.22.0",
    npm: "11.19.1",
    workers: 8,
    lockfileSha256: "same-lockfile",
    errors: [],
    files: { total: 4, skipped: 0, failed: 0 },
    tests: { total: 40, skipped: 1, failed: 0 },
    coverageFiles: ["src/example.ts"],
    coverage: Object.fromEntries(
      ["lines", "functions", "branches", "statements"].map((key) => [
        key,
        { total: 100, covered: 90, skipped: 0, pct: 90 },
      ]),
    ),
  };
  const before = { ...structuredClone(run), sha: "baseline", wallSeconds: 400 };
  const after = { ...structuredClone(run), wallSeconds: 10, endedAt: 1120000 };
  const shards = [1, 2, 3, 4].map((index) => ({
    ...structuredClone(run),
    shard: `${index}/4`,
    files: { total: 1, skipped: 0, failed: 0 },
    tests: { total: 10, skipped: index === 1 ? 1 : 0, failed: 0 },
    startedAt: 1000000,
    wallSeconds: 100,
  }));
  return { before, after, shards };
}

test("separates critical-path savings from total timed runner occupancy", () => {
  const { before, after, shards } = fixture();
  const result = compareResults(before, after, shards);
  assert.deepEqual(result.errors, []);
  assert.equal(result.candidateCriticalPathSeconds, 120);
  assert.equal(result.candidateTimedRunnerSeconds, 410);
  assert.equal(result.wallReductionPercent, 70);
});

test("does not calculate savings for a failed baseline or shard", () => {
  for (const target of ["baseline", "shard"]) {
    const { before, after, shards } = fixture();
    (target === "baseline" ? before : shards[0]).errors.push("Tests failed");
    const result = compareResults(before, after, shards);
    assert.ok(result.errors.includes("Tests failed"));
    assert.equal(result.wallReductionPercent, undefined);
  }
});

test("rejects missing or duplicated shards", () => {
  const { before, after, shards } = fixture();
  for (const selected of [shards.slice(0, 3), [shards[0], shards[0], shards[2], shards[3]]]) {
    const result = compareResults(before, after, selected);
    assert.ok(result.errors.includes("Expected exactly four distinct successful shards"));
    assert.equal(result.wallReductionPercent, undefined);
  }
});

test("rejects lost tests even when all remaining tests passed", () => {
  const { before, after, shards } = fixture();
  after.tests.total--;
  const result = compareResults(before, after, shards);
  assert.ok(result.errors.includes("tests count changed"));
  assert.ok(result.errors.includes("Merged tests count does not match shards"));
  assert.equal(result.wallReductionPercent, undefined);
});

test("rejects a reduced coverage scope or denominator", () => {
  for (const key of ["scope", "denominator"]) {
    const { before, after, shards } = fixture();
    if (key === "scope") after.coverageFiles = [];
    else after.coverage.lines.total--;
    const result = compareResults(before, after, shards);
    assert.ok(
      result.errors.includes(
        key === "scope" ? "Coverage file scope changed" : "lines coverage denominator changed",
      ),
    );
    assert.equal(result.wallReductionPercent, undefined);
  }
});

test("rejects mismatched dependencies, workers, or candidate revisions", () => {
  for (const key of ["lockfileSha256", "workers", "sha"]) {
    const { before, after, shards } = fixture();
    shards[0][key] = "different";
    const result = compareResults(before, after, shards);
    assert.ok(result.errors.length > 0);
    assert.equal(result.wallReductionPercent, undefined);
  }
});
