import {
  digest,
  integer,
  inventory,
  key,
  partition,
  shardIndex,
  verifyFiles,
} from "./partition.mjs";

export function validateReports(reports, expected) {
  const count = integer(expected.count, "Shard count");
  const files = inventory(expected.files);
  const allocation = partition(files, count, expected.timings);
  const seen = new Set();
  const completed = [];
  for (const { metadata: report, blob } of reports) {
    if (!report || report.schema !== 1) throw new Error("Invalid shard metadata schema");
    const index = shardIndex(report.index, count);
    if (seen.has(index)) throw new Error(`Duplicate shard ${index}`);
    seen.add(index);
    for (const field of ["sha", "runId", "configDigest", "environmentDigest", "node", "vitest"]) {
      if (report[field] !== expected[field]) throw new Error(`Shard ${index} has wrong ${field}`);
    }
    const attempt = integer(report.attempt, "Artifact attempt");
    if (attempt > expected.attempt) throw new Error(`Shard ${index} is from a future attempt`);
    if (report.count !== count) throw new Error(`Shard ${index} has wrong shard count`);
    if (report.reason !== "passed" || report.hasCoverage !== true) {
      throw new Error(`Shard ${index} did not complete with coverage`);
    }
    if (!blob?.length || digest(blob) !== report.blobDigest)
      throw new Error(`Corrupt blob for shard ${index}`);
    verifyFiles(report.manifest, files, `Shard ${index} discovery`);
    if (report.manifestDigest !== digest(JSON.stringify(inventory(report.manifest)))) {
      throw new Error(`Corrupt manifest for shard ${index}`);
    }
    verifyFiles(report.files, allocation[index - 1], `Shard ${index} results`);
    for (const file of report.files) {
      if (!["passed", "skipped"].includes(file.state) || !Array.isArray(file.tests)) {
        throw new Error(`Incomplete file: ${key(file)}`);
      }
      if (file.state === "passed" && !file.tests.length)
        throw new Error(`Empty file: ${key(file)}`);
      if (!Array.isArray(file.collected)) throw new Error(`Missing collection: ${key(file)}`);
      const collected = new Map(file.collected.map((test) => [test.id, test]));
      if (collected.size !== file.collected.length || collected.size !== file.tests.length) {
        throw new Error(`Incomplete test collection: ${key(file)}`);
      }
      const testIds = new Set();
      for (const test of file.tests) {
        if (typeof test.id !== "string" || !test.id || testIds.has(test.id)) {
          throw new Error(`Duplicate or invalid test identity: ${key(file)}`);
        }
        testIds.add(test.id);
        const initial = collected.get(test.id);
        if (
          !initial ||
          initial.name !== test.name ||
          !["run", "skip", "todo"].includes(initial.mode) ||
          (["skip", "todo"].includes(initial.mode) && test.state !== "skipped")
        ) {
          throw new Error(`Changed test collection: ${key(file)} ${test.name}`);
        }
        if (
          typeof test.name !== "string" ||
          !["run", "skip", "todo"].includes(test.mode) ||
          !["passed", "skipped"].includes(test.state)
        ) {
          throw new Error(`Incomplete test: ${key(file)} ${test.name}`);
        }
        if (["skip", "todo"].includes(test.mode) && test.state !== "skipped") {
          throw new Error(`Invalid test disposition: ${key(file)} ${test.name}`);
        }
      }
    }
    completed.push(...report.files);
  }
  if (seen.size !== count) {
    throw new Error(
      `Missing shards: expected ${count}, received ${seen.size}; artifacts may have expired, rerun all jobs`,
    );
  }
  verifyFiles(completed, files, "Complete suite");
  return {
    files: completed.length,
    tests: completed.reduce((total, file) => total + file.tests.length, 0),
    dispositions: completed
      .flatMap((file) => file.tests)
      .reduce((totals, test) => {
        const status = test.mode === "todo" ? "todo" : test.state;
        totals[status] = (totals[status] || 0) + 1;
        return totals;
      }, {}),
  };
}
