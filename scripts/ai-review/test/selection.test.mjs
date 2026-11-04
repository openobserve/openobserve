import test from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isCiOnlyPath, isDocsPath, isReleaseFile, isTestOnlyPath, listingComplete, narrowTier, nothingToReviewReason, resolveRulesFiles } from "../src/selection.mjs";
import { isSensitivePath } from "../src/auto-approve.mjs";
import { LOADER_DIRS, LOADER_FILES } from "../src/sanitize.mjs";

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

test("a PR of test code only gets the test-only tier, of CI files only the ci-only tier, and anything else neither", () => {
  assert.equal(narrowTier(["tests/ui-testing/playwright-tests/a.spec.js", "src/service/tests/query.rs", "web/src/utils/date.spec.ts"]), "test-only");
  assert.equal(narrowTier(["src/config/src/lib_test.rs", "tests/api-testing/test_streams.py", "web/src/test/fixtures/x.json"]), "test-only");
  assert.equal(narrowTier(["scripts/ai-review/test/comments.test.mjs"]), "test-only", "the engine's own tests want a correctness review");
  assert.equal(narrowTier([".github/workflows/ai-code-review.yml", ".github/actions/setup/action.yml", ".github/dependabot.yml"]), "ci-only");
  for (const path of ["scripts/ai-review/run-review.mjs", "scripts/ai-review/agents/qa.md", "opencode.jsonc", "opencode.ci.jsonc", "scripts/test-assist-ci-batch.sh", "scripts/ci-telemetry/o2_llm_trace.py", "scripts/x.js", ".github/CODEOWNERS"]) {
    assert.equal(isCiOnlyPath(path), false, `${path} is code, not CI config`);
  }
  assert.equal(narrowTier([".github/workflows/ai-code-review.yml", "scripts/ai-review/run-review.mjs"]), "", "the review engine takes the normal tiers");
  assert.equal(narrowTier(["tests/ui-testing/a.spec.js", "src/service/search.rs"]), "");
  assert.equal(narrowTier([".github/workflows/x.yml", "web/src/App.vue"]), "");
  assert.equal(narrowTier([".github/workflows/x.yml", "tests/api-testing/test_x.py"]), "", "a mix is neither narrow set");
  assert.equal(narrowTier([]), "");
  for (const path of ["src/service/search.rs", "web/src/App.vue", "scripts/translations/main.py", "contest/a.rs", "latest/x.ts"]) {
    assert.equal(isTestOnlyPath(path), false, path);
    assert.equal(isCiOnlyPath(path), false, path);
  }
});

test("dependency-bot, docs-only and translation-only PRs need no review; anything else, or an empty file list, does", () => {
  const bot = (login, extra = {}) => ({ author: login, committer: "web-flow", verified: true, ...extra });
  assert.equal(nothingToReviewReason({ author: "dependabot[bot]", commits: [bot("dependabot[bot]"), bot("dependabot[bot]")], paths: ["Cargo.toml"] }), "bot_author");
  assert.equal(nothingToReviewReason({ author: "renovate[bot]", commits: [bot("renovate[bot]", { committer: "renovate[bot]" })], paths: ["web/package.json"] }), "bot_author");
  const reviewed = {
    "a person's commit": bot("alice"),
    "an unlinked commit author": bot(""),
    "a person as committer": bot("dependabot[bot]", { committer: "alice" }),
    "a missing committer": bot("dependabot[bot]", { committer: "" }),
    "an unverified signature": bot("dependabot[bot]", { verified: false }),
    "another bot's commit": bot("renovate[bot]"),
  };
  for (const [why, commit] of Object.entries(reviewed)) {
    assert.equal(nothingToReviewReason({ author: "dependabot[bot]", commits: [bot("dependabot[bot]"), commit], paths: ["Cargo.toml"] }), "", why);
  }
  assert.equal(nothingToReviewReason({ author: "dependabot[bot]", commits: [], paths: ["Cargo.toml"] }), "", "a failed commit listing reviews");
  for (const author of ["github-actions[bot]", "Copilot", "o2-ai-bot[bot]", "Dependabot[bot]"]) {
    assert.equal(nothingToReviewReason({ author, commits: [bot(author)], paths: ["src/a.rs"] }), "", `${author} is reviewed`);
  }
  assert.equal(nothingToReviewReason({ author: "alice", paths: ["README.md", "docs/setup.txt", "web/README.MD"] }), "docs_only");
  assert.equal(nothingToReviewReason({ author: "alice", paths: ["web/src/locales/languages/fr.json", "web/src/locales/languages/de.json", "scripts/translations/.translation_state.json"] }), "translation_only");
  assert.equal(nothingToReviewReason({ author: "alice", paths: ["web/src/locales/languages/en-US.json"] }), "", "the English source is written by a person");
  assert.equal(nothingToReviewReason({ author: "alice", paths: ["web/src/locales/languages/fr.json", "web/src/App.vue"] }), "");
  assert.equal(nothingToReviewReason({ author: "alice", paths: ["README.md", "src/main.rs"] }), "");
  assert.equal(nothingToReviewReason({ author: "alice", paths: ["web/src/locales/dbmMessages.spec.ts"] }), "");
  assert.equal(nothingToReviewReason({ author: "alice", paths: [] }), "", "a failed file listing must never skip a review");
});

