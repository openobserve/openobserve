import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRawDiff, sizeReasons } from "../src/auto-approve.mjs";
import { diffFingerprint, fetchDiff, fetchPinnedDiff, hunksLocatable, localDiff, pinDiff, prefixDiffPaths } from "../src/pr-diff.mjs";

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
  const pin = pinDiff({ diff: "api diff of a newer push", prDir: dir, mergeBase: base, head });
  assert.equal(pin.pinned, true);
  assert.match(pin.diff, /\+fn a\(\) \{ b\(\) \}/);
  assert.equal(pin.diff.includes("pushed_later"), false);
});

test("the size check accepts what the local diff produces", t => {
  const { dir, base, head } = repoWithCommits(t);
  const parsed = parseRawDiff(pinDiff({ diff: "", prDir: dir, mergeBase: base, head }).diff);
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
  for (const change of cases) assert.deepEqual(pinDiff({ diff: "api", log, ...change }), { diff: "api", pinned: false });
  assert.equal(logs.length, cases.length);
  assert.deepEqual(pinDiff({ diff: "api of a newer push", prDir: dir, mergeBase: head, head }), { diff: "", pinned: true });
});

test("a large diff from a newer push is replaced by the captured commit's diff, whatever its size", t => {
  const { dir, base, head } = repoWithCommits(t);
  const apiDiff = Array.from({ length: 500 }, (_, i) => `+pushed_later ${i}`).join("\n");
  const run = (cmd, args, options) => (cmd === "gh" ? apiDiff : execFileSync(cmd, args, { encoding: "utf-8", ...options }));
  const pin = fetchPinnedDiff({ repo: "o/r", prNumber: 1, prDir: dir, mergeBase: base, head, env: {}, run });
  assert.equal(pin.pinned, true);
  assert.equal(pin.diff.includes("pushed_later"), false);
  assert.match(pin.diff, /\+fn a\(\) \{ b\(\) \}/);
});

test("a fetched diff with no local proof stays usable but unpinned", () => {
  const run = cmd => { if (cmd === "git") throw new Error("no such commit"); return "api"; };
  assert.deepEqual(fetchPinnedDiff({ repo: "o/r", prNumber: 1, prDir: "/pr", mergeBase: "b", head: "h", env: {}, run }), { diff: "api", pinned: false });
  assert.deepEqual(fetchPinnedDiff({ repo: "o/r", prNumber: 1, prDir: "", mergeBase: "", head: "", env: {}, run }), { diff: "api", pinned: false });
});

function renameDiff(t, setup, rename) {
  const dir = mkdtempSync(join(tmpdir(), "pr-diff-rename-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "notes.md"), "a\n");
  setup(dir, git);
  git("add", "--", "notes.md");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  rename(dir, git);
  writeFileSync(join(dir, "notes.md"), "b\n");
  git("add", "--", "notes.md");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "head");
  return localDiff(dir, base, git("rev-parse", "HEAD").trim());
}

test("a renamed symlink or submodule whose header carries no mode cannot pass as a plain file", t => {
  const symlink = renameDiff(t, (dir, git) => {
    symlinkSync("/etc/passwd", join(dir, "link"));
    git("add", "link");
  }, (_, git) => git("mv", "link", "moved"));
  const gitlink = renameDiff(
    t,
    (_, git) => git("update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/x`),
    (_, git) => {
      git("update-index", "--force-remove", "vendor/x");
      git("update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/y`);
    },
  );
  for (const diff of [symlink, gitlink]) {
    assert.match(diff, /^similarity index 100%$/m);
    assert.deepEqual(parseRawDiff(diff).problems, ["a renamed file's type could not be read"], diff);
  }
  const edited = renameDiff(t, (dir, git) => {
    writeFileSync(join(dir, "a.md"), "1\n2\n3\n4\n5\n6\n");
    git("add", "a.md");
  }, (dir, git) => {
    git("mv", "a.md", "b.md");
    writeFileSync(join(dir, "b.md"), "1\n2\n3\n4\n5\n7\n");
    git("add", "b.md");
  });
  assert.match(edited, /^index \S+ 100644$/m);
  assert.deepEqual(parseRawDiff(edited).problems, []);
});

test("a rebase that moves the PR's lines keeps its diff fingerprint, a changed line does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-fingerprint-"));
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf-8" });
  try {
    git("init", "-q", "-b", "main");
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    writeFileSync(join(dir, "a.rs"), `${lines.join("\n")}\n`);
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "pr");
    writeFileSync(join(dir, "a.rs"), `${lines.map((l, i) => (i === 30 ? "line 30 changed" : l)).join("\n")}\n`);
    git("commit", "-qam", "pr change");
    const before = localDiff(dir, "main", "pr");
    git("checkout", "-q", "main");
    writeFileSync(join(dir, "a.rs"), `head 1\nhead 2\nhead 3\n${lines.join("\n")}\n`);
    git("commit", "-qam", "main moves on");
    git("checkout", "-q", "pr");
    git("rebase", "-q", "main");
    const after = localDiff(dir, "main", "pr");
    assert.notEqual(before, after, "the rebase must change hunk numbers and blob ids, or this test proves nothing");
    assert.equal(diffFingerprint(after), diffFingerprint(before));
    writeFileSync(join(dir, "a.rs"), `head 1\nhead 2\nhead 3\n${lines.map((l, i) => (i === 30 ? "line 30 changed again" : l)).join("\n")}\n`);
    git("commit", "-qam", "another change");
    assert.notEqual(diffFingerprint(localDiff(dir, "main", "pr")), diffFingerprint(before));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the fingerprint ignores only blob ids and hunk numbers", () => {
  const base = "diff --git a/a b/a\nindex 1111111..2222222 100644\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@ fn x\n ctx\n-old\n+new\n";
  assert.equal(diffFingerprint(base.replace("1111111..2222222", "3333333..4444444").replace("-1,2 +1,2 @@ fn x", "-9,2 +12,2 @@ fn x")), diffFingerprint(base));
  assert.notEqual(diffFingerprint(base.replace("@@ fn x", "@@ fn y")), diffFingerprint(base), "the function a hunk sits in is part of what was reviewed");
  assert.notEqual(diffFingerprint(base.replace("+new", "+newer")), diffFingerprint(base));
  assert.notEqual(diffFingerprint(base.replace("diff --git a/a b/a", "diff --git a/b b/b")), diffFingerprint(base));
  assert.match(diffFingerprint(base), /^[0-9a-f]{64}$/);
});

