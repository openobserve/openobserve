import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewPayload,
  existingFingerprints,
  extractInlineBlock,
  fingerprint,
  fingerprintMarker,
  rightSideLines,
  selectInlineComments,
} from "../src/inline.mjs";

const DIFF = [
  "diff --git a/src/lib.rs b/src/lib.rs",
  "index 111..222 100644",
  "--- a/src/lib.rs",
  "+++ b/src/lib.rs",
  "@@ -10,4 +10,5 @@ fn main() {",
  " ctx10",
  "-removed",
  "+added11",
  "+added12",
  " ctx13",
  "",
  "@@ -40 +41 @@",
  "-old",
  "+new41",
  "\\ No newline at end of file",
  "diff --git a/gone.rs b/gone.rs",
  "deleted file mode 100644",
  "--- a/gone.rs",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-x",
  "-y",
  "diff --git a/new.ts b/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.ts",
  "@@ -0,0 +1,2 @@",
  "++++ not a header",
  "+two",
].join("\n");

test("right-side anchors are the added and context lines of each hunk", () => {
  const lines = rightSideLines(DIFF);
  assert.deepEqual([...lines.get("src/lib.rs")].sort((a, b) => a - b), [10, 11, 12, 13, 14, 41]);
  assert.equal(lines.has("gone.rs"), false);
  assert.deepEqual([...lines.get("new.ts")], [1, 2]);
});

test("the inline block is parsed and cut out of the summary, fenced or not", () => {
  const review = [
    "## 🔎 OpenObserve Code Review",
    "",
    "body",
    "",
    "```",
    "<!-- ai-review-inline",
    '[{"file": "./src/lib.rs", "line": "11", "severity": "Critical", "category": "Code Quality", "title": "Bug <!-- x -->", "body": "Fix it"}]',
    "-->",
    "```",
  ].join("\n");
  const out = extractInlineBlock(review);
  assert.equal(out.text, "## 🔎 OpenObserve Code Review\n\nbody");
  assert.equal(out.error, null);
  assert.deepEqual(out.findings, [
    { file: "src/lib.rs", line: 11, severity: "p0", category: "Code Quality", title: "Bug", body: "Fix it" },
  ]);
});

test("nested or unterminated comment openers in finding text are stripped", () => {
  const block = (title, body) => `<!-- ai-review-inline\n${JSON.stringify([{ file: "src/lib.rs", line: 11, severity: "p2", title, body }])}\n-->`;
  const [f] = extractInlineBlock(block("A <!<!---->-- x --> B", "tail <!-- open")).findings;
  assert.equal(f.title.includes("<!--"), false);
  assert.equal(f.body.includes("<!--"), false);
  assert.equal(f.body, "tail  open");
});

test("a missing or malformed inline block leaves the summary intact and yields no findings", () => {
  assert.deepEqual(extractInlineBlock("## Review\nok").findings, []);
  const bad = extractInlineBlock("## Review\n<!-- ai-review-inline\n[{oops\n-->");
  assert.equal(bad.text, "## Review");
  assert.deepEqual(bad.findings, []);
  assert.match(bad.error, /not valid JSON/);
});

test("an entry that cannot be counted leaves the count unknown, and the readable ones still post", () => {
  const good = { file: "src/lib.rs", line: 11, severity: "p2", title: "Bug" };
  const block = entries => `<!-- ai-review-inline ${JSON.stringify(entries)} -->`;
  const uncountable = [
    { file: "src/lib.rs", line: 11, severity: "p1", description: "no title" },
    { title: "", severity: "p1" },
    { title: "no severity" },
    { title: "bad grade", severity: "blocker" },
    "p1",
    null,
  ];
  for (const entry of uncountable) {
    const out = extractInlineBlock(block([good, entry]));
    assert.match(out.error, /cannot be counted/, JSON.stringify(entry));
    assert.ok(out.findings.some(f => f.title === "Bug"), JSON.stringify(entry));
  }
  assert.equal(extractInlineBlock(block([{ ...good, severity: "Critical" }])).error, null);
  assert.equal(extractInlineBlock(block([])).error, null);
});

