import test from "node:test";
import assert from "node:assert/strict";

import { failedReviewersNote, insertAfterCallout, mapStrings } from "../src/report.mjs";

test("the failed-reviewer line names each reviewer and why it did not finish", () => {
  assert.equal(failedReviewersNote([], 6), "");
  assert.equal(
    failedReviewersNote([{ agentName: "Code Quality Reviewer", error: "opencode agent x timed out after 1200000ms", timedOut: true }], 6),
    "> ⚠️ 1 of 6 reviewers did not finish (Code Quality: timed out); its area was not reviewed.",
  );
  assert.equal(
    failedReviewersNote([
      { agentName: "Security Reviewer", error: "boom" },
      { agentName: "Release Reviewer", error: "opencode agent y timed out after 5ms" },
    ], 5),
    "> ⚠️ 2 of 5 reviewers did not finish (Security: failed, Release: timed out); their areas were not reviewed.",
  );
});

test("the line goes after the decision callout as its own blockquote", () => {
  const review = [
    "## 🔎 OpenObserve Code Review",
    "",
    "> [!CAUTION]",
    "> ### ⛔ Significant concerns",
    "> Explanation.",
    "",
    "**🔴 1 blocker**",
  ].join("\n");
  assert.equal(insertAfterCallout(review, "> ⚠️ note"), [
    "## 🔎 OpenObserve Code Review",
    "",
    "> [!CAUTION]",
    "> ### ⛔ Significant concerns",
    "> Explanation.",
    "",
    "> ⚠️ note",
    "",
    "**🔴 1 blocker**",
  ].join("\n"));
  assert.equal(insertAfterCallout(review, ""), review);
});

test("without a callout the line goes under the heading", () => {
  assert.equal(insertAfterCallout("## Review\nbody", "> ⚠️ note"), "## Review\n\n> ⚠️ note\n\nbody");
});

test("mapStrings cleans every string in nested data", () => {
  assert.deepEqual(
    mapStrings({ a: "x", b: [{ c: "x" }, 1, null], d: true }, s => s.toUpperCase()),
    { a: "X", b: [{ c: "X" }, 1, null], d: true },
  );
});
