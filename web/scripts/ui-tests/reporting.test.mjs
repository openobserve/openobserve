import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { configurationDigest, environmentDigest, timings } from "./runtime.mjs";
import { validateReports } from "./validate.mjs";
import { reportedTest } from "./reporter.ts";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("reporting preserves genuinely pending runnable tests and terminal failures", () => {
  const pending = {
    id: "required",
    fullName: "required test",
    options: { mode: "run" },
    parent: { type: "module" },
    result: () => ({ state: "pending" }),
  };
  assert.deepEqual(reportedTest(pending), {
    id: "required",
    name: "required test",
    mode: "run",
    state: "pending",
  });
  const parent = { type: "suite", options: { mode: "skip" }, parent: pending.parent };
  for (const state of ["failed", "passed"]) {
    assert.equal(reportedTest({ ...pending, parent, result: () => ({ state }) }).state, state);
  }
});

test(
  "real Vitest blobs preserve nested skipped/todo cases and merge covered shards",
  { timeout: 60000 },
  () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ui-shard-report-")));
    const env = {
      ...process.env,
      GITHUB_SHA: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: webRoot,
        encoding: "utf8",
      }).trim(),
      GITHUB_RUN_ID: "fixture-run",
      GITHUB_RUN_ATTEMPT: "2",
      UI_TEST_REPORTS_DIRECTORY: join(root, ".vitest-reports"),
      NODE_ENV: "test",
    };
    try {
      const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
        cwd: webRoot,
        encoding: "utf8",
      }).trim();
      writeFileSync(join(root, ".git"), `gitdir: ${gitDir}\n`);
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "scripts"));
      symlinkSync(join(webRoot, "node_modules"), join(root, "node_modules"), "dir");
      mkdirSync(join(root, "scripts/ui-tests"));
      for (const name of ["run.mjs", "runtime.mjs", "partition.mjs", "validate.mjs"])
        copyFileSync(join(webRoot, "scripts/ui-tests", name), join(root, "scripts/ui-tests", name));
      copyFileSync(join(webRoot, "coverage.sh"), join(root, "coverage.sh"));
      writeFileSync(join(root, "scripts/ui-tests/config.json"), '{"shards":4}');
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      writeFileSync(
        join(root, "src/value.ts"),
        "export const value = (n: number) => n > 2 ? n + 1 : 1 + n;",
      );
      for (const [name, body] of Object.entries({
        a: 'it("passes", () => expect(value(1)).toBe(2));',
        b: `it.skip("skips", () => expect(value(1)).toBe(0));
            describe.skip("outer skip", () => {
              describe("middle", () => {
                describe.skip("inner skip", () => {
                  it("inherits skip", () => { throw new Error("must stay skipped"); });
                });
              });
            });`,
        c: `it.todo("todo");
            describe.todo("outer todo", () => {
              describe("middle", () => {
                describe.skip("inner", () => {
                  it("inherits todo", () => { throw new Error("must stay todo"); });
                });
              });
            });
            describe("ordinary todo", () => {
              it.todo("ordinary todo case");
            });
            describe("mixed nonrunning", () => {
              it.skip("mixed skipped case", () => { throw new Error("must stay skipped"); });
              it.todo("mixed todo case");
            });`,
        d: `it("also passes", () => expect(value(3)).toBe(4));
            it("dynamic skip", ({ skip }) => skip());`,
      })) {
        writeFileSync(
          join(root, `src/${name}.spec.ts`),
          `import { describe, it, expect } from "vitest"; import { value } from "./value"; ${body}`,
        );
      }
      const config = {
        test: {
          root,
          include: ["src/*.spec.ts"],
          environment: "node",
          isolate: true,
          maxWorkers: 1,
          reporters: ["default", join(webRoot, "scripts/ui-tests/reporter.ts")],
          sequence: { sequencer: join(webRoot, "scripts/ui-tests/sequencer.ts") },
          coverage: {
            provider: "v8",
            include: ["src/value.ts"],
            reporter: [],
            reportsDirectory: join(root, "coverage"),
          },
        },
      };
      const renderConfig = (value = config) =>
        `import Sequencer from ${JSON.stringify(join(webRoot, "scripts/ui-tests/sequencer.ts"))}; export default ${JSON.stringify(value).replace(JSON.stringify(join(webRoot, "scripts/ui-tests/sequencer.ts")), "Sequencer")}`;
      writeFileSync(join(root, "vitest.config.ts"), renderConfig());
      const mergeConfig = structuredClone(config);
      mergeConfig.test.reporters = ["default"];
      mergeConfig.test.coverage.reporter = ["json-summary"];
      mergeConfig.test.coverage.thresholds = {
        lines: 100,
        branches: 100,
        statements: 100,
        functions: 100,
      };
      writeFileSync(join(root, "vitest.ci.config.ts"), renderConfig(mergeConfig));
      const run = (args) =>
        execFileSync(
          process.execPath,
          [join(webRoot, "node_modules/vitest/vitest.mjs"), "run", ...args],
          { cwd: root, env, stdio: "pipe", timeout: 12000, encoding: "utf8" },
        );
      for (let index = 1; index <= 4; index++) run(["--coverage", "--shard", `${index}/4`]);
      const directory = join(root, ".vitest-reports");
      const reports = readdirSync(directory).map((name) => ({
        metadata: JSON.parse(readFileSync(join(directory, name, "metadata.json"), "utf8")),
        blob: readFileSync(join(directory, name, "blob.json")),
      }));
      const expected = {
        configDigest: configurationDigest(root),
        environmentDigest: environmentDigest(env),
        node: process.version,
        vitest: JSON.parse(readFileSync(join(root, "node_modules/vitest/package.json"), "utf8"))
          .version,
        sha: env.GITHUB_SHA,
        runId: env.GITHUB_RUN_ID,
        attempt: 2,
        count: 4,
        timings: timings(root),
        files: ["a", "b", "c", "d"].map((name) => ({
          file: `src/${name}.spec.ts`,
          project: "",
          pool: "forks",
        })),
      };
      assert.deepEqual(validateReports(reports, expected), {
        files: 4,
        tests: 10,
        dispositions: { passed: 2, skipped: 4, todo: 4 },
      });
      const tests = reports.flatMap(({ metadata }) => metadata.files.flatMap((file) => file.tests));
      for (const mode of ["skip", "todo"]) {
        const inherited = tests.find((entry) => entry.name.endsWith(`inherits ${mode}`));
        assert.equal(inherited.mode, mode);
        assert.equal(inherited.state, "skipped");
      }
      for (const [name, mode] of [
        ["ordinary todo > ordinary todo case", "todo"],
        ["mixed nonrunning > mixed skipped case", "skip"],
        ["mixed nonrunning > mixed todo case", "todo"],
      ]) {
        const entry = tests.find((entry) => entry.name === name);
        assert.equal(entry.mode, mode);
        assert.equal(entry.state, "skipped");
      }
      const unfinished = reports.map(({ metadata, blob }) => ({
        metadata: structuredClone(metadata),
        blob,
      }));
      const required = unfinished
        .flatMap(({ metadata }) => metadata.files.flatMap((file) => file.tests))
        .find((entry) => entry.state === "passed");
      required.state = "pending";
      assert.throws(() => validateReports(unfinished, expected), /Incomplete test/);
      mkdirSync(join(root, "blobs"));
      for (const report of reports)
        writeFileSync(join(root, "blobs", `${report.metadata.index}.json`), report.blob);
      run(["--config", "vitest.ci.config.ts", "--coverage", "--merge-reports", "blobs"]);
      const summary = JSON.parse(
        readFileSync(join(root, "coverage/coverage-summary.json"), "utf8"),
      );
      assert.ok(summary.total.lines.total > 0);
      assert.equal(summary.total.lines.pct, 100);
      const merge = () =>
        execFileSync(process.execPath, [join(root, "scripts/ui-tests/run.mjs"), "merge"], {
          cwd: root,
          env,
          stdio: "pipe",
          timeout: 12000,
          encoding: "utf8",
        });
      merge();
      assert.deepEqual(
        JSON.parse(readFileSync(join(root, "coverage/coverage-summary.json"), "utf8")),
        summary,
      );
      assert.deepEqual(
        JSON.parse(readFileSync(join(directory, "completeness.json"), "utf8")),
        validateReports(reports, expected),
      );
      const artifact = join(directory, "ui-unit-shard-1-4");
      assert.equal(
        statSync(join(artifact, "blob.json")).ino,
        statSync(join(directory, "merged/blob-1.json")).ino,
      );
      merge();
      renameSync(artifact, join(root, "missing-report"));
      assert.throws(merge, /Missing shards/);
      renameSync(join(root, "missing-report"), artifact);
      const original = readFileSync(join(artifact, "metadata.json"), "utf8");
      writeFileSync(
        join(artifact, "metadata.json"),
        JSON.stringify({ ...JSON.parse(original), attempt: 1 }),
      );
      merge();
      for (const reason of ["failed", "interrupted"]) {
        writeFileSync(
          join(artifact, "metadata.json"),
          JSON.stringify({ ...JSON.parse(original), reason }),
        );
        assert.throws(merge, /did not complete with coverage/);
      }
      writeFileSync(join(artifact, "metadata.json"), original);
      const blob = readFileSync(join(artifact, "blob.json"));
      writeFileSync(join(artifact, "blob.json"), "corrupt");
      assert.throws(merge, /Corrupt blob/);
      writeFileSync(join(artifact, "blob.json"), blob);
      merge();
      execFileSync("bash", [join(root, "coverage.sh"), "merge"], {
        cwd: root,
        env,
        stdio: "pipe",
        timeout: 12000,
      });
      assert.throws(
        () =>
          execFileSync("bash", [join(root, "coverage.sh"), "merge"], {
            cwd: root,
            env: { ...env, FRONTEND_COVERAGE_LINES: "101" },
            stdio: "pipe",
            timeout: 12000,
            encoding: "utf8",
          }),
        /lines.*below.*threshold/i,
      );
      mergeConfig.test.coverage.thresholds.lines = 101;
      writeFileSync(join(root, "vitest.ci.config.ts"), renderConfig(mergeConfig));
      for (const report of reports) {
        writeFileSync(
          join(directory, `ui-unit-shard-${report.metadata.index}-4/metadata.json`),
          JSON.stringify({ ...report.metadata, configDigest: configurationDigest(root) }),
        );
      }
      assert.throws(merge, /Coverage for lines.*does not meet global.*threshold/);
      assert.throws(() => validateReports(reports.slice(1), expected), /Missing shards/);
      reports[0].blob = Buffer.from("invalid");
      assert.throws(() => validateReports(reports, expected), /Corrupt blob/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
