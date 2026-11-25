import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { UsageError, buildSlotReport, main, parseCli, rejectionsOf, rowOfSlot, runOrder } from "../run-experiment.mjs";
import { fetchOpenRouterPricing } from "../src/experiment-api.mjs";
import { buildEngineEnv, checkoutPinned, effectiveSettings, engineIdentity, spawnEngine, taskIdentity, traceAuthFrom } from "../src/experiment-run.mjs";
import { SCORE_CONFIGS, matchFindings, scoreFindings, slotScores, titleMatch, usageFromSummary } from "../src/experiment-score.mjs";
import { acquireRunLock, clearEngineGroup, cooldownWaitMs, lockPortFor, readCooldown, recordEngineGroup, touchCooldown, workDirProblem } from "../src/experiment-state.mjs";
import { localDiff } from "../src/pr-diff.mjs";
import { exitWithParent } from "../src/parent-exit.mjs";
import { parseTokenPrices } from "../src/run-summary.mjs";

const TOKEN = "Basic dG9rZW46b2JzZXJ2ZS1zZWNyZXQ=";
const MODEL_KEY = "sk-or-v1-model-key-secret-0123456789";
const WRITE_TOKEN = "ghp_writeTokenMustNeverReachTheEngine1234567890"; // gitleaks:allow
const SLUG = "anthropic/claude-sonnet-5.5";
const ALLOWED_EXPERIMENT_KEYS = ["name", "description", "datasetId", "datasetVersion", "datasetFilter", "task", "scorers", "trialCount", "metadata", "idempotencyKey", "confirmCostEstimate"];
const ALLOWED_RECORD_KEYS = ["rowId", "trialIndex", "status", "output", "errorMessage", "errorAttemptCount", "skipMessage", "latencyMs", "tokensIn", "tokensOut", "cost", "traceId", "taskFingerprint", "executedAt"];
const ALLOWED_SCORE_KEYS = ["rowId", "trialIndex", "clientScorerKey", "scoreConfig", "value", "reasoning", "metadata"];

// ─── scoring ────────────────────────────────────────────────────────────────

const finding = (file, line, title) => ({ file, line, title, severity: "p1", category: "Correctness", body: "" });

test("a kept finding matches an expected one on the same file, a line within 5 and a matching title", () => {
  const expected = [finding("src/a.rs", 10, "Missing bounds check on parse")];
  const kept = (...f) => matchFindings(expected, f).length;
  assert.equal(kept(finding("src/a.rs", 10, "Missing bounds check on parse")), 1, "exact");
  assert.equal(kept(finding("src/a.rs", 15, "missing BOUNDS check on parse!")), 1, "five lines away, title equal once normalized");
  assert.equal(kept(finding("src/a.rs", 16, "Missing bounds check on parse")), 0, "six lines away");
  assert.equal(kept(finding("src/b.rs", 10, "Missing bounds check on parse")), 0, "another file");
  assert.equal(kept(finding("./src/a.rs", 9, "Missing bounds check on parse")), 1, "a leading ./ is not another file");
  assert.equal(kept(finding("src\\a.rs", 9, "Missing bounds check on parse")), 1, "nor a backslash");
  assert.equal(kept(finding("src/a.rs", 11, "Unrelated naming nit about variables")), 0, "right place, wrong subject");
});

test("a line either side lacks needs the title to match, and the title rule is two shared words covering half the longer title", () => {
  const expected = [finding("src/a.rs", 0, "Race between cache insert and eviction")];
  assert.equal(matchFindings(expected, [finding("src/a.rs", 40, "Race between cache insert and eviction")]).length, 1, "an unknown line is not held against an exact title");
  assert.equal(matchFindings(expected, [finding("src/a.rs", 0, "Cache insert races with eviction")]).length, 1, "shared words cache, insert, eviction");
  assert.equal(matchFindings(expected, [finding("src/a.rs", 0, "Completely different subject here")]).length, 0, "an unknown line without a title match");
  assert.equal(matchFindings(expected, [finding("src/a.rs", 0, "Race condition")]).length, 0, "one shared word is not enough");
  assert.equal(matchFindings([finding("src/a.rs", 5, "alpha beta gamma delta epsilon zeta")], [finding("src/a.rs", 5, "alpha beta something else entirely different words")]).length, 0, "two shared words but under half of the longer title");
  assert.deepEqual(titleMatch("", "x"), { ok: false, exact: false, shared: 0 });
  assert.equal(titleMatch("Same Title!", "same   title").exact, true);
});

test("matching is one-to-one, with the best pair taken first", () => {
  const expected = [finding("src/a.rs", 10, "Missing bounds check on parse")];
  const twoKept = [finding("src/a.rs", 14, "Missing bounds check on parse input"), finding("src/a.rs", 10, "Missing bounds check on parse")];
  assert.deepEqual(matchFindings(expected, twoKept), [[0, 1]], "the exact title on the nearest line wins");
  assert.deepEqual(scoreFindings(expected, twoKept), { matched: 1, recall: 1, newFindings: 1 });
  const twoExpected = [finding("src/a.rs", 10, "Missing bounds check on parse"), finding("src/a.rs", 12, "Missing bounds check on parse")];
  const one = scoreFindings(twoExpected, [finding("src/a.rs", 11, "Missing bounds check on parse")]);
  assert.deepEqual(one, { matched: 1, recall: 0.5, newFindings: 0 }, "one kept finding cannot satisfy two expected ones");
});

test("an empty expectation is fully recalled and every kept finding is new; no usable expectation scores cost and tokens only", () => {
  const usage = { cacheRead: 4000, cacheWrite: 9000 };
  const scoresOf = (expectedOutput, kept) => slotScores({ rowId: "r1", trialIndex: 0, usage, expectedOutput, kept }).map(s => [s.scoreConfig, s.value]);
  const kept = [finding("src/a.rs", 1, "A thing"), finding("src/b.rs", 2, "Another thing")];
  assert.deepEqual(scoresOf({ findings: [] }, kept), [[SCORE_CONFIGS.cacheWrite, 9000], [SCORE_CONFIGS.cacheRead, 4000], [SCORE_CONFIGS.recall, 1], [SCORE_CONFIGS.newFindings, 2]]);
  assert.deepEqual(scoresOf({ findings: [] }, []), [[SCORE_CONFIGS.cacheWrite, 9000], [SCORE_CONFIGS.cacheRead, 4000], [SCORE_CONFIGS.recall, 1], [SCORE_CONFIGS.newFindings, 0]]);
  for (const nothing of [null, undefined, {}, { findings: "x" }, "text"]) {
    assert.deepEqual(scoresOf(nothing, kept), [[SCORE_CONFIGS.cacheWrite, 9000], [SCORE_CONFIGS.cacheRead, 4000]], JSON.stringify(nothing));
  }
  assert.deepEqual(scoresOf({ findings: [finding("src/a.rs", 1, "A thing")] }, []).slice(2), [[SCORE_CONFIGS.recall, 0], [SCORE_CONFIGS.newFindings, 0]], "nothing kept recalls nothing");
});

test("token and cost evidence states only what is known: tokens in include the cache, tokens out include reasoning", () => {
  const summary = { totals: { tokens: { input: 1000, output: 200, reasoning: 50, cache_read: 4000, cache_write: 9000 }, cost: 0.5, complete: true } };
  assert.deepEqual(usageFromSummary(summary), { tokensIn: 14000, tokensOut: 250, cacheRead: 4000, cacheWrite: 9000, cost: 0.5 });
  const partial = { totals: { tokens: { input: 1000, output: 200, reasoning: null, cache_read: null, cache_write: 7 }, cost: null } };
  assert.deepEqual(usageFromSummary(partial), { tokensIn: null, tokensOut: null, cacheRead: null, cacheWrite: 7, cost: null });
  assert.deepEqual(usageFromSummary(null), { tokensIn: null, tokensOut: null, cacheRead: null, cacheWrite: null, cost: null });
  const scores = slotScores({ rowId: "r", trialIndex: 0, usage: usageFromSummary(partial), expectedOutput: null, kept: [] });
  assert.deepEqual(scores.map(s => s.scoreConfig), [SCORE_CONFIGS.cacheWrite], "an unknown count is left out");
});

// ─── command line ───────────────────────────────────────────────────────────

test("the command line takes the documented options, with a 6-minute gap over all rows by default, and refuses the rest", () => {
  assert.deepEqual(parseCli(["--dataset", "d", "--arm", "baseline", "--trials", "3"]), { dataset: "d", arm: "baseline", trials: 3, tag: undefined, rows: undefined, resume: undefined, gapMs: 360_000, gapScope: "all", plan: false });
  assert.deepEqual(parseCli(["--dataset", "d", "--arm", "a", "--trials", "1", "--rows", "pr-16317,pr-16893,pr-16317"]).rows, ["pr-16317", "pr-16893"]);
  const full = parseCli(["--dataset", "ds1", "--arm", "e", "--trials", "1", "--tag", "smoke", "--resume", "exp9", "--row-gap-min", "0.5", "--gap-scope", "row", "--plan"]);
  assert.deepEqual([full.arm, full.tag, full.resume, full.gapMs, full.gapScope, full.plan], ["e", "smoke", "exp9", 30_000, "row", true]);
  for (const arm of ["baseline", "a", "b", "c", "d", "e"]) assert.equal(parseCli(["--dataset", "d", "--arm", arm, "--trials", "1"]).arm, arm);
  const bad = args => assert.throws(() => parseCli(args), UsageError);
  bad(["--arm", "a", "--trials", "1"]);
  bad(["--dataset", "d", "--arm", "f", "--trials", "1"]);
  bad(["--dataset", "d", "--trials", "1"]);
  bad(["--dataset", "d", "--arm", "a"]);
  for (const trials of ["0", "51", "abc", "1.5", "-2"]) bad(["--dataset", "d", "--arm", "a", "--trials", trials]);
  bad(["--dataset", "d", "--arm", "a", "--trials", "1", "--gap-scope", "some"]);
  bad(["--dataset", "d", "--arm", "a", "--trials", "1", "--row-gap-min", "-1"]);
  bad(["--dataset", "d", "--arm", "a", "--trials", "1", "--tag", "has space"]);
  bad(["--dataset", "d", "--arm", "a", "--trials", "1", "--rows", "pr-1,has space"]);
  bad(["--dataset", "d", "--arm", "a", "--trials", "1", "--rows", "pr-1", "--tag", "smoke"]);
  bad(["--dataset", "d", "--arm", "a", "--trials", "1", "--unknown"]);
});

test("a dataset row must name an owner/name repository, a PR number and two full commit SHAs", () => {
  const sha = "a".repeat(40);
  const slot = input => ({ rowId: "r1", trialIndex: 0, input });
  assert.equal(rowOfSlot(slot({ repo: "openobserve/openobserve", pr_number: 17126, merge_base_sha: sha, head_sha: sha })).problem, "");
  assert.match(rowOfSlot(slot({ repo: "no-slash", pr_number: 1, merge_base_sha: sha, head_sha: sha })).problem, /repo is not owner\/name/);
  assert.match(rowOfSlot(slot({ repo: "o/r;x", pr_number: 1, merge_base_sha: sha, head_sha: sha })).problem, /repo/);
  assert.match(rowOfSlot(slot({ repo: "o/r", pr_number: "x", merge_base_sha: sha, head_sha: sha })).problem, /pr_number/);
  assert.match(rowOfSlot(slot({ repo: "o/r", pr_number: 1, merge_base_sha: "main", head_sha: sha })).problem, /merge_base_sha/);
  assert.match(rowOfSlot(slot({ repo: "o/r", pr_number: 1, merge_base_sha: sha, head_sha: "abc123" })).problem, /head_sha/);
  assert.match(rowOfSlot({ rowId: "r", trialIndex: 0 }).problem, /repo/);
});

test("slots run trial by trial, rows in their dataset order within each", () => {
  const slots = [["a", 0], ["a", 1], ["b", 0], ["b", 1], ["c", 0], ["c", 1]].map(([rowId, trialIndex]) => ({ rowId, trialIndex }));
  assert.deepEqual(runOrder(slots).map(s => `${s.rowId}${s.trialIndex}`), ["a0", "b0", "c0", "a1", "b1", "c1"]);
});

// ─── records ────────────────────────────────────────────────────────────────

const summaryOf = (over = {}) => ({
  trace_id: "t".repeat(32), duration_ms: 1234, outcome: "success", tier: "lite", agents: ["correctness", "code-quality"],
  kept_findings: [finding("src/a.rs", 10, "Missing bounds check on parse")], kept_findings_known: true, sessions: [],
  totals: { sessions: 3, tokens: { input: 1000, output: 200, reasoning: 50, cache_read: 4000, cache_write: 9000 }, cost: 0.0456, complete: true },
  ...over,
});

test("a finished review becomes an ok record with its findings, usage and trace, and an expectation-based set of scores", () => {
  const slot = { rowId: "r1", trialIndex: 2, expectedOutput: { findings: [finding("src/a.rs", 11, "Missing bounds check on parse")] } };
  const { record, scores } = buildSlotReport({ slot, fingerprint: "fp", summary: summaryOf(), latencyMs: 4321, traceId: "a".repeat(32) });
  assert.deepEqual(Object.keys(record).filter(k => !ALLOWED_RECORD_KEYS.includes(k)), []);
  assert.deepEqual({ ...record, executedAt: 0 }, {
    rowId: "r1", trialIndex: 2, taskFingerprint: "fp", latencyMs: 4321, executedAt: 0, traceId: "a".repeat(32),
    tokensIn: 14000, tokensOut: 250, cost: 0.0456, status: "ok",
    output: { outcome: "success", tier: "lite", agents: ["correctness", "code-quality"], keptFindings: summaryOf().kept_findings, findingsKnown: true },
  });
  assert.deepEqual(scores.map(s => [s.scoreConfig, s.value]), [[SCORE_CONFIGS.cacheWrite, 9000], [SCORE_CONFIGS.cacheRead, 4000], [SCORE_CONFIGS.recall, 1], [SCORE_CONFIGS.newFindings, 0]]);
  for (const score of scores) {
    assert.deepEqual(Object.keys(score).filter(k => !ALLOWED_SCORE_KEYS.includes(k)), []);
    assert.equal(score.rowId, "r1");
    assert.equal(score.trialIndex, 2);
    assert.match(score.clientScorerKey, /^ai-review-harness:/);
  }
});

