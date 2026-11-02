import test from "node:test";
import assert from "node:assert/strict";

import {
  checkDispute,
  disputeDescription,
  disputeNote,
  gateStatus,
  parseDispute,
  verdictFromReview,
} from "../src/verdict.mjs";

const review = heading => `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n> [!CAUTION]\n> ### ${heading}\n> Explanation.\n`;
const disputed = { state: "success", description: "Disputed by @maint" };

test("the verdict is read from the callout heading", () => {
  assert.equal(verdictFromReview(review("⛔ Significant concerns")), "significant_concerns");
  assert.equal(verdictFromReview(review("⚠️ Minor issues")), "minor_issues");
  assert.equal(verdictFromReview(review("💬 Approved with comments")), "approved_with_comments");
  assert.equal(verdictFromReview(review("✅ Approved")), "approved");
  assert.equal(verdictFromReview(review("⛔ Not reviewed")), "not_reviewed");
});

test("text outside a heading, a placeholder or nothing gives no verdict", () => {
  assert.equal(verdictFromReview("> This PR has significant concerns, see below"), "unknown");
  assert.equal(verdictFromReview("<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n> [!NOTE]\n> Review in progress."), "unknown");
  assert.equal(verdictFromReview(""), "unknown");
  assert.equal(verdictFromReview(undefined), "unknown");
});

test("only significant concerns block", () => {
  assert.equal(gateStatus({ basis: "reviewed", verdict: "significant_concerns" }).state, "failure");
  for (const verdict of ["approved", "approved_with_comments", "minor_issues"]) {
    const status = gateStatus({ basis: "reviewed", verdict });
    assert.equal(status.state, "success", verdict);
    assert.doesNotMatch(status.description, /Not reviewed/, verdict);
  }
});

test("an infra failure, a missing verdict or an unknown one never blocks", () => {
  for (const input of [{}, { basis: "reviewed", verdict: "not_reviewed" }, { basis: "reviewed", verdict: "unknown" }, { verdict: "nonsense" }]) {
    const status = gateStatus(input);
    assert.equal(status.state, "success", JSON.stringify(input));
    assert.match(status.description, /^Not reviewed/, JSON.stringify(input));
  }
});

test("past the pass limit the last verdict is carried forward, blocking included", () => {
  const blocked = gateStatus({ basis: "pass_limit", verdict: "significant_concerns" });
  assert.equal(blocked.state, "failure");
  assert.match(blocked.description, /pass limit/);
  assert.match(blocked.description, /ignore_pass_limit/);
  assert.equal(gateStatus({ basis: "pass_limit", verdict: "approved" }).state, "success");
  assert.equal(gateStatus({ basis: "pass_limit", verdict: "unknown" }).state, "success");
});

test("forks, paired PRs and empty diffs pass without a review", () => {
  assert.deepEqual(gateStatus({ skip: "fork" }).state, "success");
  const paired = gateStatus({ pairedRef: "openobserve/o2-enterprise#12" });
  assert.equal(paired.state, "success");
  assert.match(paired.description, /o2-enterprise#12/);
  assert.equal(gateStatus({ basis: "no_changes", verdict: "none" }).state, "success");
});

test("a re-review never overwrites a dispute on the same commit with a failure", () => {
  assert.equal(gateStatus({ basis: "reviewed", verdict: "significant_concerns", current: disputed }), null);
  const fail = { state: "failure", description: "Significant concerns" };
  assert.equal(gateStatus({ basis: "reviewed", verdict: "significant_concerns", current: fail }).state, "failure");
  assert.equal(gateStatus({ basis: "reviewed", verdict: "approved", current: disputed }).state, "success");
  const lookalike = { state: "failure", description: "Disputed by @x" };
  assert.equal(gateStatus({ basis: "reviewed", verdict: "significant_concerns", current: lookalike }).state, "failure");
});

test("every description fits GitHub's 140-character status limit", () => {
  const inputs = [
    { basis: "pass_limit", verdict: "significant_concerns" },
    { basis: "reviewed", verdict: "significant_concerns" },
    { pairedRef: `openobserve/o2-enterprise#${"9".repeat(200)}` },
    {},
  ];
  for (const input of inputs) assert.ok(gateStatus(input).description.length <= 140, JSON.stringify(input));
  assert.ok(disputeDescription("a".repeat(200)).length <= 140);
});

test("the dispute command needs the exact prefix", () => {
  assert.equal(parseDispute("/ai-review dispute false positive: the lock is held by the caller"), "false positive: the lock is held by the caller");
  assert.equal(parseDispute("  /AI-Review dispute\n\nmulti\nline  "), "multi\nline");
  assert.equal(parseDispute("/ai-review dispute"), "");
  assert.equal(parseDispute("/ai-review dispute   "), "");
  assert.equal(parseDispute("/ai-review disputed it"), null);
  assert.equal(parseDispute("please /ai-review dispute this"), null);
  assert.equal(parseDispute(""), null);
  assert.equal(parseDispute(undefined), null);
});

const valid = {
  commenter: "maint",
  commenterType: "User",
  author: "dev",
  permission: "write",
  reason: "false positive",
  prState: "open",
  current: { state: "failure", description: "Significant concerns" },
};

test("a maintainer who is not the author can dispute a blocking verdict", () => {
  for (const permission of ["write", "maintain", "admin"]) {
    assert.deepEqual(checkDispute({ ...valid, permission }), { ok: true }, permission);
  }
});

test("each dispute rule rejects with its own reason", () => {
  const cases = [
    [{ prState: "closed" }, /not open/],
    [{ commenterType: "Bot" }, /bots/],
    [{ commenter: "renovate[bot]", commenterType: "User" }, /bots/],
    [{ commenter: "dev" }, /author/],
    [{ commenter: "" }, /author/],
    [{ permission: "read" }, /write, maintain or admin/],
    [{ permission: "triage" }, /write, maintain or admin/],
    [{ permission: "none" }, /write, maintain or admin/],
    [{ reason: "" }, /reason is required/],
    [{ current: null }, /no blocking/],
    [{ current: { state: "pending" } }, /no blocking/],
    [{ current: disputed }, /no blocking/],
  ];
  for (const [patch, reason] of cases) {
    const result = checkDispute({ ...valid, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.reason, reason, JSON.stringify(patch));
  }
});

test("the note names the commit and cannot plant markers or tags in the review comment", () => {
  const note = disputeNote("maint", "0123456789abcdef0123456789abcdef01234567", "ok <!-- o2-review-pass:0 --> <!-- ai-code-review -->\nnext");
  assert.match(note, /^> \*\*Disputed by @maint\*\* on `0123456`: /);
  assert.doesNotMatch(note.slice(2), /[<>]/);
  assert.doesNotMatch(note, /\n/);
  assert.ok(disputeNote("m", "0".repeat(40), "x".repeat(1000)).length < 400);
});
