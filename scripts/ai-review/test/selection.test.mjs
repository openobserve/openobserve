import test from "node:test";
import assert from "node:assert/strict";

import { isReleaseFile, resolveRulesFiles } from "../src/selection.mjs";

test("release review runs only for release-relevant files", () => {
  for (const path of [
    "src/infra/src/table/migration/m20260101_add_col.rs",
    "src/core/src/ofga/migrations/mod.rs",
    "schema.sql",
    "Cargo.toml",
    "src/config/Cargo.toml",
    "Cargo.lock",
    "web/package.json",
    "rust-toolchain.toml",
    "src/config/src/config.rs",
    ".github/workflows/ai-code-review.yml",
    "deploy/build/Dockerfile",
    "cross/Dockerfile.oss.musl",
  ]) {
    assert.equal(isReleaseFile(path), true, path);
  }
  for (const path of [
    "src/service/search/mod.rs",
    "src/config/src/meta/stream.rs",
    "web/src/components/charts/Chart.vue",
    "web/src/locales/languages/en.json",
    "scripts/ai-review/run-review.mjs",
  ]) {
    assert.equal(isReleaseFile(path), false, path);
  }
});

test("rules fall back to CLAUDE.md only where AGENTS.md is absent", () => {
  const present = new Set(["/e/AGENTS.md", "/e/web/CLAUDE.md", "/e/sub/CLAUDE.md", "/e/sub/AGENTS.md", "/tmp/web.txt"]);
  const exists = p => present.has(p);
  assert.deepEqual(
    resolveRulesFiles(["/e/AGENTS.md", "/e/web/AGENTS.md", "/e/sub/AGENTS.md", "/tmp/web.txt", "/e/none/AGENTS.md", "/tmp/missing.txt"], exists),
    ["/e/AGENTS.md", "/e/web/CLAUDE.md", "/e/sub/AGENTS.md", "/tmp/web.txt"],
  );
  assert.deepEqual(resolveRulesFiles(["/x/AGENTS.md"], p => p === "/x/CLAUDE.md"), ["/x/CLAUDE.md"]);
});