test("a partial review is still ok, a skipped one is skipped, and every other ending is an error that keeps its cost", () => {
  const slot = { rowId: "r1", trialIndex: 0, expectedOutput: null };
  const report = summary => buildSlotReport({ slot, fingerprint: "fp", summary, latencyMs: 1, traceId: "b".repeat(32) });
  assert.equal(report(summaryOf({ outcome: "partial_success" })).record.status, "ok");
  assert.equal(report(summaryOf({ outcome: "partial_success" })).record.output.outcome, "partial_success");
  const skipped = report(summaryOf({ outcome: "skipped" })).record;
  assert.equal(skipped.status, "skipped");
  assert.match(skipped.skipMessage, /no meaningful changes/);
  assert.equal(skipped.output, undefined);
  for (const outcome of ["all_agents_failed", "failure", "misconfigured", "timeout"]) {
    const { record, scores } = report(summaryOf({ outcome, error: "boom" }));
    assert.equal(record.status, "error", outcome);
    assert.equal(record.errorMessage, `${outcome}: boom`);
    assert.equal(record.cost, 0.0456, "a failed run was billed too");
    assert.equal(record.output, undefined);
    assert.deepEqual(scores, []);
  }
  const none = buildSlotReport({ slot, fingerprint: "fp", summary: null, engine: { exitCode: 3, signal: null, tail: "boom\nTypeError: x", timedOut: false }, latencyMs: 1, traceId: "c".repeat(32) }).record;
  assert.match(none.errorMessage, /the engine left no run summary \(exit 3: boom \| TypeError: x\)/);
  assert.equal(none.cost, undefined);
  assert.equal(buildSlotReport({ slot, fingerprint: "fp", summary: null, latencyMs: 0, traceId: "d".repeat(32), failure: "invalid dataset row: x" }).record.errorMessage, "invalid dataset row: x");
});

test("every part of a batch needs its own accepted verdict", () => {
  const payload = { records: [{ rowId: "r1", trialIndex: 0 }], scores: [{ rowId: "r1", trialIndex: 0 }, { rowId: "r1", trialIndex: 0 }] };
  const verdict = (index, accepted, code) => ({ index, accepted, ...(accepted ? {} : { error: { code, message: `${code} happened` } }) });
  assert.deepEqual(rejectionsOf(payload, { records: [verdict(0, true)], scores: [verdict(0, true), verdict(1, true)] }), []);
  assert.deepEqual(rejectionsOf(payload, { records: [verdict(0, true)], scores: [verdict(0, true), verdict(1, false, "invalid_score_value")] }), [
    { kind: "score", rowId: "r1", trialIndex: 0, code: "invalid_score_value", message: "invalid_score_value happened" },
  ]);
  assert.equal(rejectionsOf(payload, { records: [verdict(0, false, "fingerprint_mismatch")], scores: [] }).length, 3, "a record the server refused and two scores it never ruled on");
  assert.equal(rejectionsOf(payload, {}).length, 3);
  assert.equal(rejectionsOf(payload, null)[0].code, "no_verdict");
});

// ─── fixtures: a fake OpenObserve and OpenRouter, local git remotes, a fake engine ──────────────

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
}

// A bare remote under <root>/remotes/<owner>/<name>.git with a base and a head commit; the head also adds a planted submodule, symlink and hook-ish files.
function makeRemote(root, repo) {
  const work = mkdtempSync(join(root, "work-"));
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "t");
  writeFileSync(join(work, "a.rs"), "fn a() {}\n");
  git(work, "add", ".");
  git(work, "-c", "commit.gpgsign=false", "commit", "-qm", "base");
  const base = git(work, "rev-parse", "HEAD");
  writeFileSync(join(work, "a.rs"), "fn a() { b() }\n");
  writeFileSync(join(work, ".gitattributes"), "*.rs filter=evil\n");
  writeFileSync(join(work, ".gitmodules"), '[submodule "sub"]\n\tpath = sub\n\turl = file:///nonexistent/never-fetched\n');
  git(work, "add", ".");
  git(work, "update-index", "--add", "--cacheinfo", `160000,${"e".repeat(40)},sub`);
  git(work, "-c", "commit.gpgsign=false", "commit", "-qm", "head");
  const head = git(work, "rev-parse", "HEAD");
  writeFileSync(join(work, "a.rs"), "fn a() { pushed_later() }\n");
  git(work, "-c", "commit.gpgsign=false", "commit", "-qam", "later");
  const bare = join(root, "remotes", `${repo}.git`);
  mkdirSync(join(root, "remotes", repo.split("/")[0]), { recursive: true });
  git(root, "clone", "-q", "--bare", work, bare);
  git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  return { base, head };
}

const ORG = "default";

function fakeOpenObserve({ rows, token = TOKEN, rowPageCap = 2, slotPageCap = 3, scoreConfigs, prices } = {}) {
  const state = {
    requests: [],
    rows,
    hook: null,
    experiments: new Map(),
    records: new Map(),
    scores: [],
    failRecords: 0,
    refuseScore: null,
    refuseRecord: null,
    experimentStatus: null,
    prices: prices ?? { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003", input_cache_write: "0.00000375" },
    scoreConfigs: scoreConfigs ?? Object.values(SCORE_CONFIGS).map(name => ({ id: `id-${name}`, entityId: name, name, dataType: "numeric", isActive: true })),
  };
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const slotsOf = exp => exp.rows.flatMap(row => Array.from({ length: exp.trialCount }, (_, trialIndex) => ({ rowId: row.rowId, logicalId: row.logicalId, trialIndex, input: row.input, expectedOutput: row.expectedOutput, metadata: row.metadata })));
  const experimentBody = exp => ({ id: exp.id, name: exp.name, datasetId: exp.datasetId, datasetVersion: exp.datasetVersion, datasetFilter: exp.datasetFilter, task: exp.task, trialCount: exp.trialCount, executionStatus: state.experimentStatus ?? exp.status });
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization });
      await state.hook?.(req.method, url.pathname);
      if (url.pathname === "/api/v1/models") return send(res, 200, { data: [{ id: "other/model", pricing: { prompt: "1", completion: "1" } }, { id: SLUG, pricing: state.prices }] });
      const prefix = `/api/${ORG}`;
      if (!url.pathname.startsWith(prefix)) return send(res, 404, { message: "no such route" });
      if (req.headers.authorization !== token) return send(res, 401, { message: `unauthorized ${req.headers.authorization ?? ""}` });
      const path = url.pathname.slice(prefix.length);
      const q = Object.fromEntries(url.searchParams);
      if (req.method === "GET" && path === "/datasets") return send(res, 200, { list: [{ id: "ds1", name: "ai-code-review-prs-v1" }, { id: "ds2", name: "other" }] });
      if (req.method === "GET" && path === "/datasets/ds1/rows") {
        if (q.version !== undefined && q.version !== "7") return send(res, 400, { message: "unknown snapshot" });
        const from = Number(q.from ?? 0);
        const size = Math.min(Number(q.size ?? 20), rowPageCap);
        return send(res, 200, { rows: rows.slice(from, from + size), snapshotVersion: 7, total: rows.length, from, size, hasMore: from + size < rows.length });
      }
      if (req.method === "GET" && path === "/score_configs") return send(res, 200, { list: state.scoreConfigs });
      if (req.method === "POST" && path === "/experiments") {
        const unknown = Object.keys(body).filter(k => !ALLOWED_EXPERIMENT_KEYS.includes(k));
        if (unknown.length) return send(res, 400, { message: `unknown field ${unknown[0]}` });
        const tags = body.datasetFilter?.tags ?? [];
        const logicalIds = body.datasetFilter?.logicalIds ?? [];
        const exp = { id: `exp${state.experiments.size + 1}`, ...body, status: "running", window: 1, rows: rows.filter(r => tags.every(t => r.tags.includes(t)) && (logicalIds.length === 0 || logicalIds.includes(r.logicalId))) };
        state.experiments.set(exp.id, exp);
        return send(res, 200, { experiment: experimentBody(exp), preview: {}, created: true });
      }
      const match = path.match(/^\/experiments\/([^/]+)(\/.*)?$/);
      const exp = match && state.experiments.get(match[1]);
      if (!exp) return send(res, 404, { message: "experiment not found" });
      const sub = match[2] ?? "";
      if (req.method === "GET" && sub === "") {
        const page = Number(q.resultPage ?? 1);
        const size = Number(q.resultPageSize ?? 50);
        const all = slotsOf(exp).map(s => ({ rowId: s.rowId, trialIndex: s.trialIndex, taskStatus: state.records.get(`${exp.id}|${s.rowId}|${s.trialIndex}`)?.record.status ?? "pending" }));
        const slice = all.slice((page - 1) * size, page * size);
        return send(res, 200, { experiment: experimentBody(exp), preview: {}, results: { slots: slice, pagination: { page, pageSize: size, totalSlots: all.length, hasMore: page * size < all.length } } });
      }
      if (req.method === "GET" && sub === "/slots") {
        const all = slotsOf(exp);
        const from = Number(q.from ?? 0);
        const size = Math.min(Number(q.size ?? 100), slotPageCap);
        return send(res, 200, { slots: all.slice(from, from + size), total: all.length, from, size, hasMore: from + size < all.length });
      }
      if (req.method === "POST" && sub === "/retry") {
        if ((state.experimentStatus ?? exp.status) !== "failed") return send(res, 409, { message: "not failed" });
        state.experimentStatus = null;
        exp.status = "running";
        exp.window += 1;
        return send(res, 200, experimentBody(exp));
      }
      if (req.method === "POST" && sub === "/finalize") {
        const missing = slotsOf(exp).filter(s => !state.records.has(`${exp.id}|${s.rowId}|${s.trialIndex}`)).length;
        if (missing > 0) return send(res, 409, { message: `${missing} slot(s) have no terminal record` });
        exp.status = "completed";
        return send(res, 200, experimentBody(exp));
      }
      if (req.method === "POST" && sub === "/records") {
        if (state.failRecords > 0) {
          state.failRecords -= 1;
          return send(res, 503, { message: "try later" });
        }
        const unknown = [...(body.records ?? []).flatMap(r => Object.keys(r).filter(k => !ALLOWED_RECORD_KEYS.includes(k))), ...(body.scores ?? []).flatMap(s => Object.keys(s).filter(k => !ALLOWED_SCORE_KEYS.includes(k)))];
        if (unknown.length) return send(res, 400, { message: `unknown field ${unknown[0]}` });
        const slots = new Set(slotsOf(exp).map(s => `${s.rowId}|${s.trialIndex}`));
        const part = (index, item, error, duplicate = false) => ({ index, rowId: item.rowId, trialIndex: item.trialIndex, accepted: !error, duplicate, ...(error ? { error } : {}) });
        const records = (body.records ?? []).map((r, index) => {
          const key = `${exp.id}|${r.rowId}|${r.trialIndex}`;
          if (!slots.has(`${r.rowId}|${r.trialIndex}`)) return part(index, r, { code: "unknown_slot", message: "no such slot" });
          if (r.taskFingerprint !== exp.task.taskFingerprint) return part(index, r, { code: "fingerprint_mismatch", message: "wrong code" });
          if (state.refuseRecord?.(r)) return part(index, r, state.refuseRecord(r));
          if (r.status === "ok" && !r.output) return part(index, r, { code: "missing_output", message: "ok needs output" });
          const stored = state.records.get(key);
          if (stored && JSON.stringify(stored.record) === JSON.stringify(r)) return part(index, r, null, true);
          if (stored && (stored.record.status !== "error" || stored.window >= exp.window)) return part(index, r, { code: "slot_immutable", message: "already concluded" });
          state.records.set(key, { record: r, window: exp.window });
          return part(index, r, null);
        });
        const scores = (body.scores ?? []).map((s, index) => {
          if (!state.scoreConfigs.some(c => c.name === s.scoreConfig)) return part(index, s, { code: "unknown_score_config", message: "no such config" });
          const refused = state.refuseScore?.(s);
          if (refused) return part(index, s, refused);
          if (!state.records.has(`${exp.id}|${s.rowId}|${s.trialIndex}`)) return part(index, s, { code: "no_execution_record", message: "no record" });
          state.scores.push(s);
          return part(index, s, null);
        });
        return send(res, 200, { records, scores, acceptedRecords: records.filter(r => r.accepted).length, rejectedRecords: records.filter(r => !r.accepted).length, acceptedScores: scores.filter(r => r.accepted).length, rejectedScores: scores.filter(r => !r.accepted).length });
      }
      return send(res, 404, { message: "no such route" });
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    requestsTo: (method, pattern) => state.requests.filter(r => r.method === method && pattern.test(r.path)),
    close: () => { server.closeAllConnections(); server.close(); },
  })));
}

const EXPECTED_A = { findings: [finding("src/a.rs", 10, "Missing bounds check on parse")] };

function datasetRows(remotes) {
  const row = (n, repo, tags, expectedOutput) => ({
    rowId: `r${n}`, logicalId: `case-${n}`, expectedOutput, tags, isDeleted: false, metadata: { tier: "lite" },
    input: { repo, pr_number: 100 + n, merge_base_sha: remotes[repo].base, head_sha: remotes[repo].head },
  });
  return [
    row(1, "acme/one", ["full", "smoke"], EXPECTED_A),
    row(2, "acme/two", ["full", "smoke"], { findings: [] }),
    row(3, "acme/one", ["full", "cost-small"], null),
    row(4, "acme/two", ["full", "cost-small"], EXPECTED_A),
  ];
}

