import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRawDiff, sizeReasons } from "../src/auto-approve.mjs";
import { fetchDiff, localDiff, pinDiff, prefixDiffPaths } from "../src/pr-diff.mjs";

const DIFF = [
  "diff --git a/src/lib.rs b/src/lib.rs",
  "index 111..222 100644",
  "--- a/src/lib.rs",
  "+++ b/src/lib.rs",
  "@@ -1,2 +1,2 @@",
  "--- a/not-a-header",
  "+++ b/not-a-header",
  " ctx",
  "diff --git a/old.rs b/new.rs",
  "similarity index 90%",
  "rename from old.rs",
  "rename to new.rs",
  "diff --git a/img.png b/img.png",
  "Binary files a/img.png and b/img.png differ",
  "diff --git a/gone.rs b/gone.rs",
  "deleted file mode 100644",
  "--- a/gone.rs",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-x",
].join("\n");

test("prefixes paths in headers only, never in hunk content", () => {
  const out = prefixDiffPaths(DIFF, "openobserve").split("\n");
  assert.equal(out[0], "diff --git a/openobserve/src/lib.rs b/openobserve/src/lib.rs");
  assert.equal(out[2], "--- a/openobserve/src/lib.rs");
  assert.equal(out[3], "+++ b/openobserve/src/lib.rs");
  assert.equal(out[5], "--- a/not-a-header");
  assert.equal(out[6], "+++ b/not-a-header");
  assert.equal(out[8], "diff --git a/openobserve/old.rs b/openobserve/new.rs");
  assert.equal(out[10], "rename from openobserve/old.rs");
  assert.equal(out[11], "rename to openobserve/new.rs");
  assert.equal(out[13], "Binary files a/openobserve/img.png and b/openobserve/img.png differ");
  assert.equal(out[16], "--- a/openobserve/gone.rs");
  assert.equal(out[17], "+++ /dev/null");
  assert.equal(prefixDiffPaths(DIFF, ""), DIFF);
});

test("falls back to a local merge-base diff when the API refuses a large diff", () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "gh") {
      const err = new Error("HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000)");
      throw err;
    }
    return "local diff";
  };
  const out = fetchDiff({ repo: "o/r", prNumber: 7, prDir: "/pr", mergeBase: "base", head: "head", run });
  assert.equal(out, "local diff");
  assert.deepEqual(calls[1], [
    "git", "-C", "/pr", "-c", "core.attributesFile=/dev/null",
    "diff", "--no-ext-diff", "--no-textconv", "--text", "-M", "base", "head",
  ]);
});

test("without a merge base an API failure is fatal", () => {
  const run = () => { throw new Error("HTTP 406 too large"); };
  assert.throws(() => fetchDiff({ repo: "o/r", prNumber: 7, run }), /HTTP 406/);
});

test("local diff ignores .gitattributes diff drivers and binary marking", t => {
  const dir = mkdtempSync(join(tmpdir(), "pr-diff-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a.rs"), "fn a() {}\n");
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, ".gitattributes"), "*.rs binary -diff\n");
  writeFileSync(join(dir, "a.rs"), "fn a() { evil() }\n");
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "head");
  const head = git("rev-parse", "HEAD").trim();
  const out = localDiff(dir, base, head);
  assert.match(out, /\+fn a\(\) \{ evil\(\) \}/);
});

function repoWithCommits(t) {
  const dir = mkdtempSync(join(tmpdir(), "pr-diff-pin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  const commit = content => {
    writeFileSync(join(dir, "a.rs"), content);
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "c");
    return git("rev-parse", "HEAD").trim();
  };
  return { dir, base: commit("fn a() {}\n"), head: commit("fn a() { b() }\n"), later: commit("fn a() { pushed_later() }\n") };
}

test("a pinned diff is the diff of the named commits, not what the API returned", t => {
  const { dir, base, head } = repoWithCommits(t);
  const pin = pinDiff({ diff: "api diff of a newer push", candidate: true, prDir: dir, mergeBase: base, head });
  assert.equal(pin.pinned, true);
  assert.match(pin.diff, /\+fn a\(\) \{ b\(\) \}/);
  assert.equal(pin.diff.includes("pushed_later"), false);
});

test("the size check accepts what the local diff produces", t => {
  const { dir, base, head } = repoWithCommits(t);
  const parsed = parseRawDiff(pinDiff({ diff: "", candidate: true, prDir: dir, mergeBase: base, head }).diff);
  assert.deepEqual(sizeReasons(parsed), []);
  assert.deepEqual([parsed.fileCount, parsed.changedLines], [1, 2]);
});

test("a diff that cannot be pinned stays the API diff and says so", t => {
  const { dir, base, head } = repoWithCommits(t);
  const logs = [];
  const log = message => logs.push(message);
  const cases = [
    { prDir: dir, mergeBase: "0".repeat(40), head },
    { prDir: dir, mergeBase: "", head },
    { prDir: "", mergeBase: base, head },
    { prDir: dir, mergeBase: base, head: "" },
  ];
  for (const change of cases) assert.deepEqual(pinDiff({ diff: "api", candidate: true, log, ...change }), { diff: "api", pinned: false });
  assert.equal(logs.length, cases.length);
  assert.deepEqual(pinDiff({ diff: "api", candidate: true, prDir: dir, mergeBase: head, head }), { diff: "api", pinned: false });
});

test("a run that is not a candidate never diffs locally", () => {
  const run = () => { throw new Error("must not run"); };
  assert.deepEqual(pinDiff({ diff: "api", candidate: false, prDir: "/pr", mergeBase: "b", head: "h", run }), { diff: "api", pinned: false });
});
