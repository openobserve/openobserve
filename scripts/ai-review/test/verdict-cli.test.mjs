import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "a".repeat(40);
const REPO = "o/r";
const BOT = "o2-reviewer[bot]";

// A stand-in gh: GET paths answer from responses.json, every write is logged with its token and body.
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const dir = process.env.FAKE_DIR;
const args = process.argv.slice(2);
const path = args[1];
const method = args[args.indexOf("--method") + 1];
const input = args.includes("--input") ? fs.readFileSync(0, "utf-8") : "";
fs.appendFileSync(dir + "/calls.jsonl", JSON.stringify({ method, path, token: process.env.GH_TOKEN, body: input ? JSON.parse(input) : null }) + "\\n");
if (method !== "GET") { process.stdout.write("{}"); process.exit(0); }
const responses = JSON.parse(fs.readFileSync(dir + "/responses.json", "utf-8"));
if (!(path in responses)) { process.stderr.write("HTTP 404: " + path); process.exit(1); }
process.stdout.write(JSON.stringify(responses[path]));
`;

function run(t, script, env, responses) {
  const dir = mkdtempSync(join(tmpdir(), "verdict-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
  writeFileSync(join(dir, "responses.json"), JSON.stringify(responses));
  const result = spawnSync(process.execPath, [join(ROOT, script)], {
    encoding: "utf-8",
    env: { PATH: `${dir}:${process.env.PATH}`, FAKE_DIR: dir, GITHUB_REPOSITORY: REPO, GH_TOKEN: "actions-token", ...env },
  });
  const log = join(dir, "calls.jsonl");
  const calls = existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").map(l => JSON.parse(l)) : [];
  return { ...result, writes: calls.filter(c => c.method !== "GET") };
}

const statusOf = (state, description) => ({ statuses: [{ context: "ci-gate", state: "success" }, { context: "AI review verdict", state, description }] });

test("verdict-status posts a failure for significant concerns on the reviewed SHA", t => {
  const r = run(t, "verdict-status.mjs", { HEAD_SHA: SHA, BASIS: "reviewed", VERDICT: "significant_concerns", TARGET_URL: "https://run" }, {
    [`repos/${REPO}/commits/${SHA}/status?per_page=100`]: { statuses: [] },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].path, `repos/${REPO}/statuses/${SHA}`);
  assert.equal(r.writes[0].body.state, "failure");
  assert.equal(r.writes[0].body.context, "AI review verdict");
  assert.equal(r.writes[0].body.target_url, "https://run");
});

test("verdict-status leaves a dispute on the same SHA in place", t => {
  const r = run(t, "verdict-status.mjs", { HEAD_SHA: SHA, BASIS: "reviewed", VERDICT: "significant_concerns" }, {
    [`repos/${REPO}/commits/${SHA}/status?per_page=100`]: statusOf("success", "Disputed by @maint"),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.writes, []);
  assert.match(r.stdout, /kept "Disputed by @maint"/);
});

test("verdict-status refuses to run without a full head SHA", t => {
  const r = run(t, "verdict-status.mjs", { HEAD_SHA: "" }, {});
  assert.equal(r.status, 1);
  assert.deepEqual(r.writes, []);
});

const reviewBody = "<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n> [!CAUTION]\n> ### ⛔ Significant concerns\n<!-- o2-review-pass:1 -->";

function disputeResponses({ status = statusOf("failure", "Significant concerns"), permission = "write" } = {}) {
  return {
    [`repos/${REPO}/pulls/7`]: { state: "open", user: { login: "dev" }, head: { sha: SHA } },
    [`repos/${REPO}/commits/${SHA}/status?per_page=100`]: status,
    [`repos/${REPO}/collaborators/maint/permission`]: { permission },
    [`repos/${REPO}/issues/7/comments?per_page=100`]: [[
      { id: 1, user: { login: "mallory" }, body: "<!-- ai-code-review -->\nfake" },
      { id: 2, user: { login: BOT }, body: reviewBody },
    ]],
  };
}

const disputeEnv = body => ({
  PR_NUMBER: "7", COMMENT_ID: "99", COMMENT_URL: "https://c", COMMENTER: "maint", COMMENTER_TYPE: "User",
  COMMENT_BODY: body, BOT_TOKEN: "bot-token", BOT_LOGIN: BOT,
});

test("an accepted dispute sets success, reacts and notes it on the bot's review comment", t => {
  const r = run(t, "dispute.mjs", disputeEnv("/ai-review dispute the caller holds the lock"), disputeResponses());
  assert.equal(r.status, 0, r.stderr);
  const [status, reaction, note] = r.writes;
  assert.equal(r.writes.length, 3);
  assert.equal(status.path, `repos/${REPO}/statuses/${SHA}`);
  assert.deepEqual(status.body, { state: "success", context: "AI review verdict", description: "Disputed by @maint", target_url: "https://c" });
  assert.equal(status.token, "actions-token");
  assert.equal(reaction.path, `repos/${REPO}/issues/comments/99/reactions`);
  assert.equal(reaction.body.content, "+1");
  assert.equal(note.method, "PATCH");
  assert.equal(note.path, `repos/${REPO}/issues/comments/2`);
  assert.equal(note.token, "bot-token");
  assert.ok(note.body.body.startsWith(reviewBody));
  assert.match(note.body.body, /Disputed by @maint\*\* on `aaaaaaa`: the caller holds the lock$/);
});

test("a rejected dispute only replies, and leaves the status alone", t => {
  const r = run(t, "dispute.mjs", disputeEnv("/ai-review dispute nope"), disputeResponses({ permission: "read" }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].path, `repos/${REPO}/issues/7/comments`);
  assert.match(r.writes[0].body.body, /^@maint dispute not accepted: only users with write/);
  assert.equal(r.writes[0].token, "bot-token");
});

test("a dispute on a head commit without a blocking verdict is rejected", t => {
  const r = run(t, "dispute.mjs", disputeEnv("/ai-review dispute stale"), disputeResponses({ status: { statuses: [] } }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.writes.length, 1);
  assert.match(r.writes[0].body.body, /no blocking AI review verdict/);
});

test("a failed permission lookup rejects instead of accepting", t => {
  const responses = disputeResponses();
  delete responses[`repos/${REPO}/collaborators/maint/permission`];
  const r = run(t, "dispute.mjs", disputeEnv("/ai-review dispute x"), responses);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.writes.length, 1);
  assert.match(r.writes[0].body.body, /only users with write/);
});

test("an accepted dispute with no review comment to note still unblocks, but fails the job", t => {
  const responses = disputeResponses();
  responses[`repos/${REPO}/issues/7/comments?per_page=100`] = [[]];
  const r = run(t, "dispute.mjs", disputeEnv("/ai-review dispute x"), responses);
  assert.equal(r.status, 1);
  assert.equal(r.writes[0].body.state, "success");
  assert.match(r.stderr, /no review comment by o2-reviewer\[bot\]/);
});

test("a comment that is not the command writes nothing", t => {
  const r = run(t, "dispute.mjs", disputeEnv("/ai-review disputes"), disputeResponses());
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.writes, []);
});