// A fake clock, so a cooldown of minutes costs nothing, and a fake engine that checks the checkout it was given and leaves a run summary.
function setup(t, { scenarios = {}, serverOptions = {}, envExtra = {}, rowsFn = datasetRows } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ai-review-exp-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remotes = { "acme/one": makeRemote(root, "acme/one"), "acme/two": makeRemote(root, "acme/two") };
  const clock = { t: 1_800_000_000_000 };
  const sleeps = [];
  const engineCalls = [];
  const lines = [];
  const stateDir = join(root, "state");
  const fixtures = { root, remotes, clock, sleeps, engineCalls, lines, stateDir };
  fixtures.ready = fakeOpenObserve({ rows: rowsFn(remotes), ...serverOptions }).then(server => {
    fixtures.server = server;
    t.after(() => server.close());
    fixtures.env = {
      PATH: process.env.PATH,
      OPENOBSERVE_URL: server.url, OPENOBSERVE_ORG: ORG, OPENOBSERVE_AUTH_TOKEN: TOKEN,
      OPENROUTER_REVIEW_API_KEY: MODEL_KEY,
      REVIEW_EXPERIMENT_OPENROUTER_URL: server.url, REVIEW_EXPERIMENT_GIT_BASE_URL: `file://${join(root, "remotes")}`,
      GH_TOKEN: WRITE_TOKEN, GITHUB_TOKEN: WRITE_TOKEN, AWS_SECRET_ACCESS_KEY: "unrelated-cloud-secret-value", SOME_OTHER_SECRET: "unrelated-secret-value",
      ...envExtra,
    };
    return fixtures;
  });
  fixtures.runEngine = ({ args, cwd, env }) => {
    const call = {
      env, args, cwd, row: env.REVIEW_EXPERIMENT_ROW_ID, trial: Number(env.REVIEW_EXPERIMENT_TRIAL), at: clock.t,
      checkout: {
        head: git(env.PR_DIR, "rev-parse", "HEAD"),
        files: readdirSync(env.PR_DIR).sort(),
        diff: localDiff(env.PR_DIR, env.MERGE_BASE_SHA, env.HEAD_SHA),
        hooks: existsSync(join(env.PR_DIR, ".git", "hooks")) ? readdirSync(join(env.PR_DIR, ".git", "hooks")) : [],
        subEntries: existsSync(join(env.PR_DIR, "sub")) ? readdirSync(join(env.PR_DIR, "sub")) : null,
        config: readFileSync(join(env.PR_DIR, ".git", "config"), "utf-8"),
      },
    };
    engineCalls.push(call);
    clock.t += 20_000;
    const scenario = (typeof scenarios === "function" ? scenarios(call) : scenarios[`${call.row}#${call.trial}`]) ?? {};
    if (scenario.interrupt) {
      scenario.interrupt = false;
      let kill;
      const promise = new Promise(resolve => { kill = () => { fixtures.kills = (fixtures.kills ?? 0) + 1; resolve({ exitCode: null, signal: "SIGKILL", tail: "", timedOut: false }); }; });
      setTimeout(() => { for (let i = 0; i < (scenario.interruptSignals ?? 1); i += 1) process.emit("SIGINT"); }, 5);
      return { promise, kill };
    }
    if (scenario.summary !== null) writeFileSync(join(env.REVIEW_ARTIFACT_DIR, "review-run-summary.json"), JSON.stringify(scenario.summary ?? summaryOf()));
    return { promise: Promise.resolve({ exitCode: scenario.exitCode ?? 0, signal: null, tail: scenario.tail ?? "", timedOut: false }), kill() {} };
  };
  fixtures.run = async (argv, { env = {}, deps = {} } = {}) => {
    await fixtures.ready;
    const code = await main({
      argv,
      env: { ...fixtures.env, ...env },
      deps: {
        out: line => lines.push(line), now: () => clock.t, sleep: async ms => { sleeps.push(ms); clock.t += ms; },
        stateDir, engineDir: "/engine", engineIdentity: () => ({ commit: "1".repeat(40) }), runEngine: fixtures.runEngine, ...deps,
      },
    });
    return code;
  };
  return fixtures;
}

const ARGS = (...extra) => ["--dataset", "ai-code-review-prs-v1", "--arm", "baseline", "--trials", "1", ...extra];
const sleptMs = f => f.sleeps.filter(ms => ms <= 1000).reduce((a, b) => a + b, 0);

test("plan reads the dataset, the pricing and the score configs and creates nothing, starts nothing", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke", "--plan")), 0);
  const methods = new Set(f.server.state.requests.map(r => r.method));
  assert.deepEqual([...methods], ["GET"], "read-only");
  assert.equal(f.engineCalls.length, 0);
  assert.equal(f.server.state.experiments.size, 0);
  assert.equal(existsSync(f.stateDir), false, "no lock, no cooldown clock");
  const out = f.lines.join("\n");
  assert.match(out, /2 of 4 rows/);
  assert.match(out, /2 slots/);
  assert.match(out, /plan only: nothing was created and no review was started/);
  assert.match(out, /fingerprint ai-review-engine:[0-9a-f]{40}/);
  assert.match(out, /"input":3,"output":15,"cache_read":0.3,"cache_write":3.75/);
  assert.equal(f.server.requestsTo("GET", /models$/).length, 1);
});

test("plan names a missing or non-numeric score config and exits non-zero without touching anything", async t => {
  const f = setup(t, { serverOptions: { scoreConfigs: [{ name: SCORE_CONFIGS.recall, dataType: "categorical", isActive: true }, { name: SCORE_CONFIGS.cacheRead, dataType: "numeric", isActive: true }] } });
  assert.equal(await f.run(ARGS("--plan")), 1);
  const out = f.lines.join("\n");
  assert.match(out, /PREFLIGHT: score config ai_review_recall is categorical, not numeric/);
  assert.match(out, /PREFLIGHT: score config ai_review_new_findings does not exist/);
  assert.match(out, /PREFLIGHT: score config ai_review_cache_write_tokens does not exist/);
  assert.equal(f.server.state.requests.some(r => r.method !== "GET"), false);
  // And a real run stops at the same check before it creates anything.
  assert.equal(await f.run(ARGS()), 1);
  assert.equal(f.server.state.experiments.size, 0);
  assert.equal(f.engineCalls.length, 0);
});

test("rows are paged at one pinned snapshot, filtered by the tag, and the experiment is created with the same pin, tag and an SDK task", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke", "--trials", "2")), 0);
  const rowPages = f.server.requestsTo("GET", /\/datasets\/ds1\/rows$/);
  assert.equal(rowPages.length, 2, "four rows, two to a page");
  assert.deepEqual(rowPages.map(r => r.query.from), ["0", "2"]);
  assert.equal(rowPages[0].query.version, undefined, "the first page names the snapshot");
  assert.equal(rowPages[1].query.version, "7", "every later page asks for it");
  const [create] = f.server.requestsTo("POST", /\/experiments$/);
  assert.deepEqual(Object.keys(create.body).sort(), ["datasetFilter", "datasetId", "datasetVersion", "description", "idempotencyKey", "metadata", "name", "scorers", "task", "trialCount"]);
  assert.equal(create.body.datasetId, "ds1");
  assert.equal(create.body.datasetVersion, 7);
  assert.deepEqual(create.body.datasetFilter, { tags: ["smoke"] });
  assert.equal(create.body.trialCount, 2);
  assert.deepEqual(create.body.scorers, []);
  assert.equal(create.body.task.type, "sdk");
  assert.match(create.body.task.taskFingerprint, /^ai-review-engine:[0-9a-f]{40}$/);
  assert.match(create.body.idempotencyKey, /^ai-review-/);
  const exp = f.server.state.experiments.get("exp1");
  assert.equal(exp.rows.length, 2);
  assert.equal(f.server.requestsTo("GET", /\/slots$/).length, 2, "four slots, three to a page");
  assert.equal(f.engineCalls.length, 4);
  // Without a tag the filter is left out.
  const g = setup(t);
  assert.equal(await g.run(ARGS()), 0);
  assert.equal("datasetFilter" in g.server.requestsTo("POST", /\/experiments$/)[0].body, false);
  assert.equal(g.engineCalls.length, 4);
});

test("--rows selects chosen rows by logical id: the filter, the name and the plan carry them, and only those rows are reviewed", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--rows", "case-3,case-1,case-3", "--trials", "2", "--plan")), 0);
  assert.match(f.lines.join("\n"), /rows: case-1, case-3/);
  assert.match(f.lines.join("\n"), /so 4 slots/);
  assert.equal(f.server.requestsTo("POST", /\/experiments$/).length, 0, "a plan creates nothing");
  const g = setup(t);
  assert.equal(await g.run(ARGS("--rows", "case-3,case-1")), 0);
  const [create] = g.server.requestsTo("POST", /\/experiments$/);
  assert.deepEqual(create.body.datasetFilter, { logicalIds: ["case-3", "case-1"] });
  assert.match(create.body.name, /\[rows: 2\]/);
  assert.equal(create.body.task.config.rows.length, 2);
  assert.deepEqual(g.engineCalls.map(c => c.row).sort(), ["r1", "r3"]);
});

test("--rows refuses an id the snapshot does not hold, naming it, and refuses a tag beside it or a malformed id", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--rows", "case-1,case-99,case-98")), 1);
  assert.match(f.lines.join("\n"), /has no row case-99, case-98 at version 7/);
  assert.equal(f.server.requestsTo("POST", /\/experiments$/).length, 0);
  assert.equal(f.engineCalls.length, 0);
  f.lines.length = 0;
  assert.equal(await f.run(ARGS("--rows", "case-1", "--tag", "smoke")), 2);
  assert.match(f.lines.join("\n"), /--rows and --tag are two ways to select rows; pass one/);
  for (const bad of ["case-1,", "case 1", "a/b", ""]) {
    f.lines.length = 0;
    assert.equal(await f.run(ARGS("--rows", bad)), 2, bad);
    assert.match(f.lines.join("\n"), /--rows takes comma-separated logical ids/, bad);
  }
  assert.equal(f.server.requestsTo("POST", /\/experiments$/).length, 0);
});

test("a resume checks the rows the experiment was created with, as it checks the tag", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS("--rows", "case-1,case-2")), 130);
  const refused = async (extra, pattern) => {
    f.lines.length = 0;
    assert.equal(await f.run(ARGS(...extra, "--resume", "exp1")), 1, extra.join(" "));
    assert.match(f.lines.join("\n"), pattern);
  };
  await refused(["--rows", "case-1"], /was created with rows case-1,case-2; pass --rows case-1,case-2/);
  await refused([], /was created with rows case-1,case-2; pass --rows case-1,case-2/);
  await refused(["--tag", "smoke"], /was created without a tag; pass no --tag/);
  assert.equal(f.server.requestsTo("POST", /\/records$/).length, 1, "nothing more was reported");
  assert.equal(await f.run(ARGS("--rows", "case-2,case-1", "--resume", "exp1")), 0);
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
  // The other way round: an experiment made without rows is not resumed with some.
  const g = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await g.run(ARGS("--tag", "smoke")), 130);
  g.lines.length = 0;
  assert.equal(await g.run(ARGS("--rows", "case-1", "--resume", "exp1")), 1);
  assert.match(g.lines.join("\n"), /was created with tag smoke|without --rows/);
});

test("each slot is reviewed from a fresh checkout of its two commits, and the records and scores reach the server in the wire shape", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  assert.equal(f.engineCalls.length, 2);
  const [first, second] = f.engineCalls;
  assert.deepEqual([first.row, second.row], ["r1", "r2"]);
  assert.equal(first.checkout.head, f.remotes["acme/one"].head);
  assert.equal(second.checkout.head, f.remotes["acme/two"].head);
  assert.ok(first.checkout.files.includes("a.rs"));
  assert.match(first.checkout.diff, /\+fn a\(\) \{ b\(\) \}/);
  assert.equal(first.checkout.diff.includes("pushed_later"), false, "the commit pushed after the pinned head is not fetched or diffed");
  const posts = f.server.requestsTo("POST", /\/records$/);
  assert.equal(posts.length, 2);
  const exp = f.server.state.experiments.get("exp1");
  for (const [i, post] of posts.entries()) {
    assert.deepEqual(Object.keys(post.body).sort(), ["records", "scores"]);
    assert.equal(post.body.records.length, 1);
    const [record] = post.body.records;
    assert.deepEqual(Object.keys(record).filter(k => !ALLOWED_RECORD_KEYS.includes(k)), []);
    assert.equal(record.taskFingerprint, exp.task.taskFingerprint);
    assert.equal(record.status, "ok");
    assert.equal(record.tokensIn, 14000);
    assert.equal(record.tokensOut, 250);
    assert.equal(record.cost, 0.0456);
    assert.match(record.traceId, /^[0-9a-f]{32}$/);
    assert.equal(record.traceId, f.engineCalls[i].env.O2_TRACE_ID, "the trace id the engine ran under");
    assert.equal(record.output.outcome, "success");
    assert.equal(record.rowId, `r${i + 1}`);
    assert.equal(record.trialIndex, 0);
    assert.equal(post.auth, TOKEN);
  }
  // Row 1 expects one finding and the summary kept it; row 2 expects none and kept one.
  const byRow = Object.fromEntries(posts.map(p => [p.body.records[0].rowId, Object.fromEntries(p.body.scores.map(s => [s.scoreConfig, s.value]))]));
  assert.deepEqual(byRow.r1, { [SCORE_CONFIGS.cacheWrite]: 9000, [SCORE_CONFIGS.cacheRead]: 4000, [SCORE_CONFIGS.recall]: 1, [SCORE_CONFIGS.newFindings]: 0 });
  assert.deepEqual(byRow.r2, { [SCORE_CONFIGS.cacheWrite]: 9000, [SCORE_CONFIGS.cacheRead]: 4000, [SCORE_CONFIGS.recall]: 1, [SCORE_CONFIGS.newFindings]: 1 });
  assert.equal(exp.status, "completed", "finalized once every slot was accepted");
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 1);
});

