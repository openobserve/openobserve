import assert from "node:assert/strict";
import { test } from "node:test";
import {
  digest,
  identity,
  inventory,
  partition,
  shardIndex,
  verifyFiles,
  weight,
} from "./partition.mjs";
import { validateReports } from "./validate.mjs";

const timings = {
  files: { "heavy.spec.ts": 20, "medium.spec.ts": 10 },
  fallbackSeconds: 1,
  overheadSeconds: { default: 2, node: 0.1 },
};
const file = (name, project = "jsdom") => ({ file: name, project, pool: "forks" });
const files = [
  file("heavy.spec.ts"),
  file("medium.spec.ts"),
  file("new.spec.ts", "node"),
  file("skip.spec.ts"),
];
const expected = {
  count: 2,
  files,
  timings,
  sha: "abc",
  runId: "123",
  attempt: 2,
  configDigest: "config",
  environmentDigest: "environment",
  node: "v24",
  vitest: "4.1.11",
};

function reports() {
  const manifest = inventory(files);
  return partition(files, expected.count, timings).map((assigned, index) => {
    const blob = Buffer.from(`blob-${index}`);
    return {
      blob,
      metadata: {
        schema: 1,
        ...expected,
        index: index + 1,
        attempt: 1,
        reason: "passed",
        hasCoverage: true,
        manifest,
        manifestDigest: digest(JSON.stringify(manifest)),
        blobDigest: digest(blob),
        files: assigned.map((entry) => ({
          ...entry,
          state: entry.file === "skip.spec.ts" ? "skipped" : "passed",
          tests: [
            {
              id: entry.file,
              name: "case",
              mode: entry.file === "skip.spec.ts" ? "todo" : "run",
              state: entry.file === "skip.spec.ts" ? "skipped" : "passed",
            },
          ],
          collected: [
            { id: entry.file, name: "case", mode: entry.file === "skip.spec.ts" ? "todo" : "run" },
          ],
        })),
      },
    };
  });
}

test("partitions exactly once with deterministic longest-first balancing", () => {
  const parts = partition(files, 2, timings);
  verifyFiles(parts.flat(), files, "partition");
  assert.deepEqual(partition([...files].reverse(), 2, timings), parts);
  assert.equal(parts[0][0].file, "heavy.spec.ts");
  assert.equal(parts[1][0].file, "medium.spec.ts");
  assert.ok(weight(file("unknown.spec.ts"), timings) > 0);
});

test("ties use project/path identity and empty shards remain represented", () => {
  const sample = [file("z.spec.ts"), file("a.spec.ts")];
  assert.deepEqual(
    partition(sample, 4, timings).map((part) => part.map((entry) => entry.file)),
    [["a.spec.ts"], ["z.spec.ts"], [], []],
  );
});

test("rejects duplicate paths even across projects or pools", () => {
  assert.throws(() => inventory([file("a.spec.ts"), file("a.spec.ts", "node")]), /Duplicate/);
});

test("normalizes discovery and rejects paths outside the root", () => {
  assert.deepEqual(
    identity(
      { moduleId: "/web/src/a.spec.ts", project: { name: "node" }, pool: "threads" },
      "/web",
    ),
    { file: "src/a.spec.ts", project: "node", pool: "threads" },
  );
  assert.throws(() => identity({ moduleId: "/other/a.spec.ts" }, "/web"), /outside root/);
});

test("rejects invalid counts, indices and weights", () => {
  for (const value of [0, -1, 1.5, "", "1/4", "01", NaN, Infinity]) {
    assert.throws(() => partition(files, value, timings), /positive integer/);
    assert.throws(() => shardIndex(value, 4), /positive integer/);
  }
  assert.throws(() => shardIndex(5, 4), /exceeds/);
  assert.throws(() => partition(files, 2, { ...timings, fallbackSeconds: -1 }), /Invalid duration/);
});

test("allows earlier successful attempts of the same run alongside replacement artifacts", () => {
  const data = reports();
  data[1].metadata.attempt = 2;
  assert.deepEqual(validateReports(data, expected), {
    files: 4,
    tests: 4,
    dispositions: { passed: 3, todo: 1 },
  });
});