test("a second inline block is never read, so it leaves the count unknown", () => {
  const out = extractInlineBlock(`<!-- ai-review-inline [] -->\n<!-- ai-review-inline [{"title":"x","severity":"p0"}] -->`);
  assert.match(out.error, /cannot be counted/);
  assert.equal(out.text.includes("ai-review-inline"), false);
});

test("only p0, p1 and p2 findings on valid anchors are selected, most severe first, capped", () => {
  const lines = rightSideLines(DIFF);
  const f = (severity, file, line, title) => ({ severity, file, line, title, body: "" });
  const { selected, dropped } = selectInlineComments([
    f("p2", "src/lib.rs", 12, "warn"),
    f("p0", "src/lib.rs", 11, "crit"),
    f("p3", "src/lib.rs", 11, "nit"),
    f("p0", "src/lib.rs", 20, "outside the hunk"),
    f("p0", "other.rs", 1, "file not in diff"),
    f("p2", "src/lib.rs", 0, "no line"),
    f("p2", "src/lib.rs", 13, "Crit!"),
    f("p2", "src/lib.rs", 13, "crit"),
    f("p2", "new.ts", 1, "over the cap"),
  ], lines, new Set(), 2);
  assert.deepEqual(selected.map(s => s.title), ["crit", "warn"]);
  assert.equal(selected[0].fingerprint, fingerprint("src/lib.rs", "crit"));
  assert.deepEqual(dropped, { severity: 1, anchor: 3, duplicate: 2, cap: 1 });
});

test("p1 sorts between p0 and p2 and parsed legacy severities reach the right threads", () => {
  const block = `<!-- ai-review-inline\n${JSON.stringify([
    { file: "src/lib.rs", line: 11, severity: "warning", title: "two" },
    { file: "src/lib.rs", line: 12, severity: "P1", title: "one" },
    { file: "src/lib.rs", line: 13, severity: "suggestion", title: "three" },
    { file: "src/lib.rs", line: 14, severity: "critical", title: "zero" },
  ])}\n-->`;
  const { selected, dropped } = selectInlineComments(extractInlineBlock(block).findings, rightSideLines(DIFF));
  assert.deepEqual(selected.map(s => [s.title, s.severity]), [["zero", "p0"], ["one", "p1"], ["two", "p2"]]);
  assert.equal(dropped.severity, 1);
});

test("fingerprints already posted by the bot are skipped; other authors are ignored", () => {
  const fp = fingerprint("src/lib.rs", "crit");
  const comments = [
    { user: { login: "o2-reviewer[bot]" }, body: `x\n\n${fingerprintMarker(fp)}` },
    { user: { login: "mallory" }, body: fingerprintMarker(fingerprint("src/lib.rs", "warn")) },
  ];
  const posted = existingFingerprints(comments, "o2-reviewer[bot]");
  assert.deepEqual([...posted], [fp]);
  assert.equal(existingFingerprints(comments, "").size, 0);
  const { selected, dropped } = selectInlineComments([
    { severity: "p0", file: "src/lib.rs", line: 11, title: "  CRIT. ", body: "" },
    { severity: "p2", file: "src/lib.rs", line: 12, title: "warn", body: "" },
  ], rightSideLines(DIFF), posted);
  assert.deepEqual(selected.map(s => s.title), ["warn"]);
  assert.equal(dropped.duplicate, 1);
});

test("the review payload comments only, on the RIGHT side, with the fingerprint after the scrubbed text", () => {
  const selected = [{ severity: "p0", category: "Security", file: "src/lib.rs", line: 11, title: "t", body: "b", fingerprint: "a".repeat(40) }];
  const payload = buildReviewPayload(selected, "abc123", "summary", text => text.toUpperCase());
  assert.equal(payload.event, "COMMENT");
  assert.equal(payload.commit_id, "abc123");
  assert.deepEqual(Object.keys(payload.comments[0]), ["path", "line", "side", "body"]);
  assert.equal(payload.comments[0].side, "RIGHT");
  assert.equal(payload.comments[0].body, `**🔴 P0 · SECURITY:** T\n\nB\n\n<!-- ai-review-fp:${"a".repeat(40)} -->`);
  assert.equal("commit_id" in buildReviewPayload(selected, "", "s"), false);
});
