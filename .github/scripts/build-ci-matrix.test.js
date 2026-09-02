#!/usr/bin/env node
// Run with: node --test .github/scripts/build-ci-matrix.test.js
// Exercises --select-for-changes against the real manifest + smoke config, so the
// fail-safe contract (unmapped/global/ignored-only => full matrix) is pinned by tests.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "build-ci-matrix.js");
const BASE = path.join(__dirname, "../../tests/ui-testing/ci-matrix/ci_matrix.json");
const FULL_COUNT = JSON.parse(fs.readFileSync(BASE, "utf8")).length;

function run(changedFiles) {
  const args = [SCRIPT, BASE];
  if (changedFiles !== null) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ci-matrix-test-")), "changed.txt");
    fs.writeFileSync(tmp, changedFiles.join("\n") + "\n");
    args.push("--select-for-changes", tmp);
  }
  const out = execFileSync("node", args, { encoding: "utf8" });
  return JSON.parse(out).include.map((s) => s.testfolder);
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

test("dashboards source change selects every dashboard shard", () => {
  const folders = run(["web/src/components/dashboards/PanelSchemaRenderer.vue"]);
  assert.ok(folders.length > 5 && folders.length < FULL_COUNT);
  assert.ok(folders.every((f) => f.startsWith("Dashboard") || f === "Logs-SelectStar"));
});

const CORE = JSON.parse(
  fs.readFileSync(path.join(path.dirname(BASE), "smoke_config.json"), "utf8")
).core_shards;

test("backend (unmapped) change falls back to the core cross-section", () => {
  const folders = run(["src/service/search/mod.rs"]);
  assert.deepStrictEqual(folders.sort(), [...CORE, "Logs-SelectStar"].sort());
});

test("unmapped file alongside a mapped file yields core plus the mapped shard", () => {
  const folders = run(["src/service/search/mod.rs", "web/src/components/rum/SessionViewer.vue"]);
  assert.deepStrictEqual(folders.sort(), [...CORE, "Logs-SelectStar", "RUM", "RUM-Token"].sort());
});

test("shared-code change (global_paths) falls back to the full matrix", () => {
  assert.strictEqual(run(["web/src/stores/index.ts"]).length, FULL_COUNT);
  assert.strictEqual(run(["web/package.json"]).length, FULL_COUNT);
});

test("playwright.yml wins over the .github ignore glob and forces full", () => {
  assert.strictEqual(run([".github/workflows/playwright.yml"]).length, FULL_COUNT);
});

test("only-ignored changes fall back to the core cross-section", () => {
  const folders = run(["README.md", "docs/example.md"]);
  assert.deepStrictEqual(folders.sort(), [...CORE, "Logs-SelectStar"].sort());
});

test("spec not in run_files routes to its folder's shards, not core", () => {
  const folders = run(["tests/ui-testing/playwright-tests/Alerts/brand-new.spec.js"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("shard-local helper routes to its folder's shards", () => {
  const folders = run(["tests/ui-testing/playwright-tests/Alerts/utils/alerts-api-helpers.js"]);
  assert.deepStrictEqual(folders.sort(), ["Alerts", "Logs-SelectStar"]);
});

test("shared test infrastructure forces the full matrix", () => {
  for (const file of [
    "tests/ui-testing/pages/page-manager.js",
    "tests/ui-testing/playwright-tests/utils/data-ingestion.js",
    "tests/ui-testing/playwright-tests/baseFixtures.js",
    "tests/ui-testing/playwright.config.js",
    "tests/ui-testing/package.json",
  ]) {
    assert.strictEqual(run([file]).length, FULL_COUNT, file);
  }
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

test("unsupported glob syntax dies loudly instead of silently never matching", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-matrix-badglob-"));
  const manifest = path.join(dir, "ci_matrix.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify([{ testfolder: "X", actual_folder: "X", run_files: ["a.spec.js"], paths: ["web/{a,b}/**"] }])
  );
  fs.writeFileSync(path.join(dir, "smoke_config.json"), JSON.stringify({ core_shards: ["X"] }));
  const changed = path.join(dir, "changed.txt");
  fs.writeFileSync(changed, "web/a/file.ts\n");
  assert.throws(
    () => execFileSync("node", [SCRIPT, manifest, "--select-for-changes", changed], { encoding: "utf8" }),
    /unsupported glob syntax/
  );
});

test("ignored file alongside a mapped file does not widen the selection", () => {
  const folders = run([".github/workflows/unit-tests.yml", "web/src/components/rum/SessionViewer.vue"]);
  assert.deepStrictEqual(folders.sort(), ["Logs-SelectStar", "RUM", "RUM-Token"]);
});
