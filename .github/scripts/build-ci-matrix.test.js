#!/usr/bin/env node
// Run with: node --test .github/scripts/build-ci-matrix.test.js (wired into generate_matrix in CI).
const { test, after } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "build-ci-matrix.js");
const REPO = path.join(__dirname, "../..");
const CI_MATRIX_DIR = path.join(REPO, "tests/ui-testing/ci-matrix");
const BASE = path.join(CI_MATRIX_DIR, "ci_matrix.json");
const MANIFEST = JSON.parse(fs.readFileSync(BASE, "utf8"));
const CONFIG = JSON.parse(fs.readFileSync(path.join(CI_MATRIX_DIR, "smoke_config.json"), "utf8"));
const FULL_COUNT = MANIFEST.length;
const CORE_PLUS_CANARY = [...CONFIG.core_shards, ...CONFIG.always_run].sort();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ci-matrix-test-"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function run(changedFiles, { base = BASE, env = {} } = {}) {
  const args = [SCRIPT, base];
  if (changedFiles !== null) {
    const tmp = path.join(TMP, "changed.txt");
    fs.writeFileSync(tmp, changedFiles.join("\n") + "\n");
    args.push("--select-for-changes", tmp);
  }
  // Pin the event so the suite passes wherever it runs (generate_matrix also runs on
  // merge_group, where the script's pull_request-only guard would otherwise fail 17 tests).
  const out = execFileSync("node", args, {
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", ...env },
  });
  return JSON.parse(out).include.map((s) => s.testfolder);
}

// A fixture manifest+config pair in its own dir, for validation-failure tests.
function fixture(name, manifest, config) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ci_matrix.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "smoke_config.json"), JSON.stringify(config));
  return path.join(dir, "ci_matrix.json");
}

test("no flag emits the full matrix unchanged", () => {
  assert.strictEqual(run(null).length, FULL_COUNT);
});

