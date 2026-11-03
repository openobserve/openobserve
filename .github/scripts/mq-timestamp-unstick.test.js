#!/usr/bin/env node
// Run with: node --test .github/scripts/mq-timestamp-unstick.test.js (runs before the reaper acts).
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluateEntry, run, markerFor } = require("./mq-timestamp-unstick.js");

const NOW = Date.parse("2026-11-01T10:20:00Z");
const entry = (over = {}) => ({
  state: "AWAITING_CHECKS",
  enqueuedAt: "2026-11-01T09:50:00Z",
  headCommit: { oid: "abc123def456" },
  pullRequest: { number: 16139, headRefOid: "fff000" },
  ...over,
});
const checkRun = (name, over = {}) => ({
  __typename: "CheckRun",
  databaseId: 1000 + name.length,
  name,
  status: "COMPLETED",
  conclusion: "SUCCESS",
  startedAt: "2026-11-01T09:53:00Z",
  completedAt: "2026-11-01T10:05:00Z",
  detailsUrl: `https://example.test/job/${name}`,
  isRequired: true,
  checkSuite: {
    workflowRun: { databaseId: 41290642768, createdAt: "2026-11-01T09:52:10Z", updatedAt: "2026-11-01T10:05:00Z" },
  },
  ...over,
});
const status = (context, state = "SUCCESS") => ({
  __typename: "StatusContext",
  context,
  state,
  createdAt: "2026-11-01T09:55:00Z",
  isRequired: true,
});
const rollup = (nodes, hasNextPage = false) => ({ contexts: { pageInfo: { hasNextPage }, nodes } });
// Real incident: run created 09:52:10Z, unit_tests_summary completed_at 09:21:49Z.
const stale = checkRun("unit_tests_summary", {
  startedAt: "2026-11-01T09:21:40Z",
  completedAt: "2026-11-01T09:21:49Z",
});
const healthy = () => [
  checkRun("ci-gate"),
  checkRun("playwright_summary", { conclusion: "SKIPPED" }),
  status("ent-build-status-check"),
];

test("acts on the incident signature and picks the offending job", () => {
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), stale]),
    headRollup: rollup(healthy()),
    now: NOW,
  });
  assert.strictEqual(v.act, true);
  assert.deepStrictEqual(
    v.offenders.map((o) => o.name),
    ["unit_tests_summary"],
  );
});

test("skips when timestamps are sane (not this bug)", () => {
  const v = evaluateEntry({ entry: entry(), mgRollup: rollup(healthy()), headRollup: rollup(healthy()), now: NOW });
  assert.strictEqual(v.act, false);
  assert.match(v.reason, /not this bug/);
});

test("tolerates skipped jobs reporting completedAt a second before run creation", () => {
  const skipped = checkRun("api_tests_summary", {
    conclusion: "SKIPPED",
    startedAt: "2026-11-01T09:52:11Z",
    completedAt: "2026-11-01T09:52:09Z",
  });
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), skipped]),
    headRollup: rollup(healthy()),
    now: NOW,
  });
  assert.strictEqual(v.act, false);
});

test("skips while a required check is still running", () => {
  const running = checkRun("ui_code_quality", { status: "IN_PROGRESS", conclusion: null, completedAt: null });
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), stale, running]),
    headRollup: rollup(healthy()),
    now: NOW,
  });
  assert.strictEqual(v.act, false);
  assert.match(v.reason, /still running: ui_code_quality/);
});

test("skips when a required check failed", () => {
  const failed = checkRun("db_tests_summary", { conclusion: "FAILURE" });
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), stale, failed]),
    headRollup: rollup(healthy()),
    now: NOW,
  });
  assert.strictEqual(v.act, false);
  assert.match(v.reason, /db_tests_summary=FAILURE/);
});

test("skips when a check required on the PR is missing from the merge-group commit", () => {
  const head = rollup([...healthy(), checkRun("js-license-check")]);
  const v = evaluateEntry({ entry: entry(), mgRollup: rollup([...healthy(), stale]), headRollup: head, now: NOW });
  assert.strictEqual(v.act, false);
  assert.match(v.reason, /not reported yet: js-license-check/);
});

test("waits for the settle window after the last trustworthy finish signal", () => {
  const justNow = Date.parse("2026-11-01T10:07:00Z");
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), stale]),
    headRollup: rollup(healthy()),
    now: justNow,
  });
  assert.strictEqual(v.act, false);
  assert.match(v.reason, /waiting 5m/);
});

test("skips non-AWAITING_CHECKS entries and truncated rollups", () => {
  assert.strictEqual(evaluateEntry({ entry: entry({ state: "MERGEABLE" }), now: NOW }).act, false);
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), stale], true),
    headRollup: rollup(healthy()),
    now: NOW,
  });
  assert.match(v.reason, /more than 100/);
});

test("takes one offending job per workflow run, preferring the summary job", () => {
  const stale2 = checkRun("ui_code_quality", { databaseId: 9, completedAt: "2026-11-01T09:04:57Z" });
  const v = evaluateEntry({
    entry: entry(),
    mgRollup: rollup([...healthy(), stale2, stale]),
    headRollup: rollup(healthy()),
    now: NOW,
  });
  assert.deepStrictEqual(
    v.offenders.map((o) => o.name),
    ["unit_tests_summary"],
  );
});

function fakes({ comments = [], runAttempt = 1 } = {}) {
  const writes = [];
  const github = {
    graphql: async (q) =>
      q.includes("mergeQueue")
        ? { repository: { mergeQueue: { entries: { nodes: [entry()] } } } }
        : {
            repository: {
              mg: { statusCheckRollup: rollup([...healthy(), stale]) },
              head: { statusCheckRollup: rollup(healthy()) },
            },
          },
    paginate: async () => comments,
    rest: { issues: { listComments: () => {}, createComment: async (p) => writes.push(["comment", p]) } },
    request: async (route, p) => {
      if (route.startsWith("GET")) return { data: { run_attempt: runAttempt } };
      writes.push([route, p]);
      return { data: {} };
    },
  };
  const summary = { addHeading: () => summary, addRaw: () => summary, addTable: () => summary, write: async () => {} };
  const core = { info: () => {}, warning: () => {}, summary };
  const context = { repo: { owner: "o", repo: "r" }, serverUrl: "https://github.com" };
  return { github, core, context, writes };
}

test("run re-runs the job and posts one marked comment", async () => {
  const f = fakes();
  await run({ ...f, dryRun: false, now: NOW });
  assert.deepStrictEqual(
    f.writes.map((w) => w[0]),
    ["POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun", "comment"],
  );
  assert.ok(f.writes[1][1].body.startsWith(markerFor("abc123def456")));
});

test("run makes no writes in dry-run, with a marker, or on a re-run attempt", async () => {
  for (const opts of [{}, { comments: [{ body: markerFor("abc123def456") }] }, { runAttempt: 2 }]) {
    const f = fakes(opts);
    await run({ ...f, dryRun: Object.keys(opts).length === 0, now: NOW });
    assert.deepStrictEqual(f.writes, []);
  }
});