test("skip-check.mjs prints the reason the workflow step reads, and nothing when the PR is reviewed", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-skip-"));
  try {
    const list = join(dir, "files.txt");
    const commits = join(dir, "commits.txt");
    const run = (files, env = {}, authors = null) => {
      writeFileSync(list, files.join("\n"));
      env = { EXPECTED_FILES: String(files.length), EXPECTED_COMMITS: String(authors?.length ?? 0), ...env };
      // The workflow's jq output: one login per line, newline-terminated.
      if (authors) writeFileSync(commits, authors.map(a => `${a}\n`).join(""));
      const args = authors ? [list, commits] : [list];
      const out = spawnSync(process.execPath, [new URL("../skip-check.mjs", import.meta.url).pathname, ...args], { encoding: "utf-8", env: { PATH: process.env.PATH, ...env } });
      assert.equal(out.status, 0, out.stderr);
      return out.stdout;
    };
    assert.equal(run(["docs/a.md"], { PR_AUTHOR: "alice" }), "docs_only");
    const ok = "renovate[bot]\tweb-flow\ttrue";
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }, [ok, "renovate[bot]\trenovate[bot]\ttrue"]), "bot_author");
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }, [ok, "\tweb-flow\ttrue"]), "", "an unlinked commit author is not the bot");
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }, [ok, "renovate[bot]\tweb-flow\tfalse"]), "", "an unverified commit reviews");
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }, [ok, "renovate[bot]\tweb-flow\t"]), "", "a missing verification reviews");
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }, [ok, "renovate[bot]"]), "", "a short line reviews");
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }, []), "", "a failed commit listing reviews");
    assert.equal(run(["src/a.rs"], { PR_AUTHOR: "renovate[bot]" }), "", "no commit file reviews");
    assert.equal(run(["src/a.rs", "docs/a.md"], { PR_AUTHOR: "alice" }), "");
    assert.equal(run([], { PR_AUTHOR: "alice" }), "");
    assert.equal(run(["docs/new.md\tdocs/old.md"], { PR_AUTHOR: "alice" }), "docs_only", "a rename is one listed file");
    assert.equal(run(["docs/new.md\tsrc/old.rs"], { PR_AUTHOR: "alice" }), "", "a rename source outside docs reviews");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file or commit listing that may be cut short never skips a review", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-skip-"));
  try {
    const list = join(dir, "files.tsv");
    const commits = join(dir, "commits.tsv");
    const run = (fileCount, commitCount, env) => {
      writeFileSync(list, Array.from({ length: fileCount }, (_, i) => `docs/a${i}.md`).join("\n"));
      writeFileSync(commits, Array.from({ length: commitCount }, () => "renovate[bot]\tweb-flow\ttrue\n").join(""));
      const out = spawnSync(process.execPath, [new URL("../skip-check.mjs", import.meta.url).pathname, list, commits], { encoding: "utf-8", env: { PATH: process.env.PATH, PR_AUTHOR: "alice", ...env } });
      assert.equal(out.status, 0, out.stderr);
      return out.stdout;
    };
    assert.equal(run(2, 1, { EXPECTED_FILES: "2", EXPECTED_COMMITS: "1" }), "docs_only");
    assert.equal(run(3000, 1, { EXPECTED_FILES: "3000", EXPECTED_COMMITS: "1" }), "", "the files endpoint stops at 3000");
    assert.equal(run(3000, 1, { EXPECTED_FILES: "3200", EXPECTED_COMMITS: "1" }), "");
    assert.equal(run(2, 1, { EXPECTED_FILES: "3", EXPECTED_COMMITS: "1" }), "", "a listing shorter than the PR's own count");
    assert.equal(run(2, 1, { EXPECTED_FILES: "2", EXPECTED_COMMITS: "2" }), "");
    assert.equal(run(2, 250, { EXPECTED_FILES: "2", EXPECTED_COMMITS: "250" }), "", "the commits endpoint stops at 250");
    assert.equal(run(2, 1, {}), "", "unknown PR counts review");
    assert.equal(run(2, 1, { EXPECTED_FILES: "two", EXPECTED_COMMITS: "1" }), "");
    assert.equal(listingComplete({ files: 2, commits: 1, expectedFiles: "2", expectedCommits: "1" }), true);
    assert.equal(listingComplete({ files: 2999, commits: 249, expectedFiles: "2999", expectedCommits: "249" }), true);
    assert.equal(listingComplete({ files: 250, commits: 250, expectedFiles: "250", expectedCommits: "250" }), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the workflow skips nothing-to-review PRs before installing anything, and lets a hand-started run force a review", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/ai-code-review.yml", import.meta.url), "utf-8");
  const skipAt = workflow.indexOf("- name: Skip PRs with nothing to review");
  assert.ok(skipAt > workflow.indexOf("- name: Check out review engine"), "the check runs from the engine checkout");
  for (const later of ["- name: Defer to a paired o2-enterprise PR", "- name: Install engine dependencies", "- name: Install opencode", "- name: Run AI Code Review"]) {
    assert.ok(skipAt < workflow.indexOf(later), later);
  }
  const step = workflow.slice(skipAt, workflow.indexOf("\n\n", skipAt));
  assert.match(step, /if: env\.REVIEW_RUN == 'true' && github\.event_name == 'pull_request_target'/);
  assert.match(step, /reason="\$\(node engine\/scripts\/ai-review\/skip-check\.mjs "\$list" "\$commits"\)" \|\| reason=""/, "a failed check must review, not skip");
  assert.match(step, /pulls\/\$PR_NUMBER\/commits/);
  assert.match(step, /\.committer\.login \/\/ ""/);
  assert.match(step, /\.commit\.verification\.verified \/\/ ""/);
  assert.match(step, /EXPECTED_FILES: \$\{\{ steps\.pr\.outputs\.changed_files \}\}/);
  assert.match(step, /EXPECTED_COMMITS: \$\{\{ steps\.pr\.outputs\.commit_count \}\}/);
  assert.match(step, /\[\.filename, \(\.previous_filename \/\/ ""\)\] \| @tsv/, "one line per listed file, so the count can be checked");
  assert.match(workflow, /echo "changed_files=\$\(jq -r '\.changed_files \/\/ ""'/);
  assert.match(workflow, /echo "commit_count=\$\(jq -r '\.commits \/\/ ""'/);
  assert.doesNotMatch(step, /set -[a-z]*e/, "set -e would end the step on a failed listing instead of reviewing");
  assert.match(step, /REVIEW_RUN=false/);
  assert.match(workflow, /REVIEW_MANUAL_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
});

test("markdown that steers the AI or CI is not docs-only", () => {
  for (const p of ["README.md", "docs/guide/a.md"]) assert.equal(isDocsPath(p), true, p);
  for (const p of ["scripts/ai-review/agents/coordinator.md", "AGENTS.md", "web/CLAUDE.md", ".claude/skills/x/SKILL.md", ".agents/skills/x/SKILL.md", ".agents/README.md", ".github/PULL_REQUEST_TEMPLATE.md"]) assert.equal(isDocsPath(p), false, p);
});

test("every instruction loader the sanitizer removes, at any depth and case, is reviewed rather than skipped as docs", () => {
  const paths = ["CONTEXT.md", "src/Context.md", "web/agents.md", "web/.claude/skills/x/SKILL.md", "web/.agents/skills/x/SKILL.md", "web/.opencode/agents/reviewer.md", "docs/.Claude/notes.md"];
  for (const name of LOADER_FILES) if (name.endsWith(".md")) paths.push(`docs/deep/${name.toUpperCase()}`);
  for (const dir of LOADER_DIRS) paths.push(`docs/${dir}/guide.md`);
  for (const p of paths) {
    assert.equal(isSensitivePath(p), true, `the approval gate already treats ${p} as an instruction loader`);
    assert.equal(isDocsPath(p), false, p);
    assert.equal(nothingToReviewReason({ author: "alice", paths: [p] }), "", p);
  }
  for (const p of ["docs/context-menu.md", "web/agents-guide.md", "docs/claude/notes.md"]) assert.equal(isDocsPath(p), true, p);
});