test("rejects missing, duplicate and out-of-range shard reports", () => {
  assert.throws(() => validateReports(reports().slice(0, 1), expected), /Missing shards/);
  assert.throws(() => validateReports([reports()[0], reports()[0]], expected), /Duplicate shard/);
  const data = reports();
  data[0].metadata.index = 3;
  assert.throws(() => validateReports(data, expected), /exceeds/);
});

for (const field of ["sha", "runId", "configDigest", "environmentDigest", "node", "vitest"]) {
  test(`rejects mixed ${field}`, () => {
    const data = reports();
    data[0].metadata[field] = "unexpected";
    assert.throws(() => validateReports(data, expected), new RegExp(`wrong ${field}`));
  });
}

test("rejects future attempts, wrong counts, interruption and missing coverage", () => {
  for (const [field, value] of [
    ["attempt", 3],
    ["count", 3],
    ["reason", "interrupted"],
    ["hasCoverage", false],
  ]) {
    const data = reports();
    data[0].metadata[field] = value;
    assert.throws(() => validateReports(data, expected));
  }
});

test("rejects corrupt blobs and manifests", () => {
  const data = reports();
  data[0].blob = Buffer.from("corrupt");
  assert.throws(() => validateReports(data, expected), /Corrupt blob/);
  const other = reports();
  other[0].metadata.manifestDigest = "changed";
  assert.throws(() => validateReports(other, expected), /Corrupt manifest/);
});

test("rejects a wrong file even when counts match and a changed project", () => {
  const data = reports();
  data[0].metadata.files[0].file = "replacement.spec.ts";
  assert.throws(() => validateReports(data, expected), /unexpected/);
  const other = reports();
  other[0].metadata.files[0].project = "node";
  assert.throws(() => validateReports(other, expected), /unexpected/);
});

test("rejects a file omitted from discovery", () => {
  const data = reports();
  data[0].metadata.manifest = data[0].metadata.manifest.slice(1);
  assert.throws(() => validateReports(data, expected), /discovery/);
});

test("rejects unfinished files and tests, duplicate tests, and lost collected cases", () => {
  for (const mutate of [
    (entry) => {
      entry.state = "pending";
    },
    (entry) => {
      entry.tests[0].state = "pending";
    },
    (entry) => {
      entry.tests.push(entry.tests[0]);
    },
    (entry) => {
      entry.tests = [];
    },
    (entry) => {
      entry.collected.push({ id: "lost", name: "lost", mode: "run" });
    },
  ]) {
    const data = reports();
    mutate(data[0].metadata.files[0]);
    assert.throws(() => validateReports(data, expected));
  }
});

test("missing timing maps use deterministic fallback and corrupt maps fail", async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { timings: loadTimings } = await import("./runtime.mjs");
  const root = mkdtempSync(join(tmpdir(), "ui-shard-test-"));
  try {
    mkdirSync(join(root, "scripts/ui-tests"), { recursive: true });
    const fallback = loadTimings(root);
    assert.deepEqual(partition(files, 2, fallback), partition([...files].reverse(), 2, fallback));
    writeFileSync(join(root, "scripts/ui-tests/durations.json"), "{invalid");
    assert.throws(() => loadTimings(root), SyntaxError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the sequencer preserves project groups and runs heavy files first within each group", async () => {
  const { default: Sequencer } = await import("./sequencer.ts");
  const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const spec = (name, project, groupOrder) => ({
    moduleId: `${root}/${name}`,
    pool: "forks",
    project: { name: project, config: { isolate: true, sequence: { groupOrder } } },
  });
  const a = spec("src/components/dashboards/addPanel/ConfigPanel.spec.ts", "jsdom", 1);
  const b = spec("src/utils/json.spec.ts", "jsdom", 1);
  const c = spec("src/utils/uuid.spec.ts", "node", 0);
  const sequencer = new Sequencer({ config: { root } });
  assert.deepEqual(await sequencer.sort([b, a, c]), [c, a, b]);
});