test("the checkout is data only: no hook, no filter, no submodule, no credential, and nothing after the pinned head", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  const [call] = f.engineCalls;
  assert.deepEqual(call.checkout.hooks, [], "no hook files (git init ran without templates)");
  assert.equal(call.checkout.config.includes("credential"), false);
  assert.equal(call.checkout.config.includes("hooksPath"), false);
  assert.match(call.checkout.config, /url = file:\/\/.*acme\/one\.git/, "the remote carries no userinfo");
  assert.equal(call.checkout.files.includes("sub"), true, "the gitlink is an empty directory");
  assert.deepEqual(call.checkout.subEntries, [], "no submodule was fetched");
  assert.equal(existsSync(call.env.PR_DIR), false, "the scratch checkout is removed after the run");
});

test("checkoutPinned runs git from argument vectors with no config, hooks, filters, submodules or credentials, and refuses what is not a repo or a full SHA", () => {
  const calls = [];
  const run = (args, options) => { calls.push({ args, env: options.env }); return ""; };
  const sha = "a".repeat(40);
  checkoutPinned({ repo: "openobserve/openobserve", mergeBase: sha, head: "b".repeat(40), dir: "/scratch/pr", home: "/scratch/home", run });
  assert.deepEqual(calls.map(c => c.args.find(a => ["init", "remote", "fetch", "checkout"].includes(a))), ["init", "remote", "fetch", "checkout"]);
  for (const { args, env } of calls) {
    assert.ok(Array.isArray(args));
    for (const setting of ["core.hooksPath=/dev/null", "credential.helper=", "submodule.recurse=false", "filter.lfs.smudge=", "core.attributesFile=/dev/null", "protocol.version=2"]) assert.ok(args.includes(setting), setting);
    assert.deepEqual(Object.keys(env).sort(), ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_LFS_SKIP_SMUDGE", "GIT_TERMINAL_PROMPT", "HOME", "LC_ALL", "PATH"]);
    assert.equal(env.HOME, "/scratch/home");
    assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  }
  assert.ok(calls[0].args.includes("--template="));
  assert.ok(calls[2].args.includes("--depth=1") && calls[2].args.includes("--no-recurse-submodules"));
  assert.deepEqual(calls[2].args.slice(-3), ["origin", sha, "b".repeat(40)]);
  assert.ok(calls[1].args.includes("https://github.com/openobserve/openobserve.git"));
  for (const bad of [{ repo: "no-slash" }, { repo: "o/r --upload-pack=x" }, { repo: "-o/r" + "" }, { mergeBase: "main" }, { head: "--output=x".padEnd(40, "0") }, { head: sha.slice(0, 39) }]) {
    const before = calls.length;
    assert.throws(() => checkoutPinned({ repo: "o/r", mergeBase: sha, head: sha, dir: "/d", home: "/h", run, ...bad }), /owner\/name|full 40-character/);
    assert.equal(calls.length, before, `nothing ran for ${JSON.stringify(bad)}`);
  }
});

test("a review that finds nothing to review is skipped, a failed one is an error with its message, and the run goes on", async t => {
  const f = setup(t, { scenarios: { "r1#0": { summary: summaryOf({ outcome: "skipped", totals: { sessions: 0, tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 }, cost: 0, complete: true } }) }, "r2#0": { summary: summaryOf({ outcome: "failure", error: "provider down" }) }, "r3#0": { summary: null, exitCode: 7, tail: "stack trace" } } });
  assert.equal(await f.run(ARGS()), 0);
  const records = Object.fromEntries(f.server.requestsTo("POST", /\/records$/).map(p => [p.body.records[0].rowId, p.body]));
  assert.equal(records.r1.records[0].status, "skipped");
  assert.equal(records.r1.records[0].skipMessage, "no meaningful changes to review after filtering");
  assert.equal(records.r1.records[0].tokensIn, 0);
  assert.deepEqual(records.r1.scores, []);
  assert.equal(records.r2.records[0].status, "error");
  assert.equal(records.r2.records[0].errorMessage, "failure: provider down");
  assert.match(records.r3.records[0].errorMessage, /the engine left no run summary \(exit 7: stack trace\)/);
  assert.equal(records.r4.records[0].status, "ok");
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
});

test("a row with an unusable commit is recorded as an error without cloning or running", async t => {
  const f = setup(t, { rowsFn: remotes => { const rows = datasetRows(remotes); rows[0].input.head_sha = "main"; return rows; } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  assert.equal(f.engineCalls.length, 1, "only the usable row ran");
  const bad = f.server.requestsTo("POST", /\/records$/).find(p => p.body.records[0].rowId === "r1");
  assert.equal(bad.body.records[0].status, "error");
  assert.match(bad.body.records[0].errorMessage, /invalid dataset row: head_sha is not a full commit SHA/);
  assert.deepEqual(bad.body.scores, []);
});

// Files and values of everything the review could read: the engine's environment and the whole scratch directory around its PR checkout.
function scanForMarker(call, marker) {
  const hits = [];
  for (const [name, value] of Object.entries(call.env)) if (`${name}=${value}`.includes(marker)) hits.push(`env ${name}`);
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name.includes(marker)) hits.push(`name ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && readFileSync(path).includes(marker)) hits.push(`file ${path}`);
    }
  };
  walk(dirname(call.env.PR_DIR));
  return hits;
}

test("a row's expected output and metadata never reach the engine or its checkout; they are read only after it exits, to score", async t => {
  const MARKER = "UNIQUE-MARKER-4f9c1e7b-do-not-leak";
  const leaks = [];
  const f = setup(t, {
    rowsFn: remotes => {
      const rows = datasetRows(remotes);
      rows[0].expectedOutput = { findings: [{ ...EXPECTED_A.findings[0], body: `${MARKER} expected body`, severity: `p1-${MARKER}` }], note: MARKER };
      rows[0].metadata = { tier: "lite", baseline_trace_id: MARKER, baseline_cost_usd: 0.42 };
      rows[0].logicalId = `case-${MARKER}`;
      return rows;
    },
    scenarios: call => { leaks.push(...scanForMarker(call, MARKER).map(hit => `${call.row}: ${hit}`)); },
  });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  assert.equal(f.engineCalls.length, 2);
  assert.deepEqual(leaks, [], "no copy of the expected output or metadata in the engine's environment or its scratch tree");
  const env = f.engineCalls[0].env;
  // The engine's row facts are the validated input and the coordinates, nothing else of the row.
  assert.deepEqual([env.GITHUB_REPOSITORY, env.PR_NUMBER, env.MERGE_BASE_SHA, env.HEAD_SHA, env.REVIEW_EXPERIMENT_ROW_ID], ["acme/one", "101", f.remotes["acme/one"].base, f.remotes["acme/one"].head, "r1"]);
  // The expectation was used after the engine exited: the kept finding matched it, so recall is 1.
  const post = f.server.requestsTo("POST", /\/records$/)[0].body;
  assert.equal(post.scores.find(s => s.scoreConfig === SCORE_CONFIGS.recall).value, 1);
  // And the harness's own files stay in the work directory, outside the scratch tree the review read.
  const state = [];
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (entry.isDirectory()) walk(p); else state.push(p); } };
  walk(f.stateDir);
  assert.ok(state.length >= 3);
  for (const call of f.engineCalls) for (const path of state) assert.equal(path.startsWith(call.env.PR_DIR), false, path);
});

test("the scan finds a marker where one is, so a clean result above means something", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-scan-"));
  try {
    mkdirSync(join(dir, "pr"));
    mkdirSync(join(dir, "home"));
    writeFileSync(join(dir, "home", "notes.txt"), "has MARK-1 inside");
    assert.deepEqual(scanForMarker({ env: { PR_DIR: join(dir, "pr"), X: "a MARK-1 b" } }, "MARK-1"), ["env X", `file ${join(dir, "home", "notes.txt")}`]);
    assert.deepEqual(scanForMarker({ env: { PR_DIR: join(dir, "pr") } }, "OTHER"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the work directory may not be a review's PR_DIR or an ancestor of it, so harness files stay out of reach of the read-only config", async t => {
  const f = setup(t);
  await f.ready;
  // The default scratch root is the temp directory: using it as the work directory would put every PR tree under it.
  assert.equal(await f.run(ARGS("--tag", "smoke"), { deps: { stateDir: tmpdir() } }), 2);
  assert.match(f.lines.join("\n"), /is PR_DIR or an ancestor of it; set REVIEW_EXPERIMENT_STATE_DIR to a directory of its own/);
  assert.equal(f.server.state.experiments.size, 0, "stopped before anything was created");
  assert.equal(f.engineCalls.length, 0);
  // A work directory beside the scratch trees is fine, even inside the scratch root.
  const scratchRoot = join(f.root, "scratch");
  mkdirSync(scratchRoot);
  assert.equal(await f.run(ARGS("--tag", "smoke"), { deps: { scratchRoot, stateDir: join(scratchRoot, "state") } }), 0);
  assert.equal(workDirProblem("/a/work", "/a/work"), "the work directory /a/work is PR_DIR or an ancestor of it");
  assert.match(workDirProblem("/a", "/a/b/pr"), /ancestor of it/);
  assert.match(workDirProblem("/a/b/pr/state", "/a/b/pr"), /is inside PR_DIR/);
  assert.equal(workDirProblem("/a/work", "/a/scratch/x/pr"), "");
  assert.equal(workDirProblem("/a/work", "/a/workshop/pr"), "", "a longer sibling name is not inside it");
});

// ─── resume, replay and cooldown ────────────────────────────────────────────

test("an interrupted run is not finalized, and a resume reports only the slots that are missing, under the same fingerprint and frozen pricing", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS()), 130);
  assert.equal(f.server.state.experiments.get("exp1").status, "running");
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 0, "no finalize on interruption");
  assert.equal(f.server.state.records.size, 1, "only the finished slot was reported");
  assert.match(f.lines.join("\n"), /interrupted; not finalized\. Resume with --resume exp1/);
  const modelsBefore = f.server.requestsTo("GET", /models$/).length;
  const callsBefore = f.engineCalls.length;
  f.server.state.prices = { prompt: "0.5", completion: "0.5" };

  assert.equal(await f.run(ARGS("--resume", "exp1")), 0);
  assert.deepEqual(f.engineCalls.slice(callsBefore).map(c => `${c.row}#${c.trial}`), ["r2#0", "r3#0", "r4#0"], "the finished slot is not run again");
  assert.equal(f.server.requestsTo("GET", /models$/).length, modelsBefore, "pricing comes from the experiment, not from OpenRouter again");
  assert.equal(f.server.requestsTo("POST", /\/experiments$/).length, 1, "no second experiment");
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
  const prices = parseTokenPrices(f.engineCalls.at(-1).env.REVIEW_TOKEN_PRICES).prices;
  assert.deepEqual(prices, { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }, "the frozen prices, not the new ones");
});

test("a resume refuses other code, another arm or another trial count: the fingerprint is the experiment's identity", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS("--trials", "1")), 130);
  const fingerprint = f.server.state.experiments.get("exp1").task.taskFingerprint;
  const refused = async (argv, deps, pattern) => {
    f.lines.length = 0;
    assert.equal(await f.run(argv, { deps }), 1);
    assert.match(f.lines.join("\n"), pattern);
  };
  await refused(["--dataset", "ai-code-review-prs-v1", "--arm", "b", "--trials", "1", "--resume", "exp1"], {}, /created by other code or settings/);
  await refused(ARGS("--resume", "exp1"), { engineIdentity: () => ({ commit: "2".repeat(40) }) }, new RegExp(`fingerprint ${fingerprint}`));
  await refused(ARGS("--resume", "exp1"), { engineIdentity: () => { throw new Error("the engine has uncommitted changes (scripts/ai-review/run-review.mjs); commit them first"); } }, /uncommitted changes/);
  await refused(["--dataset", "ai-code-review-prs-v1", "--arm", "baseline", "--trials", "2", "--resume", "exp1"], {}, /has 1 trial\(s\); pass --trials 1/);
  assert.equal(f.server.requestsTo("POST", /\/records$/).length, 1, "nothing more was reported");
  assert.equal(f.server.state.experiments.get("exp1").status, "running");
  // The right code and arm resume fine.
  assert.equal(await f.run(ARGS("--resume", "exp1")), 0);
});

test("a report the server could not take is kept and replayed on resume, without running the review again", async t => {
  const f = setup(t);
  await f.ready;
  f.server.state.failRecords = 3;
  assert.equal(await f.run(ARGS("--tag", "smoke")), 1);
  assert.equal(f.engineCalls.length, 1, "the run stopped at the first report it could not deliver");
  assert.equal(f.server.state.records.size, 0);
  assert.equal(f.server.requestsTo("POST", /\/records$/).length, 3, "two retries with backoff, then the run stops");
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 0);
  const kept = f.server.requestsTo("POST", /\/records$/).at(-1).body;
  const callsBefore = f.engineCalls.length;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.deepEqual(f.engineCalls.slice(callsBefore).map(c => c.row), ["r2"], "row 1 was not reviewed again");
  const replayed = f.server.requestsTo("POST", /\/records$/)[3].body;
  assert.deepEqual(replayed, kept, "the very body that was persisted before the first attempt");
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
  assert.match(f.lines.join("\n"), /replayed the report for row r1 trial 0/);
});

test("an experiment that failed is retried before its failed slots are done again, and finished slots are left alone", async t => {
  let r2Runs = 0;
  const f = setup(t, { scenarios: call => (call.row === "r2" && r2Runs++ === 0 ? { summary: summaryOf({ outcome: "failure", error: "provider down" }) } : {}) });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0, "r2 errored but every slot has a terminal record");
  const exp = f.server.state.experiments.get("exp1");
  exp.status = "failed";
  const callsBefore = f.engineCalls.length;
  const requestsBefore = f.server.state.requests.length;
  f.server.state.records.get("exp1|r2|0").window = 1;
  f.server.state.experimentStatus = "failed";
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  const after = f.server.state.requests.slice(requestsBefore);
  const retryAt = after.findIndex(r => r.method === "POST" && /\/retry$/.test(r.path));
  const firstRecordAt = after.findIndex(r => r.method === "POST" && /\/records$/.test(r.path));
  assert.ok(retryAt >= 0 && retryAt < firstRecordAt, "the retry comes first");
  assert.deepEqual(f.engineCalls.slice(callsBefore).map(c => c.row), ["r2"], "only the failed slot is reviewed again");
  assert.equal(f.server.state.records.get("exp1|r2|0").record.status, "ok");
  assert.equal(exp.status, "completed");
});