test("feature-scoped source change selects its shard plus the canary", () => {
  const folders = run(["web/src/components/alerts/AddAlert.vue"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("spec change selects only the shard owning that spec", () => {
  const folders = run(["tests/ui-testing/playwright-tests/Alerts/alerts-import.spec.js"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("dashboards source change selects the dashboard shards and Reports", () => {
  const folders = run(["web/src/components/dashboards/PanelSchemaRenderer.vue"]);
  assert.ok(folders.length > 5 && folders.length < FULL_COUNT);
  assert.ok(folders.includes("Reports"), "Reports specs build dashboards and must run");
  assert.ok(
    folders.every((f) => f.startsWith("Dashboard") || f === "Reports" || f === "Logs-SelectStar")
  );
});

test("backend (unmapped) change falls back to the core cross-section", () => {
  assert.deepStrictEqual(run(["src/service/search/mod.rs"]).sort(), CORE_PLUS_CANARY);
});

test("unmapped file alongside a mapped file yields core plus the mapped shard", () => {
  const folders = run(["src/service/search/mod.rs", "web/src/components/rum/SessionViewer.vue"]);
  assert.deepStrictEqual(folders.sort(), [...CORE_PLUS_CANARY, "RUM", "RUM-Token"].sort());
});

test("shared-code change (global_paths) falls back to the full matrix", () => {
  assert.strictEqual(run(["web/src/stores/index.ts"]).length, FULL_COUNT);
  assert.strictEqual(run(["web/package.json"]).length, FULL_COUNT);
});

test("playwright.yml wins over the .github ignore glob and forces full", () => {
  assert.strictEqual(run([".github/workflows/playwright.yml"]).length, FULL_COUNT);
});

test("only-ignored changes fall back to the core cross-section", () => {
  assert.deepStrictEqual(run(["README.md", "docs/example.md"]).sort(), CORE_PLUS_CANARY);
});

test("spec not in run_files routes to its folder's shards, not core", () => {
  const folders = run(["tests/ui-testing/playwright-tests/Alerts/brand-new.spec.js"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("shard-local helper routes to its folder's shards", () => {
  const folders = run(["tests/ui-testing/playwright-tests/Alerts/utils/alerts-api-helpers.js"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("shared test infrastructure and test data force the full matrix", () => {
  for (const file of [
    "tests/ui-testing/pages/page-manager.js",
    "tests/ui-testing/playwright-tests/utils/data-ingestion.js",
    "tests/ui-testing/playwright-tests/baseFixtures.js",
    "tests/ui-testing/playwright.config.js",
    "tests/ui-testing/package.json",
    "tests/test-data/logs_data.json",
    "web/src/plugins/index.ts",
  ]) {
    assert.strictEqual(run([file]).length, FULL_COUNT, file);
  }
});

test("cross-folder consumers are routed, not dropped", () => {
  // Dashboards test utils are imported by a Metrics spec.
  let folders = run(["tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js"]);
  assert.ok(folders.includes("Metrics"), "Metrics imports dashCreation.js");
  assert.ok(folders.includes("Dashboards-Core"));
  // cloudPages page objects are consumed by Dashboards-Visualize and Functions specs.
  folders = run(["tests/ui-testing/pages/cloudPages/cloud-env.js"]);
  assert.ok(folders.includes("Dashboards-Visualize") && folders.includes("Functions"), folders.join(","));
  // correlation plugin is runtime-imported by logs, traces, and alerts components.
  folders = run(["web/src/plugins/correlation/CorrelationPanel.vue"]);
  for (const f of ["Logs-Core", "Traces", "Alerts"]) assert.ok(folders.includes(f), f);
  // RUM-Token's spec asserts on the ingestion RUM config page.
  folders = run(["web/src/components/ingestion/recommended/FrontendRumConfig.vue"]);
  assert.ok(folders.includes("RUM-Token") && folders.includes("GeneralTests"), folders.join(","));
});

test("empty changed-files list forces the full matrix", () => {
  assert.strictEqual(run([]).length, FULL_COUNT);
});

test("frontend unit spec changes are ignored even inside global dirs", () => {
  const folders = run([
    "web/src/composables/useLogs/useHistogram.spec.ts",
    "web/src/components/alerts/AddAlert.vue",
  ]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("page-object change selects its feature's shards", () => {
  const folders = run(["tests/ui-testing/pages/alertsPages/alertsPage.js"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("ignored file alongside a mapped file does not widen the selection", () => {
  const folders = run([".github/workflows/unit-tests.yml", "web/src/components/rum/SessionViewer.vue"]);
  assert.deepStrictEqual(folders.sort(), ["Logs-SelectStar", "RUM", "RUM-Token"]);
});

test("selection refuses to run for non-pull_request events", () => {
  assert.throws(
    () => run(["web/src/components/alerts/AddAlert.vue"], { env: { GITHUB_EVENT_NAME: "merge_group" } }),
    /pull_request-only/
  );
});

test("config errors die eagerly, even when the changed file is global", () => {
  const shard = { testfolder: "X", actual_folder: "X", run_files: ["a.spec.js"] };
  const goodPaths = { folder_paths: { X: ["web/x/**"] }, global_paths: ["web/global/**"] };
  // Unsupported glob syntax dies before any matching happens.
  let base = fixture("badglob", [{ ...shard, paths: ["web/{a,b}/**"] }], { core_shards: ["X"], ...goodPaths });
  assert.throws(() => run(["web/global/app.ts"], { base }), /unsupported glob syntax/);
  // A core_shards entry naming a missing shard dies on the PR that introduces it.
  base = fixture("badcore", [shard], { core_shards: ["Renamed"], ...goodPaths });
  assert.throws(() => run(["web/global/app.ts"], { base }), /unknown shard/);
  // A shard reachable by no globs at all dies rather than rotting to core forever.
  base = fixture("noglobs", [shard], { core_shards: ["X"], folder_paths: {} });
  assert.throws(() => run(["web/global/app.ts"], { base }), /unreachable by source changes/);
});

test("every selection glob matches at least one tracked file", () => {
  const tracked = execFileSync("git", ["-C", REPO, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const globToRegExp = (glob) => {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") {
          re += ".*";
          i++;
          if (glob[i + 1] === "/") i++;
        } else re += "[^/]*";
      } else if (".+^$()|\\".includes(c)) re += "\\" + c;
      else re += c;
    }
    return new RegExp("^" + re + "$");
  };
  const lists = [
    ...Object.entries(CONFIG.folder_paths).map(([k, v]) => [`folder_paths.${k}`, v]),
    ["global_paths", CONFIG.global_paths],
    ...MANIFEST.filter((s) => s.paths).map((s) => [`shard ${s.testfolder} paths`, s.paths]),
  ];
  for (const [name, globs] of lists) {
    for (const glob of globs) {
      const re = globToRegExp(glob);
      assert.ok(
        tracked.some((f) => re.test(f)),
        `${name}: "${glob}" matches no tracked file — stale after a rename?`
      );
    }
  }
});

test("every run_files entry exists on disk in its shard's folder", () => {
  for (const s of MANIFEST) {
    for (const spec of s.run_files) {
      const p = path.join(REPO, "tests/ui-testing/playwright-tests", s.actual_folder, spec);
      assert.ok(fs.existsSync(p), `${s.testfolder}: ${spec} not found at ${p}`);
    }
  }
});
