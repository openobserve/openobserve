import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { configurationDigest, environmentDigest, timings } from "./runtime.mjs";
import { validateReports } from "./validate.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test(
  "real Vitest blobs preserve skipped/todo cases and merge covered shards",
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
      UI_TEST_REPORTS_DIRECTORY: join(root, "reports"),
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
      writeFileSync(join(root, "scripts/ui-tests/config.json"), '{"shards":4}');
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      writeFileSync(join(root, "src/value.ts"), "export const value = (n: number) => n + 1;");
      for (const [name, body] of Object.entries({
        a: 'it("passes", () => expect(value(1)).toBe(2));',
        b: 'it.skip("skips", () => expect(value(1)).toBe(0));',
        c: 'it.todo("todo");',
        d: 'it("also passes", () => expect(value(3)).toBe(4));',
      })) {
        writeFileSync(
          join(root, `src/${name}.spec.ts`),
          `import { it, expect } from "vitest"; import { value } from "./value"; ${body}`,
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
      const renderConfig = () =>
        `import Sequencer from ${JSON.stringify(join(webRoot, "scripts/ui-tests/sequencer.ts"))}; export default ${JSON.stringify(config).replace(JSON.stringify(join(webRoot, "scripts/ui-tests/sequencer.ts")), "Sequencer")}`;
      writeFileSync(join(root, "vitest.config.ts"), renderConfig());
      const run = (args) =>
        execFileSync(
          process.execPath,
          [join(webRoot, "node_modules/vitest/vitest.mjs"), "run", ...args],
          { cwd: root, env, stdio: "pipe", timeout: 12000, encoding: "utf8" },
        );
      for (let index = 1; index <= 4; index++) run(["--coverage", "--shard", `${index}/4`]);
      const reports = readdirSync(join(root, "reports")).map((name) => ({
        metadata: JSON.parse(readFileSync(join(root, "reports", name, "metadata.json"), "utf8")),
        blob: readFileSync(join(root, "reports", name, "blob.json")),
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
        tests: 4,
        dispositions: { passed: 2, skipped: 1, todo: 1 },
      });
      mkdirSync(join(root, "blobs"));
      for (const report of reports)
        writeFileSync(join(root, "blobs", `${report.metadata.index}.json`), report.blob);
      config.test.reporters = ["default"];
      config.test.coverage.reporter = ["json-summary"];
      config.test.coverage.thresholds = {
        lines: 100,
        branches: 100,
        statements: 100,
        functions: 100,
      };
      writeFileSync(join(root, "merge.config.ts"), renderConfig());
      run(["--config", "merge.config.ts", "--coverage", "--merge-reports", "blobs"]);
      const summary = JSON.parse(
        readFileSync(join(root, "coverage/coverage-summary.json"), "utf8"),
      );
      assert.ok(summary.total.lines.total > 0);
      assert.equal(summary.total.lines.pct, 100);
      assert.throws(() => validateReports(reports.slice(1), expected), /Missing shards/);
      reports[0].blob = Buffer.from("invalid");
      assert.throws(() => validateReports(reports, expected), /Corrupt blob/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