test("a slot that ended in error inside a running experiment is not reviewed again, since the server would refuse its replacement", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 130);
  // r1 is reported; make r2 look like an error the server holds in the current window.
  f.server.state.records.set("exp1|r2|0", { record: { status: "error", rowId: "r2", trialIndex: 0 }, window: 1 });
  const callsBefore = f.engineCalls.length;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.equal(f.engineCalls.length, callsBefore, "nothing left to run");
  assert.equal(f.server.requestsTo("POST", /\/retry$/).length, 0);
});

test("a refused part stops the run and blocks the finalize; the refused report is replayed first on resume", async t => {
  const f = setup(t);
  await f.ready;
  f.server.state.refuseScore = s => (s.scoreConfig === SCORE_CONFIGS.recall ? { code: "invalid_score_value", message: "value must be at most 0.5" } : null);
  assert.equal(await f.run(ARGS("--tag", "smoke")), 1);
  assert.equal(f.engineCalls.length, 1, "no later review was paid for after a refusal");
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 0);
  const out = f.lines.join("\n");
  assert.match(out, /REJECTED score for row r1 trial 0: invalid_score_value: value must be at most 0\.5/);
  assert.match(out, /stopped on refused reports; not finalized/);
  assert.equal(f.server.state.records.size, 1, "the record part was accepted on its own");
  // Fixed on the server: the resume replays the refused report, then runs the rest.
  f.server.state.refuseScore = null;
  const callsBefore = f.engineCalls.length;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.deepEqual(f.engineCalls.slice(callsBefore).map(c => c.row), ["r2"]);
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
});

test("a refused record, fingerprint mismatch or unknown slot included, never reaches a finalize", async t => {
  const f = setup(t);
  await f.ready;
  f.server.state.refuseRecord = r => (r.rowId === "r1" ? { code: "fingerprint_mismatch", message: "changed code needs a new Experiment" } : null);
  assert.equal(await f.run(ARGS()), 1);
  assert.equal(f.engineCalls.length, 1);
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 0);
  assert.match(f.lines.join("\n"), /REJECTED record for row r1 trial 0: fingerprint_mismatch/);
});

test("the cooldown holds every run, whatever its row, until six minutes after the last one ended", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  // Two reviews of 20 s: the second waited out the rest of the 6 minutes after the first.
  assert.equal(f.engineCalls.length, 2);
  assert.ok(f.engineCalls[1].at - f.engineCalls[0].at >= 6 * 60_000 + 20_000, `${(f.engineCalls[1].at - f.engineCalls[0].at) / 1000} s between starts`);
  assert.ok(sleptMs(f) >= 340_000 && sleptMs(f) <= 360_000, `${sleptMs(f)} ms slept`);
  // Another arm later still waits: the clock is shared state, not per experiment.
  const before = f.clock.t;
  f.sleeps.length = 0;
  assert.equal(await f.run(["--dataset", "ai-code-review-prs-v1", "--arm", "a", "--trials", "1", "--tag", "smoke"]), 0);
  const first = f.engineCalls[2];
  assert.ok(first.at - before >= 6 * 60_000 - 21_000, "the first review of the next arm waits too");
  assert.equal(readCooldown(f.stateDir).all > before, true);
});

test("a row-scoped cooldown lets different rows follow each other and holds only the same row, and the gap is configurable", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke", "--trials", "2", "--gap-scope", "row")), 0);
  // Trial-major: r1, r2, r1, r2. Different rows run back to back; a row waits for its own last review.
  assert.deepEqual(f.engineCalls.map(c => `${c.row}#${c.trial}`), ["r1#0", "r2#0", "r1#1", "r2#1"]);
  assert.equal(f.engineCalls[1].at - f.engineCalls[0].at, 20_000, "r2 did not wait for r1");
  assert.ok(f.engineCalls[2].at - f.engineCalls[0].at >= 6 * 60_000, "r1 waited for its own cooldown");
  const g = setup(t);
  assert.equal(await g.run(ARGS("--tag", "smoke", "--row-gap-min", "1")), 0);
  assert.ok(g.engineCalls[1].at - g.engineCalls[0].at >= 60_000 && g.engineCalls[1].at - g.engineCalls[0].at < 90_000, "a one-minute gap");
  const h = setup(t);
  assert.equal(await h.run(ARGS("--tag", "smoke", "--row-gap-min", "0")), 0);
  assert.equal(h.engineCalls[1].at - h.engineCalls[0].at, 20_000);
});