test("the same lines changed inside a different function get a different fingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-fingerprint-"));
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf-8" });
  const fn = (name, allowed = "user.active") => `function ${name}(user) {\n  const id = user.id;\n  const name = user.name;\n  const role = user.role;\n  const group = user.group;\n  const allowed = ${allowed};\n  const details = { id, name, role, group };\n  const present = Boolean(details);\n  const result = Boolean(allowed);\n  return present && result;\n}\n`;
  try {
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "rules.js"), `${fn("preview")}\n${fn("authorize")}`);
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "safe");
    writeFileSync(join(dir, "rules.js"), `${fn("preview", "true")}\n${fn("authorize")}`);
    git("commit", "-qam", "safe");
    git("checkout", "-qb", "unsafe", "main");
    writeFileSync(join(dir, "rules.js"), `${fn("preview")}\n${fn("authorize", "true")}`);
    git("commit", "-qam", "unsafe");
    const safe = localDiff(dir, "main", "safe");
    const unsafe = localDiff(dir, "main", "unsafe");
    assert.match(safe, /^@@ .* @@ function preview\(user\) \{$/m);
    assert.match(unsafe, /^@@ .* @@ function authorize\(user\) \{$/m);
    assert.notEqual(diffFingerprint(unsafe), diffFingerprint(safe));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an edit to one of two identical blocks in a function cannot be located, so it is never taken for the reviewed one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-fingerprint-"));
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf-8" });
  const block = (flag, allowed) => [`  if (${flag}) {`, "    const a = 1;", "    const b = 2;", "    const c = 3;", `    ok = ${allowed};`, "    const d = 4;", "    const e = 5;", "    const f = 6;", "  }"];
  const source = (first, second) => ["function check(user, internal) {", "  let ok = false;", ...block("internal", first), ...block("!internal", second), "  return ok;", "}", ""].join("\n");
  const readBase = ref => path => { try { return execFileSync("git", ["-C", dir, "cat-file", "blob", `${ref}:${path}`], { encoding: "utf-8" }); } catch { return null; } };
  try {
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "check.js"), source("user.admin", "user.admin"));
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "internal");
    writeFileSync(join(dir, "check.js"), source("true", "user.admin"));
    git("commit", "-qam", "internal");
    git("checkout", "-qb", "external", "main");
    writeFileSync(join(dir, "check.js"), source("user.admin", "true"));
    git("commit", "-qam", "external");
    const internal = localDiff(dir, "main", "internal");
    const external = localDiff(dir, "main", "external");
    assert.notEqual(internal, external);
    assert.equal(hunksLocatable(external, readBase("main")), false, "the edited block's old text sits twice in the base");
    assert.equal(hunksLocatable(internal, readBase("main")), false);
    writeFileSync(join(dir, "other.js"), "a\nb\nc\nd\ne\nf\ng\n");
    git("add", "other.js");
    git("commit", "-qm", "unique");
    writeFileSync(join(dir, "other.js"), "a\nb\nc\nD\ne\nf\ng\n");
    git("commit", "-qam", "edit unique");
    const unique = localDiff(dir, "HEAD~1", "HEAD");
    assert.equal(hunksLocatable(unique, readBase("HEAD~1")), true);
    assert.equal(hunksLocatable(unique, () => null), false, "an unreadable base file cannot locate the edit");
    assert.equal(hunksLocatable("diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+x\n", () => null), true, "a new file has nothing to locate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a changed binary file or trailing space on the last line changes the fingerprint", () => {
  const bin = id => `diff --git a/m.wasm b/m.wasm\nindex 1111111..${id} 100644\nBinary files a/m.wasm and b/m.wasm differ\n`;
  assert.notEqual(diffFingerprint(bin("2222222")), diffFingerprint(bin("3333333")));
  const csv = tail => `diff --git a/a.csv b/a.csv\nindex 1111111..2222222 100644\n--- a/a.csv\n+++ b/a.csv\n@@ -1 +1 @@\n-x\n+secret${tail}\n`;
  assert.notEqual(diffFingerprint(csv(" ")), diffFingerprint(csv("  ")));
});

test("a file mode change keeps a different fingerprint", () => {
  const d = mode => `diff --git a/l b/l\nindex 1111111..2222222 ${mode}\n--- a/l\n+++ b/l\n@@ -1 +1 @@\n-old-target\n\\ No newline at end of file\n+new-target\n\\ No newline at end of file\n`;
  assert.notEqual(diffFingerprint(d("100644")), diffFingerprint(d("120000")));
});