test("a run cut off before it ended still holds its cooldown for the next one", async t => {
  const f = setup(t, { scenarios: { "r1#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 130);
  const activity = readCooldown(f.stateDir).all;
  assert.ok(activity > 0, "the start was recorded");
  f.sleeps.length = 0;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.ok(f.engineCalls[1].at - activity >= 6 * 60_000, `the resumed run waited ${(f.engineCalls[1].at - activity) / 1000} s after the interrupted start`);
});

test("a run's start is recorded before its engine begins, so a harness that dies mid-run still holds the cooldown", async t => {
  const seen = [];
  const f = setup(t, { scenarios: call => { seen.push({ at: call.at, recorded: readCooldown(f.stateDir).all }); return {}; } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  assert.equal(seen.length, 2);
  for (const { at, recorded } of seen) assert.equal(recorded, at, "the cooldown clock already showed this run when its engine started");
});

test("cooldown arithmetic: all rows or one row, measured from the last activity", () => {
  const base = 1_800_000_000_000;
  const state = { all: base + 1_000, rows: { a: base + 1_000, b: base + 500 } };
  const wait = (rowKey, scope, now) => cooldownWaitMs({ state, rowKey, gapMs: 360_000, scope, now: base + now });
  assert.equal(wait("zzz", "all", 61_000), 300_000);
  assert.equal(wait("zzz", "row", 61_000), 0, "a row that never ran does not wait");
  assert.equal(wait("a", "row", 61_000), 300_000);
  assert.equal(wait("b", "row", 61_000), 299_500);
  assert.equal(wait("a", "all", 400_000), 0);
});

test("runs are serialized by an OS-held lock: one holder at a time, atomically, and a holder that dies loses it at once", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const release = await acquireRunLock(dir);
  await (await acquireRunLock(join(dir, "other")))(); // another work directory has its own lock
  await assert.rejects(acquireRunLock(dir), /another experiment run is active \(it holds lock port \d+\); runs are serialized/);
  await release();
  await (await acquireRunLock(dir))();
  // Contenders at the same moment: exactly one gets it, whatever the interleaving.
  const settled = await Promise.allSettled(Array.from({ length: 8 }, () => acquireRunLock(dir)));
  const winners = settled.filter(s => s.status === "fulfilled");
  assert.equal(winners.length, 1);
  assert.equal(settled.filter(s => s.status === "rejected").every(s => /another experiment run is active/.test(s.reason.message)), true);
  await winners[0].value();
  // A holder killed outright (no cleanup of any kind) frees the lock for the next one.
  const url = new URL("../src/experiment-state.mjs", import.meta.url).href;
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `import { acquireRunLock } from ${JSON.stringify(url)}; await acquireRunLock(${JSON.stringify(dir)}); console.log("held"); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise(done => holder.stdout.once("data", done));
  await assert.rejects(acquireRunLock(dir), /another experiment run is active/);
  holder.kill("SIGKILL");
  await new Promise(done => holder.once("exit", done));
  await (await acquireRunLock(dir))();
  assert.equal(lockPortFor(dir), lockPortFor(dir), "the port follows the work directory");
  assert.notEqual(lockPortFor(dir), lockPortFor(join(dir, "other")));
  // The same directory under another name is the same lock, and a client that connects and never leaves cannot hold the release.
  const link = `${dir}-link`;
  symlinkSync(dir, link);
  t.after(() => rmSync(link, { force: true }));
  assert.equal(lockPortFor(link), lockPortFor(dir));
  const held = await acquireRunLock(dir);
  let closing;
  try {
    await assert.rejects(acquireRunLock(link), /another experiment run is active/);
    const client = net.connect(lockPortFor(dir), "127.0.0.1");
    let deadline;
    try {
      await new Promise((done, fail) => client.once("connect", done).once("error", fail));
      closing = held();
      await Promise.race([closing, new Promise((_, fail) => {
        deadline = setTimeout(() => fail(new Error("the release hung on an open connection")), 3000);
      })]);
    } finally {
      clearTimeout(deadline);
      client.destroy();
    }
  } finally {
    await (closing ?? held());
  }
  touchCooldown(dir, "x", 5);
  assert.deepEqual(readCooldown(dir), { all: 5, rows: { x: 5 } });
});

// ─── credentials, pricing, fingerprint ──────────────────────────────────────

test("the engine gets only what a dry-run review needs: the model key, the trace credential, pinned coordinates; never the API token, the write token or the shell's other secrets", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  const env = f.engineCalls[0].env;
  assert.equal(env.OPENROUTER_REVIEW_API_KEY, MODEL_KEY);
  assert.equal(env.REVIEW_API_KEY_ENV, "OPENROUTER_REVIEW_API_KEY");
  assert.equal(env.REVIEW_DRY_RUN, "true");
  assert.equal(env.REVIEW_OPENCODE_CONFIG, "default");
  assert.equal(env.REVIEW_PROVIDER_ID, "openrouter-review");
  assert.equal(env.REVIEW_MODEL_ID, SLUG);
  assert.equal(env.REVIEW_MODEL_VARIANT, "high");
  assert.equal(env.REVIEW_COLD_PASSES, "2");
  assert.equal(env.O2_TRACE_AUTH, TOKEN, "the trace exporter's own credential");
  assert.equal(env.O2_TRACE_INGEST_URL, f.env.OPENOBSERVE_URL);
  assert.equal(env.O2_TRACE_STREAM, "ai_code_review_experiments");
  assert.deepEqual([env.REVIEW_EXPERIMENT_ID, env.REVIEW_EXPERIMENT_ARM, env.REVIEW_EXPERIMENT_ROW_ID, env.REVIEW_EXPERIMENT_TRIAL], ["exp1", "baseline", "r1", "0"]);
  assert.match(env.O2_TRACE_ID, /^[0-9a-f]{32}$/);
  for (const name of ["OPENOBSERVE_AUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "SOME_OTHER_SECRET", "REVIEW_BOT_LOGIN", "REVIEW_AUTO_APPROVE"]) assert.equal(env[name], undefined, name);
  for (const value of Object.values(env)) {
    assert.equal(String(value).includes(WRITE_TOKEN), false);
    assert.equal(String(value).includes("unrelated"), false);
  }
  assert.equal(env.ENGINE_DIR, "/engine");
  assert.notEqual(env.PR_DIR, env.ENGINE_DIR);
  assert.ok(env.HOME.startsWith(env.PR_DIR.replace(/\/pr$/, "")), "a fresh HOME in the scratch directory");
  assert.ok(env.REVIEW_ARTIFACT_DIR.startsWith(env.PR_DIR.replace(/\/pr$/, "")));
  assert.equal(f.engineCalls[0].cwd, "/engine/scripts/ai-review");
  assert.equal(f.engineCalls[0].args[0], "/engine/scripts/ai-review/run-review.mjs");
});

test("a read-only GitHub token reaches the engine only when the user gives one for the metadata read, and a Bearer token is not offered to the trace exporter", async t => {
  const f = setup(t, { envExtra: { REVIEW_EXPERIMENT_GH_TOKEN: "ghp_readOnlyTokenForMetadata123456789" } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  assert.equal(f.engineCalls[0].env.GH_TOKEN, "ghp_readOnlyTokenForMetadata123456789");
  assert.equal(f.engineCalls[0].env.GITHUB_TOKEN, undefined);
  assert.equal(traceAuthFrom({ OPENOBSERVE_AUTH_TOKEN: "Bearer abc" }), "");
  assert.equal(traceAuthFrom({ OPENOBSERVE_AUTH_TOKEN: "Basic abc" }), "Basic abc");
  assert.equal(traceAuthFrom({ O2_TRACE_AUTH: "Basic own", OPENOBSERVE_AUTH_TOKEN: "Basic abc" }), "Basic own");
  assert.equal(traceAuthFrom({}), "");
  const g = setup(t);
  assert.equal(await g.run(ARGS("--tag", "smoke"), { env: { OPENOBSERVE_AUTH_TOKEN: TOKEN } }), 0);
});

test("a spawned engine inherits nothing from the caller's environment beyond the variables it was given", async () => {
  const env = buildEngineEnv({
    env: { PATH: process.env.PATH, OPENROUTER_REVIEW_API_KEY: MODEL_KEY, OPENOBSERVE_AUTH_TOKEN: TOKEN, OPENOBSERVE_URL: "http://o2", OPENOBSERVE_ORG: "default", GH_TOKEN: WRITE_TOKEN, SOME_OTHER_SECRET: "x" },
    row: { rowId: "r1", trialIndex: 0, repo: "o/r", prNumber: 5, mergeBase: "a".repeat(40), head: "b".repeat(40) },
    experiment: { id: "exp1" }, settings: effectiveSettings({ arm: "c", env: {} }), scratch: "/scratch", engineDir: "/engine", prDir: "/scratch/pr", artifactDir: "/scratch/artifacts",
    traceId: "f".repeat(32), prices: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }, traceAuth: TOKEN,
  });
  const child = spawnEngine({ args: ["-e", "process.stdout.write(JSON.stringify(process.env))"], cwd: tmpdir(), env });
  const result = await child.promise;
  assert.equal(result.exitCode, 0);
  const seen = JSON.parse(result.tail);
  assert.deepEqual(Object.keys(seen).sort(), [...Object.keys(env), "REVIEW_EXIT_WITH_PARENT"].sort(), "the engine's variables plus the marker that makes it follow the harness");
  assert.equal(seen.REVIEW_EXIT_WITH_PARENT, "true");
  for (const name of ["OPENOBSERVE_AUTH_TOKEN", "GH_TOKEN", "SOME_OTHER_SECRET"]) assert.equal(seen[name], undefined, name);
  assert.equal(seen.REVIEW_ARM_STAGGER, "true");
  assert.equal(seen.REVIEW_ARM_SHARED_PREFIX, "true");
  assert.equal(seen.REVIEW_ARM_SHARED_CONTEXT, "true");
  assert.equal(seen.REVIEW_ARM_FOLD, undefined);
  assert.equal(JSON.parse(seen.REVIEW_TOKEN_PRICES).cache_write, 3.75);
});

test("nothing the harness prints holds a credential, even when the server echoes one back", async t => {
  const f = setup(t, { serverOptions: { token: "Basic some-other-token" } });
  const code = await f.run(ARGS("--plan"));
  assert.equal(code, 1);
  const out = f.lines.join("\n");
  assert.match(out, /error: GET \/datasets failed \(401\)/);
  assert.equal(out.includes(TOKEN), false, "the token the server echoed in its message is scrubbed");
  assert.equal(out.includes(MODEL_KEY), false);
  const g = setup(t);
  assert.equal(await g.run(ARGS("--tag", "smoke")), 0);
  const all = g.lines.join("\n");
  for (const secret of [TOKEN, MODEL_KEY, WRITE_TOKEN, "unrelated-secret-value"]) assert.equal(all.includes(secret), false, secret);
  const outbox = [];
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (entry.isDirectory()) walk(p); else outbox.push(readFileSync(p, "utf-8")); } };
  walk(g.stateDir);
  assert.ok(outbox.length >= 3);
  for (const text of outbox) for (const secret of [TOKEN, MODEL_KEY, WRITE_TOKEN]) assert.equal(text.includes(secret), false, "no credential in the persisted state");
});

test("missing credentials are named, never echoed, and stop the run before any request", async t => {
  const f = setup(t);
  await f.ready;
  const code = await f.run(ARGS("--plan"), { env: { OPENOBSERVE_AUTH_TOKEN: "", OPENOBSERVE_ORG: "" } });
  assert.equal(code, 2);
  assert.match(f.lines.join("\n"), /usage: set OPENOBSERVE_ORG, OPENOBSERVE_AUTH_TOKEN/);
  assert.equal(f.server.state.requests.length, 0);
  const g = setup(t);
  assert.equal(await g.run(ARGS(), { env: { OPENROUTER_REVIEW_API_KEY: "" } }), 2);
  assert.match(g.lines.join("\n"), /usage: set OPENROUTER_REVIEW_API_KEY/);
  assert.equal(g.server.state.experiments.size, 0, "no experiment is created when the model key is absent");
});

test("a new experiment fetches OpenRouter's public per-token prices for the slug and freezes them per million tokens in its config", async t => {
  const f = setup(t);
  assert.equal(await f.run(ARGS("--tag", "smoke")), 0);
  const models = f.server.requestsTo("GET", /models$/);
  assert.equal(models.length, 1);
  assert.equal(models[0].auth, undefined, "the public list needs no credential");
  const config = f.server.state.experiments.get("exp1").task.config;
  assert.equal(config.pricing.source, "openrouter");
  assert.equal(config.pricing.slug, SLUG);
  assert.deepEqual(config.pricing.usd_per_million, { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 });
  assert.equal(config.arm, "baseline");
  assert.equal(config.model, SLUG);
  assert.equal(config.variant, "high");
  assert.equal(config.coldPasses, 2);
  assert.deepEqual(config.flags, { stagger: false, sharedPrefix: false, sharedContext: false, fold: false });
  assert.deepEqual(config.engine, { commit: "1".repeat(40) });
  assert.deepEqual(config.dataset, { id: "ds1", name: "ai-code-review-prs-v1" });
  assert.equal(config.tag, "smoke");
  assert.deepEqual(JSON.parse(f.engineCalls[0].env.REVIEW_TOKEN_PRICES), config.pricing.usd_per_million);
});

test("pricing with no cache rates keeps those rates unknown instead of free, and a model OpenRouter does not list stops the run", async () => {
  const server = await fakeOpenObserve({ rows: [], prices: { prompt: "0.000001", completion: "0.000005" } });
  try {
    const pricing = await fetchOpenRouterPricing({ slug: SLUG, baseUrl: server.url });
    assert.deepEqual(pricing.usd_per_million, { input: 1, output: 5, cache_read: null, cache_write: null });
    await assert.rejects(fetchOpenRouterPricing({ slug: "nobody/nothing", baseUrl: server.url }), /lists no model nobody\/nothing/);
    server.state.prices = { prompt: "free" };
    await assert.rejects(fetchOpenRouterPricing({ slug: SLUG, baseUrl: server.url }), /no prompt\/completion price/);
  } finally {
    server.close();
  }
});

test("the fingerprint names the engine commit, the arm and the effective model, effort and pass count", () => {
  const engine = { commit: "1".repeat(40) };
  const fp = (arm, over = {}, eng = engine, env = {}) => taskIdentity({ engine: eng, settings: { ...effectiveSettings({ arm, env }), ...over } }).fingerprint;
  assert.equal(fp("baseline"), fp("baseline"), "stable");
  for (const other of ["a", "b", "c", "d", "e"]) assert.notEqual(fp(other), fp("baseline"), other);
  assert.equal(new Set(["baseline", "a", "b", "c", "d", "e"].map(arm => fp(arm))).size, 6);
  assert.notEqual(fp("baseline", {}, { commit: "2".repeat(40) }), fp("baseline"));
  assert.notEqual(fp("baseline", { model: "other/model" }), fp("baseline"));
  assert.notEqual(fp("baseline", { variant: "low" }), fp("baseline"));
  assert.notEqual(fp("baseline", { coldPasses: 3 }), fp("baseline"));
  assert.notEqual(fp("baseline", {}, engine, { REVIEW_COLD_PASSES: "3" }), fp("baseline"));
  assert.equal(effectiveSettings({ arm: "d", env: {} }).variant, "medium");
  assert.equal(effectiveSettings({ arm: "b", env: {} }).variant, "high");
  assert.deepEqual(effectiveSettings({ arm: "e", env: {} }).flags, { stagger: false, sharedPrefix: false, sharedContext: false, fold: true });
  assert.throws(() => effectiveSettings({ arm: "a", env: { REVIEW_PROVIDER_ID: "anthropic-review" } }), /experiments run on openrouter-review/);
});

test("the engine identity is its commit, and an engine with any uncommitted or untracked file is refused", t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  mkdirSync(join(dir, "scripts", "ai-review", "src"), { recursive: true });
  writeFileSync(join(dir, "scripts", "ai-review", "run-review.mjs"), "a\n");
  writeFileSync(join(dir, "opencode.jsonc"), "{}\n");
  writeFileSync(join(dir, "unrelated.txt"), "x\n");
  git(dir, "add", ".");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "c");
  const commit = git(dir, "rev-parse", "HEAD");
  assert.deepEqual(engineIdentity(dir), { commit });
  writeFileSync(join(dir, "unrelated.txt"), "changed\n");
  assert.deepEqual(engineIdentity(dir), { commit }, "a file outside the engine does not count");
  writeFileSync(join(dir, "scripts", "ai-review", "run-review.mjs"), "b\n");
  assert.throws(() => engineIdentity(dir), /the engine has uncommitted changes \(scripts\/ai-review\/run-review\.mjs\); commit them first/);
  git(dir, "checkout", "--", "scripts");
  // A new helper the runner could import: refused while untracked, whatever its contents become.
  writeFileSync(join(dir, "scripts", "ai-review", "src", "helper.mjs"), "export const a = 1;\n");
  assert.throws(() => engineIdentity(dir), /uncommitted changes \(scripts\/ai-review\/src\/helper\.mjs\)/);
  writeFileSync(join(dir, "scripts", "ai-review", "src", "helper.mjs"), "export const a = 2;\n");
  assert.throws(() => engineIdentity(dir), /helper\.mjs/);
  git(dir, "add", ".");
  assert.throws(() => engineIdentity(dir), /helper\.mjs/, "staged is not committed either");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "helper");
  assert.equal(engineIdentity(dir).commit, git(dir, "rev-parse", "HEAD"));
  writeFileSync(join(dir, "opencode.jsonc"), '{"x":1}\n');
  assert.throws(() => engineIdentity(dir), /opencode\.jsonc/);
  git(dir, "checkout", "--", "opencode.jsonc");
  // The skill references sanitize copies into the review's tree are engine input as well.
  const reference = join(dir, ".claude", "skills", "ui-architect", "references", "a.md");
  mkdirSync(join(dir, ".claude", "skills", "ui-architect", "references"), { recursive: true });
  writeFileSync(reference, "one\n");
  assert.throws(() => engineIdentity(dir), /uncommitted changes \(\.claude\/skills\/ui-architect\/references\/a\.md\)/);
  git(dir, "add", ".");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "reference");
  assert.equal(engineIdentity(dir).commit, git(dir, "rev-parse", "HEAD"));
  writeFileSync(reference, "two\n");
  assert.throws(() => engineIdentity(dir), /references\/a\.md/);
  git(dir, "checkout", "--", ".claude");
  mkdirSync(join(dir, ".claude", "skills", "eslint-error-handling"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "eslint-error-handling", "SKILL.md"), "x\n");
  assert.throws(() => engineIdentity(dir), /eslint-error-handling\/SKILL\.md/);
  // Ignored files in the copied context trees are engine input too; ignored files elsewhere under the engine are not.
  git(dir, "add", ".");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "skills");
  writeFileSync(join(dir, ".gitignore"), "*.bak\nnode_modules/\n");
  git(dir, "add", ".gitignore");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-qm", "ignore");
  assert.equal(engineIdentity(dir).commit, git(dir, "rev-parse", "HEAD"));
  mkdirSync(join(dir, "scripts", "ai-review", "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "scripts", "ai-review", "node_modules", "x", "i.js"), "x\n");
  assert.equal(engineIdentity(dir).commit, git(dir, "rev-parse", "HEAD"), "node_modules under the engine stays allowed");
  writeFileSync(join(dir, ".claude", "skills", "ui-architect", "references", "a.md.bak"), "backup\n");
  assert.throws(() => engineIdentity(dir), /ignored files in the review's context \(\.claude\/skills\/ui-architect\/references\/a\.md\.bak\)/);
  rmSync(join(dir, ".claude", "skills", "ui-architect", "references", "a.md.bak"));
  // That source is the single file SKILL.md, so a backup beside it is never copied into the review.
  writeFileSync(join(dir, ".claude", "skills", "eslint-error-handling", "SKILL.md.bak"), "backup\n");
  assert.equal(engineIdentity(dir).commit, git(dir, "rev-parse", "HEAD"));
  // A tracked file marked assume-unchanged or skip-worktree can be edited with a clean status; the identity refuses the mark.
  const trackedReference = join(dir, ".claude", "skills", "ui-architect", "references", "a.md");
  git(dir, "update-index", "--assume-unchanged", ".claude/skills/ui-architect/references/a.md");
  writeFileSync(trackedReference, "edited behind git's back\n");
  assert.equal(git(dir, "status", "--porcelain", "--", ".claude").includes("a.md"), false, "status is clean, which is the gap");
  assert.throws(() => engineIdentity(dir), /assume-unchanged or skip-worktree files \(\.claude\/skills\/ui-architect\/references\/a\.md\)/);
  git(dir, "update-index", "--no-assume-unchanged", ".claude/skills/ui-architect/references/a.md");
  git(dir, "checkout", "--", ".claude");
  git(dir, "update-index", "--skip-worktree", "scripts/ai-review/run-review.mjs");
  assert.throws(() => engineIdentity(dir), /skip-worktree files \(scripts\/ai-review\/run-review\.mjs\)/);
  git(dir, "update-index", "--no-skip-worktree", "scripts/ai-review/run-review.mjs");
  assert.equal(engineIdentity(dir).commit, git(dir, "rev-parse", "HEAD"));
});

test("every git the harness runs, the engine fingerprinting included, sees an environment without a credential", t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-gitenv-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "env.log");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "git"), `#!/bin/sh\nenv >> ${JSON.stringify(log)}\necho ---- >> ${JSON.stringify(log)}\ncase "$*" in *rev-parse*) echo ${"1".repeat(40)};; esac\n`);
  chmodSync(join(dir, "bin", "git"), 0o755);
  const secrets = { OPENOBSERVE_AUTH_TOKEN: "Basic api-secret-0123456789", OPENROUTER_REVIEW_API_KEY: "sk-or-secret-0123456789", O2_TRACE_AUTH: "Basic trace-secret-0123456789", GH_TOKEN: "ghp_secret0123456789", REVIEW_EXPERIMENT_GH_TOKEN: "ghp_other0123456789" }; // gitleaks:allow
  const before = { ...process.env };
  Object.assign(process.env, secrets, { PATH: `${join(dir, "bin")}:${process.env.PATH}` });
  try {
    assert.equal(engineIdentity(dir).commit, "1".repeat(40));
  } finally {
    for (const name of [...Object.keys(secrets), "PATH"]) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
  const seen = readFileSync(log, "utf-8");
  assert.ok(seen.includes("PATH="), "git did run under the shim");
  assert.equal((seen.match(/----/g) ?? []).length, 4, "status, the hidden-entry listing, the context's ignored-file status and rev-parse");
  for (const secret of Object.values(secrets)) assert.equal(seen.includes(secret), false, secret);
  for (const name of Object.keys(secrets)) assert.equal(seen.includes(`${name}=`), false, name);
});

// Is a process still running (a zombie is not)?
function running(pid) {
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf-8"));
  } catch {
    return false;
  }
}

async function waitForFile(path) {
  for (let i = 0; i < 100 && !existsSync(path); i += 1) await new Promise(done => setTimeout(done, 50));
  return readFileSync(path, "utf-8");
}

test("cancelling the engine ends what it started too, and the result only arrives once nothing of it is left", { skip: !existsSync("/proc/self/stat") && "needs /proc" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-tree-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The engine starts a grandchild that holds on for a minute, as opencode would.
  const script = 'const { spawn } = require("node:child_process"); const g = spawn("sleep", ["60"], { stdio: "ignore" }); require("node:fs").writeFileSync(process.argv[1], String(g.pid)); setInterval(() => {}, 1000);';
  const pidFile = join(dir, "grandchild.pid");
  const engine = spawnEngine({ args: ["-e", script, pidFile], cwd: dir, env: { PATH: process.env.PATH }, graceMs: 200 });
  const grandchild = Number(await waitForFile(pidFile));
  assert.equal(running(grandchild), true);
  engine.kill();
  const result = await engine.promise;
  assert.equal(running(grandchild), false, "the grandchild is gone by the time the result arrives");
  assert.ok(result.exitCode === null || result.signal, "the engine itself was ended");
});

test("an engine that exits on its own but leaves a child behind has it removed before the result arrives", { skip: !existsSync("/proc/self/stat") && "needs /proc" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-tree-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = 'const { spawn } = require("node:child_process"); const g = spawn("sleep", ["60"], { stdio: "ignore" }); require("node:fs").writeFileSync(process.argv[1], String(g.pid)); process.exit(0);';
  const pidFile = join(dir, "leftover.pid");
  const result = await spawnEngine({ args: ["-e", script, pidFile], cwd: dir, env: { PATH: process.env.PATH } }).promise;
  assert.equal(result.exitCode, 0);
  assert.equal(running(Number(readFileSync(pidFile, "utf-8"))), false);
});

test("a resume plans from the experiment's own pinned snapshot, tag and slots, whatever the dataset's rows say now", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 130);
  const rowPagesBefore = f.server.requestsTo("GET", /\/datasets\/ds1\/rows$/).length;
  // The tag the experiment was created with is part of its identity.
  f.lines.length = 0;
  assert.equal(await f.run(ARGS("--resume", "exp1")), 1);
  assert.match(f.lines.join("\n"), /experiment exp1 was created with tag smoke; pass --tag smoke/);
  // Now every row is retagged: nothing carries "smoke" in the dataset any more.
  for (const row of f.server.state.rows) row.tags = ["retagged"];
  f.lines.length = 0;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1", "--plan")), 0);
  const out = f.lines.join("\n");
  assert.match(out, /experiment exp1 pins snapshot version 7, tag smoke; the dataset's current rows are not read/);
  assert.match(out, /so 2 slots/);
  assert.match(out, /1 of 2 slots already reported/);
  const callsBefore = f.engineCalls.length;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.deepEqual(f.engineCalls.slice(callsBefore).map(c => c.row), ["r2"], "the slot the experiment still lacks, not 'no rows'");
  assert.equal(f.server.requestsTo("GET", /\/datasets\/ds1\/rows$/).length, rowPagesBefore, "the dataset's rows were not paged on resume");
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
});

test("a run holds the run lock before it reads the experiment it will act on, and a plan takes no lock", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true } } });
  assert.equal(await f.run(ARGS("--tag", "smoke")), 130);
  const held = [];
  f.server.state.hook = async (method, path) => {
    if (method === "GET" && /\/experiments\/exp1$/.test(path)) held.push(await acquireRunLock(f.stateDir).then(async release => { await release(); return false; }, () => true));
  };
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.ok(held.length >= 1);
  assert.deepEqual([...new Set(held)], [true], "the lock was already ours at every read of the experiment");
  held.length = 0;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1", "--plan")), 0);
  assert.deepEqual([...new Set(held)], [false], "a plan holds nothing");
  // A second harness while one runs is refused before it reads anything.
  const release = await acquireRunLock(f.stateDir);
  const requestsBefore = f.server.state.requests.length;
  f.lines.length = 0;
  assert.equal(await f.run(ARGS("--tag", "smoke")), 1);
  assert.match(f.lines.join("\n"), /another experiment run is active/);
  assert.equal(f.server.state.requests.length, requestsBefore, "no request was made");
  await release();
});

test("overlapping valid matches still pair every finding they can", () => {
  // Expected lines 10 and 15, kept lines 10 and 5, one title: greedy pairing takes 10-10 and strands 15; the best assignment is 10-5 and 15-10.
  const expected = [finding("src/a.rs", 10, "Missing bounds check on parse"), finding("src/a.rs", 15, "Missing bounds check on parse")];
  const kept = [finding("src/a.rs", 10, "Missing bounds check on parse"), finding("src/a.rs", 5, "Missing bounds check on parse")];
  assert.deepEqual(scoreFindings(expected, kept), { matched: 2, recall: 1, newFindings: 0 });
  assert.deepEqual(matchFindings(expected, kept).sort(), [[0, 1], [1, 0]]);
  // Among equally large assignments the exact title and the nearer line win.
  const one = [finding("src/a.rs", 10, "Missing bounds check on parse")];
  assert.deepEqual(matchFindings(one, [finding("src/a.rs", 14, "Missing bounds check on parse input"), finding("src/a.rs", 11, "Missing bounds check on parse input")]), [[0, 1]]);
  // Larger sets, more kept than expected and the other way round.
  const many = Array.from({ length: 6 }, (_, i) => finding("src/a.rs", 10 + i * 3, "Missing bounds check on parse"));
  assert.equal(scoreFindings(many, many.slice(0, 4)).matched, 4);
  assert.equal(scoreFindings(many.slice(0, 2), many).matched, 2);
  assert.deepEqual(matchFindings([], many), []);
  assert.deepEqual(matchFindings(many, []), []);
});

test("a harness killed outright takes its engine and everything the engine started down with it", { skip: !existsSync("/proc/self/stat") && "needs /proc" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-orphan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pidFile = join(dir, "pids");
  const engineScript = `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; import { exitWithParent } from ${JSON.stringify(new URL("../src/parent-exit.mjs", import.meta.url).href)}; const g = spawn("sleep", ["60"], { stdio: "ignore" }); exitWithParent(); writeFileSync(${JSON.stringify(pidFile)}, g.pid + " " + process.pid); setInterval(() => {}, 1000);`;
  const harnessScript = `import { spawnEngine } from ${JSON.stringify(new URL("../src/experiment-run.mjs", import.meta.url).href)}; spawnEngine({ args: ["--input-type=module", "-e", ${JSON.stringify(engineScript)}], cwd: ${JSON.stringify(dir)}, env: { PATH: process.env.PATH } }); setInterval(() => {}, 1000);`;
  const harness = spawn(process.execPath, ["--input-type=module", "-e", harnessScript], { stdio: "ignore" });
  const pids = [];
  t.after(() => {
    harness.kill("SIGKILL");
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  });
  pids.push(...(await waitForFile(pidFile)).split(" ").map(Number));
  assert.equal(pids.length, 2);
  for (const pid of pids) assert.equal(running(pid), true);
  harness.kill("SIGKILL");
  for (let i = 0; i < 100 && pids.some(running); i += 1) await new Promise(done => setTimeout(done, 50));
  for (const pid of pids) assert.equal(running(pid), false, `process ${pid} outlived the harness`);
});

test("exitWithParent does nothing unless the harness asked, waits for the go byte, and ends the group when its pipe closes", async () => {
  const idle = new EventEmitter();
  assert.equal(await exitWithParent({ env: {}, stdin: idle }), false);
  assert.equal(idle.listenerCount("end"), 0);
  const calls = [];
  const make = () => Object.assign(new EventEmitter(), { resume: () => calls.push("resume"), unref: () => calls.push("unref") });
  const options = { env: { REVIEW_EXIT_WITH_PARENT: "true" }, kill: (pid, signal) => calls.push(["kill", pid, signal]), pid: 4242, exit: code => calls.push(["exit", code]) };
  const stdin = make();
  const go = exitWithParent({ ...options, stdin, onGone: () => calls.push("gone") });
  let resolved = false;
  go.then(() => { resolved = true; });
  await new Promise(done => setImmediate(done));
  assert.equal(resolved, false, "nothing starts before the byte");
  assert.deepEqual(calls, ["resume"], "the pipe stays referenced while the engine waits");
  stdin.emit("data", Buffer.from("g"));
  assert.equal(await go, true);
  assert.deepEqual(calls, ["resume", "unref"], "after go it no longer keeps a finished engine alive");
  stdin.emit("end");
  assert.deepEqual(calls.slice(2), ["gone", ["kill", -4242, "SIGKILL"], ["exit", 1]]);
  // EOF before the byte: the group is ended at once and the start never comes.
  calls.length = 0;
  const early = make();
  let started = false;
  exitWithParent({ ...options, stdin: early, onGone: () => calls.push("gone") }).then(() => { started = true; });
  early.emit("end");
  await new Promise(done => setImmediate(done));
  assert.deepEqual(calls.slice(1), ["gone", ["kill", -4242, "SIGKILL"], ["exit", 1]]);
  assert.equal(started, false);
  // Whatever cleanup throws, the group is still ended and the process still exits.
  calls.length = 0;
  const failing = Object.assign(new EventEmitter(), { resume() {}, unref() {} });
  exitWithParent({ ...options, stdin: failing, onGone: () => { throw new Error("cleanup failed"); }, kill: () => { throw new Error("no such group"); } });
  failing.emit("end");
  assert.deepEqual(calls, [["exit", 1]]);
});

test("a real engine does no work before the harness published its group, and exits at once when the pipe closes before the go byte", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-go-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const marker = join(dir, "started");
  const engine = `import { exitWithParent } from ${JSON.stringify(new URL("../src/parent-exit.mjs", import.meta.url).href)}; import { writeFileSync } from "node:fs"; await exitWithParent(); writeFileSync(${JSON.stringify(marker)}, "x");`;
  const args = ["--input-type=module", "-e", engine];
  // The group is published first, and only then does the engine start; the marker is absent while onSpawn runs and present after the result.
  const seen = [];
  const result = await spawnEngine({ args, cwd: dir, env: { PATH: process.env.PATH }, onSpawn: pgid => { seen.push([pgid, existsSync(marker)]); } }).promise;
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen.map(entry => entry[1]), [false]);
  assert.equal(existsSync(marker), true, "the go byte started it");
  rmSync(marker);
  // A group that cannot be recorded never gets "go": the engine is ended before it works.
  const unrecorded = await spawnEngine({ args, cwd: dir, env: { PATH: process.env.PATH }, onSpawn: () => { throw new Error("disk full"); } }).promise;
  assert.match(unrecorded.tail, /could not record the engine group: disk full/);
  assert.equal(existsSync(marker), false);
  // The record is written before the byte, never after it (both happen in one tick, so the order is pinned in the source).
  assert.match(readFileSync(new URL("../src/experiment-run.mjs", import.meta.url), "utf-8"), /onSpawn\?\.\(child\.pid\);\n\s+child\.stdin\.write\("g"\);/);
  // The harness dies (here: closes the pipe) before it sent anything: the engine exits at once, with no work done.
  const child = spawn(process.execPath, args, { cwd: dir, env: { PATH: process.env.PATH, REVIEW_EXIT_WITH_PARENT: "true" }, stdio: ["pipe", "ignore", "ignore"] });
  const exited = new Promise(done => child.once("exit", (code, signal) => done({ code, signal })));
  child.stdin.end();
  const outcome = await Promise.race([exited, new Promise(done => setTimeout(() => done("still running"), 10_000))]);
  if (outcome === "still running") child.kill("SIGKILL");
  assert.notEqual(outcome, "still running");
  assert.equal(existsSync(marker), false);
});

test("spawnEngine does not report a finished engine while its group still exists, and keeps the record", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-stuck-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const events = [];
  // A group that signal 0 keeps finding, whatever SIGKILL does (as an unreapable member would).
  const stuck = (pid, signal) => (signal === 0 && pid < 0 ? true : process.kill(pid, signal));
  const started = Date.now();
  const result = await spawnEngine({ args: ["-e", "process.exit(0)"], cwd: dir, env: { PATH: process.env.PATH }, groupWaitMs: 300, kill: stuck, onSpawn: () => events.push("spawn"), onGone: () => events.push("gone") }).promise;
  assert.equal(result.groupAlive, true);
  assert.ok(Date.now() - started >= 300, "it kept sweeping until the wait was spent");
  assert.deepEqual(events, ["spawn"], "the group is not reported gone");
  // The harness stops on it: no further slot runs and the record stays.
  const f = setup(t);
  let engines = 0;
  const runEngine = options => {
    engines += 1;
    options.onSpawn(2_000_000_000);
    return { promise: Promise.resolve({ exitCode: 0, signal: null, tail: "", timedOut: false, groupAlive: true }), kill() {} };
  };
  assert.equal(await f.run(ARGS("--tag", "smoke"), { deps: { runEngine } }), 1);
  assert.equal(engines, 1, "the second slot never started");
  assert.match(f.lines.join("\n"), /engine process group is still alive/);
  assert.equal(existsSync(join(f.stateDir, "engine-group.json")), true);
});

test("a finished review whose group is still alive is saved before the run stops, and a resume replays it without paying for the slot again", async t => {
  const f = setup(t);
  // The engine finishes with a valid summary, but a descendant keeps its group past the sweep.
  const stuckEngine = options => {
    options.onSpawn(2_000_000_000);
    const engine = f.runEngine(options);
    return { promise: engine.promise.then(result => ({ ...result, groupAlive: true })), kill: engine.kill };
  };
  assert.equal(await f.run(ARGS("--tag", "smoke"), { deps: { runEngine: stuckEngine } }), 1);
  assert.deepEqual(f.engineCalls.map(call => call.row), ["r1"], "no second review started");
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 0, "nothing finalized");
  assert.equal(existsSync(join(f.stateDir, "engine-group.json")), true, "the group's record stays");
  assert.equal(readdirSync(join(f.stateDir, "outbox")).length, 1, "the finished slot's report is in the outbox");
  assert.equal(f.server.requestsTo("POST", /\/records$/).length, 0, "not submitted while the group lives");
  // The group is gone (here: its id never existed): the resume replays the saved report and reviews only what is missing.
  const before = f.engineCalls.length;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.deepEqual(f.engineCalls.slice(before).map(call => call.row), ["r2"], "slot r1 is not reviewed again");
  const posted = f.server.requestsTo("POST", /\/records$/).flatMap(request => request.body.records.map(record => record.rowId));
  assert.deepEqual([...posted].sort(), ["r1", "r2"]);
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
});

test("an orphan's cooldown is sampled after the liveness probe, so a group that ends during the acquire cannot start the clock early", { skip: !existsSync("/proc/self/stat") && "needs /proc" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-probe-order-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A detached process that outlives its parent, so nothing of this test holds a zombie of it.
  const starter = spawn(process.execPath, ["-e", 'const c = require("node:child_process").spawn("sleep", ["60"], { detached: true, stdio: "ignore" }); c.unref(); console.log(c.pid);'], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  starter.stdout.on("data", chunk => { out += chunk; });
  // "close", not "exit": stdout is fully read by then. Nothing is signalled until the output is a real group id.
  const status = await new Promise(done => starter.once("close", (code, signal) => done({ code, signal })));
  assert.deepEqual(status, { code: 0, signal: null }, "the helper started the fixture");
  assert.match(out.trim(), /^\d+$/, "the helper printed one integer");
  const pgid = Number(out.trim());
  assert.ok(Number.isInteger(pgid) && pgid > 1, `group id ${pgid}`);
  t.after(() => { try { process.kill(-pgid, "SIGKILL"); } catch { /* gone */ } });
  recordEngineGroup(dir, pgid, "row-q");
  const dead = () => { try { return /^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pgid}/stat`, "utf-8")); } catch { return true; } };
  // The clock is read at the moment the group ends: if that read came before the probe, the probe would find it dead and clear the record.
  const now = () => {
    process.kill(-pgid, "SIGKILL");
    for (let i = 0; i < 400 && !dead(); i += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    return 7_777;
  };
  await assert.rejects(acquireRunLock(dir, { now }), /is still running/, "the probe ran first and saw the live group");
  assert.deepEqual(readCooldown(dir), { all: 7_777, rows: { "row-q": 7_777 } }, "the cooldown holds a time read after the probe");
  assert.equal(existsSync(join(dir, "engine-group.json")), true, "so the record stays until a later look finds the group gone");
  // That later look: the group is gone, the clock is sampled after the probe and persisted, then the record goes.
  const order = [];
  await (await acquireRunLock(dir, { now: () => { order.push(["now", existsSync(join(dir, "engine-group.json"))]); return 9_999; } }))();
  assert.deepEqual(order, [["now", true]], "the record still existed when the time was sampled, and is cleared after");
  assert.deepEqual(readCooldown(dir), { all: 9_999, rows: { "row-q": 9_999 } });
  assert.equal(existsSync(join(dir, "engine-group.json")), false);
});

test("an interrupt that arrives after the engine finished still saves its report for the resume, which reviews only what is unfinished", async t => {
  const f = setup(t);
  // The engine has exited cleanly with a valid summary, but the harness is still sweeping when Ctrl-C comes.
  const lateInterrupt = options => {
    const engine = f.runEngine(options);
    const promise = engine.promise.then(result => new Promise(resolve => {
      process.emit("SIGINT");
      setTimeout(() => resolve(result), 5);
    }));
    return { promise, kill() {} };
  };
  let first = true;
  const runEngine = options => (first ? ((first = false), lateInterrupt(options)) : f.runEngine(options));
  assert.equal(await f.run(ARGS("--tag", "smoke"), { deps: { runEngine } }), 130);
  assert.deepEqual(f.engineCalls.map(call => call.row), ["r1"], "the second slot never started");
  assert.equal(readdirSync(join(f.stateDir, "outbox", readdirSync(join(f.stateDir, "outbox"))[0])).length, 1, "the finished slot's report was saved");
  assert.equal(f.server.requestsTo("POST", /\/records$/).length, 0, "not submitted");
  assert.equal(f.server.requestsTo("POST", /\/finalize$/).length, 0, "not finalized");
  assert.match(f.lines.join("\n"), /interrupted; not finalized/);
  // The resume replays it and reviews only the slot that never ran.
  const before = f.engineCalls.length;
  assert.equal(await f.run(ARGS("--tag", "smoke", "--resume", "exp1")), 0);
  assert.deepEqual(f.engineCalls.slice(before).map(call => call.row), ["r2"], "slot r1 is not paid for again");
  const posted = f.server.requestsTo("POST", /\/records$/).flatMap(request => request.body.records.map(record => record.rowId));
  assert.deepEqual([...posted].sort(), ["r1", "r2"]);
  assert.equal(f.server.state.experiments.get("exp1").status, "completed");
});

test("a repeated signal while the engine is being ended reaches the handler again, and the handler is gone only after cleanup", async t => {
  const f = setup(t, { scenarios: { "r2#0": { interrupt: true, interruptSignals: 3 } } });
  const before = process.listenerCount("SIGINT");
  assert.equal(await f.run(ARGS("--tag", "smoke")), 130);
  assert.equal(f.kills, 3, "every signal asked the engine to stop");
  assert.equal(process.listenerCount("SIGINT"), before, "the handler was removed once the run was over");
});

test("scoring costs nothing when a side is empty or nothing is eligible, and follows the pairs there are otherwise", { timeout: 30_000 }, () => {
  const many = Array.from({ length: 5000 }, (_, i) => finding(`src/f${i % 50}.rs`, 10 + i, `Distinct problem number ${i}`));
  assert.deepEqual(scoreFindings(many, []), { matched: 0, recall: 0, newFindings: 0 });
  assert.deepEqual(scoreFindings([], many), { matched: 0, recall: 1, newFindings: 5000 });
  const unread = { get file() { assert.fail("an empty side needs no pair enumeration"); } };
  assert.deepEqual(matchFindings([unread], []), []);
  assert.deepEqual(matchFindings([], [unread]), []);
  const elsewhere = many.map(item => ({ ...item, file: `other/${item.file}` }));
  assert.deepEqual(scoreFindings(many, elsewhere), { matched: 0, recall: 0, newFindings: 5000 });
  // Thousands of expected findings against one kept one that fits all of them: one pair, from a one-row matrix.
  const same = Array.from({ length: 4000 }, () => finding("src/a.rs", 10, "Missing bounds check on parse"));
  assert.equal(scoreFindings(same, [finding("src/a.rs", 10, "Missing bounds check on parse")]).matched, 1);
  assert.equal(scoreFindings([finding("src/a.rs", 10, "Missing bounds check on parse")], same).matched, 1);
  // Groups are independent: several files, each with its own overlap.
  const twoFiles = [finding("a.rs", 10, "Missing bounds check on parse"), finding("a.rs", 15, "Missing bounds check on parse"), finding("b.rs", 3, "Unchecked unwrap on config")];
  const keptTwo = [finding("a.rs", 10, "Missing bounds check on parse"), finding("a.rs", 5, "Missing bounds check on parse"), finding("b.rs", 4, "Unchecked unwrap on config")];
  assert.deepEqual(matchFindings(twoFiles, keptTwo), [[0, 1], [1, 0], [2, 2]]);
  // Both sides have three participants, but the two findings at line 5 share their only eligible partner.
  const at = line => finding("a.rs", line, "Missing bounds check on parse");
  assert.equal(scoreFindings([at(5), at(5), at(10)], [at(5), at(15), at(15)]).matched, 2);
});

test("the engine group a dead harness left on record keeps the next run out until nothing of it is alive, and counts as activity for its row", { skip: !existsSync("/proc/self/stat") && "needs /proc" }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-orphan-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The harness holds the lock and starts an engine that ignores the closing of its stdin, so the review outlives it.
  const stateUrl = new URL("../src/experiment-state.mjs", import.meta.url).href;
  const runUrl = new URL("../src/experiment-run.mjs", import.meta.url).href;
  const engine = 'const { spawn } = require("node:child_process"); spawn("sleep", ["60"], { stdio: "ignore" }); setInterval(() => {}, 1000);';
  const harnessScript = `import { acquireRunLock, recordEngineGroup, clearEngineGroup } from ${JSON.stringify(stateUrl)}; import { spawnEngine } from ${JSON.stringify(runUrl)}; const dir = ${JSON.stringify(dir)}; await acquireRunLock(dir); spawnEngine({ args: ["-e", ${JSON.stringify(engine)}], cwd: dir, env: { PATH: process.env.PATH }, onSpawn: pgid => recordEngineGroup(dir, pgid, "row-x"), onGone: () => clearEngineGroup(dir) }); console.log("started"); setInterval(() => {}, 1000);`;
  const harness = spawn(process.execPath, ["--input-type=module", "-e", harnessScript], { stdio: ["ignore", "pipe", "inherit"] });
  let group = 0;
  t.after(() => {
    harness.kill("SIGKILL");
    if (group) { try { process.kill(-group, "SIGKILL"); } catch { /* gone */ } }
  });
  await new Promise(done => harness.stdout.once("data", done));
  group = JSON.parse(await waitForFile(join(dir, "engine-group.json"))).pgid;
  await assert.rejects(acquireRunLock(dir), /another experiment run is active/, "a live harness holds the lock itself");
  harness.kill("SIGKILL");
  await new Promise(done => harness.once("exit", done));
  assert.equal(running(group), true, "the engine survived the harness (it does not watch its stdin)");
  // The lock socket is free now, yet a second run may not start while the first one's review is running.
  await assert.rejects(acquireRunLock(dir, { now: () => 777 }), new RegExp(`engine process group ${group} of an earlier run \\(row row-x\\) is still running`));
  assert.deepEqual(readCooldown(dir), { all: 777, rows: { "row-x": 777 } }, "the row counts as active");
  process.kill(-group, "SIGKILL");
  const alive = () => { try { process.kill(-group, 0); return true; } catch { return false; } };
  for (let i = 0; i < 100 && (running(group) || alive()); i += 1) await new Promise(done => setTimeout(done, 50));
  await (await acquireRunLock(dir))();
  assert.equal(existsSync(join(dir, "engine-group.json")), false, "a record of a gone group is dropped");
});

test("spawnEngine reports the engine's group as it starts and again only once the group is gone", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-spawn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const events = [];
  const result = await spawnEngine({ args: ["-e", "process.exit(0)"], cwd: dir, env: { PATH: process.env.PATH }, onSpawn: pgid => events.push(["spawn", pgid]), onGone: () => events.push(["gone"]) }).promise;
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events.map(event => event[0]), ["spawn", "gone"]);
  assert.ok(Number.isInteger(events[0][1]) && events[0][1] > 1);
  // An engine that cannot be started reports no group at all.
  const missing = await spawnEngine({ command: join(dir, "no-such-binary"), args: [], cwd: dir, env: {}, onSpawn: pgid => events.push(["spawn-missing", pgid]), onGone: () => events.push(["gone-missing"]) }).promise;
  assert.equal(missing.exitCode, null);
  assert.equal(events.some(event => event[0].endsWith("missing")), false);
});

test("clearing an orphan's record counts as activity for its row at the moment the exit is seen, even when the group is already gone", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-orphan-gone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  recordEngineGroup(dir, 2_000_000_000, "row-y"); // a group id that does not exist: the review ended after the last heartbeat
  touchCooldown(dir, "row-y", 1_000); // the dead harness's last heartbeat, long before
  await (await acquireRunLock(dir, { now: () => 5_000_000 }))();
  assert.deepEqual(readCooldown(dir), { all: 5_000_000, rows: { "row-y": 5_000_000 } }, "both scopes start from the observation, not the stale heartbeat");
  assert.equal(existsSync(join(dir, "engine-group.json")), false, "and the record is gone");
  // No record: nothing to count.
  await (await acquireRunLock(dir, { now: () => 9_000_000 }))();
  assert.equal(readCooldown(dir).all, 5_000_000);
});

test("a failure after the lock is taken closes it again, so the next attempt can take it", async t => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-lock-fail-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A record of a dead group, and a cooldown.json that cannot be replaced: the cooldown write after the bind fails.
  recordEngineGroup(dir, 2_000_000_000, "row-z");
  mkdirSync(join(dir, "cooldown.json"));
  writeFileSync(join(dir, "cooldown.json", "keep"), "x");
  await assert.rejects(acquireRunLock(dir), err => !/another experiment run is active/.test(err.message));
  // The same port is free at once (without the fix the first attempt kept it open and this one reported another active run).
  rmSync(join(dir, "cooldown.json"), { recursive: true });
  await (await acquireRunLock(dir))();
});

test("the harness records each engine's group as it starts and clears it once the group is gone", async t => {
  const f = setup(t);
  const seen = [];
  const runEngine = options => {
    options.onSpawn(2_000_000_000);
    seen.push(JSON.parse(readFileSync(join(f.stateDir, "engine-group.json"), "utf-8")));
    const engine = f.runEngine(options);
    engine.promise.then(() => { options.onGone(); seen.push(existsSync(join(f.stateDir, "engine-group.json"))); });
    return engine;
  };
  assert.equal(await f.run(ARGS("--tag", "smoke", "--trials", "1"), { deps: { runEngine } }), 0);
  assert.deepEqual(seen.filter(entry => typeof entry === "object").map(entry => entry.pgid), [2_000_000_000, 2_000_000_000]);
  assert.match(seen[0].rowKey, /@/);
  assert.deepEqual(seen.filter(entry => typeof entry === "boolean"), [false, false], "cleared after each engine");
  // A group id that is not a live group does not stop the next run.
  recordEngineGroup(f.stateDir, 2_000_000_000, "x");
  await (await acquireRunLock(f.stateDir))();
  clearEngineGroup(f.stateDir);
});
