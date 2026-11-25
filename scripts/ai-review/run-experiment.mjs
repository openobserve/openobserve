#!/usr/bin/env node
// Runs the review engine over an OpenObserve dataset as an SDK experiment: one dry-run review per row and trial, reported to
// /experiments/{id}/records. A developer tool for the o2o container (README: "Cost experiments"), never a workflow.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { ARM_ENV } from "./src/arms.mjs";
import {
  ApiError,
  OpenObserveApi,
  createExperiment,
  fetchOpenRouterPricing,
  pageResults,
  pageSlots,
  readDatasetRows,
  resolveDataset,
  rowsWithIds,
  rowsWithTag,
  scoreConfigProblems,
} from "./src/experiment-api.mjs";
import {
  EXPERIMENT_KEY_ENV,
  buildEngineEnv,
  checkoutPinned,
  effectiveSettings,
  engineIdentity,
  readRunSummary,
  spawnEngine,
  taskIdentity,
  traceAuthFrom,
} from "./src/experiment-run.mjs";
import { slotScores, usageFromSummary } from "./src/experiment-score.mjs";
import {
  acquireRunLock,
  clearEngineGroup,
  cooldownWaitMs,
  defaultStateDir,
  pendingOutbox,
  readCooldown,
  recordEngineGroup,
  saveOutbox,
  touchCooldown,
  workDirProblem,
} from "./src/experiment-state.mjs";
import { FULL_SHA_RE } from "./src/pr-diff.mjs";
import { mapStrings } from "./src/report.mjs";
import { scrubSecrets } from "./src/scrub.mjs";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HEARTBEAT_MS = 10_000;
const TERMINAL_TASK_STATUS = new Set(["ok", "skipped"]);
const ARM_NOTES = {
  baseline: "Current behaviour.",
  a: "A: staggered start; one reviewer primes the provider cache first.",
  b: "B: A plus a shared system prefix; agent instructions move to the user turn.",
  c: "C: B plus the PR context, one common diff and the impact map in the shared system prompt.",
  d: "D: medium effort for reviewers and coordinator.",
  e: "E: Security folded into Correctness; Performance and Documentation into Code Quality.",
};

export class UsageError extends Error {}

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      options: {
        dataset: { type: "string" },
        arm: { type: "string" },
        trials: { type: "string" },
        tag: { type: "string" },
        rows: { type: "string" },
        resume: { type: "string" },
        "row-gap-min": { type: "string", default: "6" },
        "gap-scope": { type: "string", default: "all" },
        plan: { type: "boolean", default: false },
      },
    }).values;
  } catch (err) {
    throw new UsageError(err.message);
  }
  if (!parsed.dataset) throw new UsageError("--dataset <name|id> is required");
  if (!ARM_ENV[parsed.arm]) throw new UsageError(`--arm must be one of ${Object.keys(ARM_ENV).join(", ")}`);
  if (!/^\d+$/.test(parsed.trials ?? "") || Number(parsed.trials) < 1 || Number(parsed.trials) > 50) throw new UsageError("--trials must be a whole number from 1 to 50");
  const gapMin = Number(parsed["row-gap-min"]);
  if (!Number.isFinite(gapMin) || gapMin < 0) throw new UsageError("--row-gap-min must be a number of minutes, 0 or more");
  if (!["all", "row"].includes(parsed["gap-scope"])) throw new UsageError("--gap-scope must be all or row");
  if (parsed.tag !== undefined && !/^[\w.:-]{1,64}$/.test(parsed.tag)) throw new UsageError("--tag may only hold letters, digits and . _ : -");
  let rows;
  if (parsed.rows !== undefined) {
    if (parsed.tag !== undefined) throw new UsageError("--rows and --tag are two ways to select rows; pass one");
    rows = [...new Set(parsed.rows.split(","))];
    if (rows.some(id => !/^[\w.:-]{1,64}$/.test(id))) throw new UsageError("--rows takes comma-separated logical ids, each holding only letters, digits and . _ : -");
  }
  return { dataset: parsed.dataset, arm: parsed.arm, trials: Number(parsed.trials), tag: parsed.tag, rows, resume: parsed.resume, gapMs: gapMin * 60_000, gapScope: parsed["gap-scope"], plan: parsed.plan };
}

// One slot's dataset row: the repository and both commits it names, or why it cannot be reviewed.
export function rowOfSlot(slot) {
  const input = slot.input ?? {};
  const row = { rowId: slot.rowId, trialIndex: slot.trialIndex, repo: input.repo, prNumber: Number(input.pr_number), mergeBase: input.merge_base_sha, head: input.head_sha };
  const problems = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(row.repo ?? "")) problems.push("repo is not owner/name");
  if (!Number.isInteger(row.prNumber) || row.prNumber < 1) problems.push("pr_number is not a positive integer");
  if (!FULL_SHA_RE.test(row.mergeBase ?? "")) problems.push("merge_base_sha is not a full commit SHA");
  if (!FULL_SHA_RE.test(row.head ?? "")) problems.push("head_sha is not a full commit SHA");
  return { row, problem: problems.join("; ") };
}

// Turns what the engine left behind into the slot's record and scores. Usage is reported on every status: a failed run was still billed.
export function buildSlotReport({ slot, fingerprint, summary, engine, latencyMs, traceId, failure = "" }) {
  const base = { rowId: slot.rowId, trialIndex: slot.trialIndex, taskFingerprint: fingerprint, latencyMs, executedAt: Date.now(), traceId };
  const usage = usageFromSummary(summary);
  const withUsage = {
    ...base,
    ...(usage.tokensIn !== null ? { tokensIn: usage.tokensIn } : {}),
    ...(usage.tokensOut !== null ? { tokensOut: usage.tokensOut } : {}),
    ...(usage.cost !== null ? { cost: usage.cost } : {}),
  };
  if (failure) return { record: { ...withUsage, status: "error", errorMessage: failure, errorAttemptCount: 1 }, scores: [] };
  if (!summary) {
    const detail = engine ? `exit ${engine.exitCode ?? engine.signal}${engine.timedOut ? ", timed out" : ""}: ${engine.tail.trim().split("\n").slice(-3).join(" | ")}` : "not run";
    return { record: { ...withUsage, status: "error", errorMessage: `the engine left no run summary (${detail})`, errorAttemptCount: 1 }, scores: [] };
  }
  if (summary.outcome === "skipped") return { record: { ...withUsage, status: "skipped", skipMessage: "no meaningful changes to review after filtering" }, scores: [] };
  if (summary.outcome !== "success" && summary.outcome !== "partial_success") {
    return { record: { ...withUsage, status: "error", errorMessage: `${summary.outcome}${summary.error ? `: ${summary.error}` : ""}`, errorAttemptCount: 1 }, scores: [] };
  }
  const kept = Array.isArray(summary.kept_findings) ? summary.kept_findings : [];
  const output = { outcome: summary.outcome, tier: summary.tier, agents: summary.agents, keptFindings: kept, findingsKnown: summary.kept_findings_known === true, ...(summary.folds ? { folds: summary.folds } : {}) };
  return {
    record: { ...withUsage, status: "ok", output },
    scores: slotScores({ rowId: slot.rowId, trialIndex: slot.trialIndex, usage, expectedOutput: slot.expectedOutput, kept }),
  };
}

// Every part of a batch has its own verdict; a part with none counts as refused.
export function rejectionsOf(payload, response) {
  const rejections = [];
  const check = (kind, sent, verdicts) => sent.forEach((part, index) => {
    const verdict = (verdicts ?? []).find(v => v.index === index);
    if (!verdict?.accepted) {
      rejections.push({ kind, rowId: part.rowId, trialIndex: part.trialIndex, code: verdict?.error?.code ?? "no_verdict", message: verdict?.error?.message ?? "the server gave no verdict for this part" });
    }
  });
  check("record", payload.records, response?.records);
  check("score", payload.scores, response?.scores);
  return rejections;
}

const slotKey = slot => `${slot.rowId}#${slot.trialIndex}`;

// Trial-major, so a row's trials are as far apart as the rows allow.
export function runOrder(slots) {
  const rowOrder = new Map();
  for (const slot of slots) if (!rowOrder.has(slot.rowId)) rowOrder.set(slot.rowId, rowOrder.size);
  return [...slots].sort((a, b) => a.trialIndex - b.trialIndex || rowOrder.get(a.rowId) - rowOrder.get(b.rowId));
}

function experimentUrl(env, id) {
  return `${env.OPENOBSERVE_URL.replace(/\/+$/, "")}/web/ai/experiments/${id}?org_identifier=${encodeURIComponent(env.OPENOBSERVE_ORG)}`;
}

export async function main({ argv = process.argv.slice(2), env = process.env, deps = {} } = {}) {
  const secrets = Object.fromEntries(["OPENOBSERVE_AUTH_TOKEN", EXPERIMENT_KEY_ENV, "O2_TRACE_AUTH", "REVIEW_EXPERIMENT_GH_TOKEN"].filter(name => env[name]).map(name => [name, env[name]]));
  const scrub = text => scrubSecrets(String(text), secrets).text;
  const say = line => (deps.out ?? console.log)(scrub(line));
  const sleep = deps.sleep ?? (ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms)));
  const now = deps.now ?? Date.now;
  let interrupted = false;
  let current = null;
  let releaseLock = () => {};
  const onSignal = () => {
    interrupted = true;
    current?.kill();
  };
  const handleSignals = deps.handleSignals !== false;
  try {
    const args = parseCli(argv);
    const missing = ["OPENOBSERVE_URL", "OPENOBSERVE_ORG", "OPENOBSERVE_AUTH_TOKEN"].filter(name => !env[name]);
    if (missing.length > 0) throw new UsageError(`set ${missing.join(", ")}`);
    // `on`, not `once`: the handler stays until cleanup has finished (the finally below), so a second signal only repeats the request to stop.
    if (handleSignals) for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, onSignal);

    const api = new OpenObserveApi({ url: env.OPENOBSERVE_URL, org: env.OPENOBSERVE_ORG, token: env.OPENOBSERVE_AUTH_TOKEN, fetchImpl: deps.fetch, sleep });
    const engineDir = deps.engineDir ?? ENGINE_DIR;
    const stateDir = deps.stateDir ?? defaultStateDir(env);
    const scratchRoot = deps.scratchRoot ?? tmpdir();
    // A run takes the lock before it reads anything it will act on, so what it reads cannot go stale under it. Every review's tree is
    // made under the scratch root, so the work directory must not be that root or above it.
    if (!args.plan) {
      const workDirIssue = workDirProblem(stateDir, join(scratchRoot, "ai-review-exp-slot", "pr"));
      if (workDirIssue) throw new UsageError(`${workDirIssue}; set REVIEW_EXPERIMENT_STATE_DIR to a directory of its own`);
      releaseLock = await acquireRunLock(stateDir, { port: deps.lockPort, now });
    }
    const dataset = await resolveDataset(api, args.dataset);
    const settings = effectiveSettings({ arm: args.arm, env });
    const engine = (deps.engineIdentity ?? engineIdentity)(engineDir);
    const { identity, fingerprint } = taskIdentity({ engine, settings });
    const problems = await scoreConfigProblems(api);

    let experiment = null;
    let pricing;
    let results = null;
    let retried = false;
    let snapshotVersion;
    let selectedRows = [];
    if (args.resume) {
      // The stored experiment is the plan: its pinned snapshot, filter and slots, whatever the dataset's rows look like now.
      results = await pageResults(api, args.resume);
      experiment = results.experiment;
      const task = experiment.task ?? {};
      if (task.type !== "sdk") throw new Error(`experiment ${args.resume} is not an SDK experiment`);
      if (task.taskFingerprint !== fingerprint) throw new Error(`experiment ${args.resume} was created by other code or settings (fingerprint ${task.taskFingerprint}, now ${fingerprint}); start a new experiment`);
      if (experiment.datasetId !== dataset.id) throw new Error(`experiment ${args.resume} reads another dataset`);
      if (experiment.trialCount !== args.trials) throw new Error(`experiment ${args.resume} has ${experiment.trialCount} trial(s); pass --trials ${experiment.trialCount}`);
      const storedTag = experiment.datasetFilter?.tags?.[0] ?? null;
      if ((args.tag ?? null) !== storedTag) throw new Error(`experiment ${args.resume} was created ${storedTag ? `with tag ${storedTag}` : "without a tag"}; pass ${storedTag ? `--tag ${storedTag}` : "no --tag"}`);
      const storedRows = experiment.datasetFilter?.logicalIds ?? [];
      if ([...(args.rows ?? [])].sort().join(",") !== [...storedRows].sort().join(",")) throw new Error(`experiment ${args.resume} was created ${storedRows.length > 0 ? `with rows ${storedRows.join(",")}` : "without --rows"}; pass ${storedRows.length > 0 ? `--rows ${storedRows.join(",")}` : "no --rows"}`);
      pricing = task.config?.pricing;
      if (!pricing?.usd_per_million) throw new Error(`experiment ${args.resume} carries no frozen pricing`);
      snapshotVersion = experiment.datasetVersion;
    } else {
      const read = await readDatasetRows(api, dataset.id);
      snapshotVersion = read.snapshotVersion;
      selectedRows = args.rows ? rowsWithIds(read.rows, args.rows) : rowsWithTag(read.rows, args.tag);
      const missing = (args.rows ?? []).filter(id => !selectedRows.some(row => row.logicalId === id));
      if (missing.length > 0) throw new Error(`dataset ${dataset.name} has no row ${missing.join(", ")} at version ${snapshotVersion}`);
      if (selectedRows.length === 0) throw new Error(`dataset ${dataset.name} has no rows${args.tag ? ` tagged ${args.tag}` : ""} at version ${snapshotVersion}`);
      say(`dataset ${dataset.name} (${dataset.id}) at snapshot version ${snapshotVersion}${args.tag ? `, tag ${args.tag}` : ""}: ${selectedRows.length} of ${read.rows.length} rows`);
      if (args.rows) say(`rows: ${selectedRows.map(row => row.logicalId).join(", ")}`);
      pricing = await fetchOpenRouterPricing({ slug: settings.model, baseUrl: env.REVIEW_EXPERIMENT_OPENROUTER_URL, fetchImpl: deps.fetch });
    }

    if (args.resume) say(`dataset ${dataset.name} (${dataset.id}): experiment ${args.resume} pins snapshot version ${snapshotVersion}${args.tag ? `, tag ${args.tag}` : ""}; the dataset's current rows are not read`);
    say(`arm ${args.arm}: ${ARM_NOTES[args.arm]} ${JSON.stringify(settings.flags)}`);
    say(`model ${settings.provider}/${settings.model} at ${settings.variant} effort, ${settings.coldPasses} cold pass(es); engine ${engine.commit.slice(0, 12)}`);
    say(`fingerprint ${fingerprint}`);
    say(`pricing (${args.resume ? "frozen in the experiment" : "from OpenRouter now, frozen on creation"}) USD per million tokens: ${JSON.stringify(pricing.usd_per_million)}`);
    say(`trials ${args.trials}, so ${args.resume ? results.slots.length : selectedRows.length * args.trials} slots; cooldown ${args.gapMs / 60_000} min between runs (scope ${args.gapScope})`);
    for (const problem of problems) say(`PREFLIGHT: ${problem}`);

    if (args.plan) {
      if (results) say(`resuming ${args.resume} (${experiment.executionStatus}): ${results.slots.filter(slot => TERMINAL_TASK_STATUS.has(slot.taskStatus)).length} of ${results.slots.length} slots already reported`);
      say("plan only: nothing was created and no review was started");
      return problems.length > 0 ? 1 : 0;
    }
    if (problems.length > 0) throw new Error("preflight failed; the score configs above must exist as numeric configs before a run");
    if (!env[EXPERIMENT_KEY_ENV]) throw new UsageError(`set ${EXPERIMENT_KEY_ENV}`);

    if (!experiment) {
      experiment = await createExperiment(api, {
        name: `AI review ${args.arm} - ${dataset.name}${args.tag ? ` [${args.tag}]` : ""}${args.rows ? ` [rows: ${args.rows.length}]` : ""} - ${new Date(now()).toISOString().slice(0, 16)}Z`,
        description: ARM_NOTES[args.arm],
        datasetId: dataset.id,
        datasetVersion: snapshotVersion,
        ...(args.tag ? { datasetFilter: { tags: [args.tag] } } : {}),
        ...(args.rows ? { datasetFilter: { logicalIds: args.rows } } : {}),
        task: { type: "sdk", taskFingerprint: fingerprint, config: { ...identity, pricing, dataset: { id: dataset.id, name: dataset.name }, tag: args.tag ?? null, rows: args.rows ?? null } },
        scorers: [],
        trialCount: args.trials,
        metadata: { source: "scripts/ai-review/run-experiment.mjs", arm: args.arm },
        idempotencyKey: `ai-review-${randomUUID()}`,
      });
      say(`created experiment ${experiment.id}: ${experimentUrl(env, experiment.id)}`);
    } else if (experiment.executionStatus === "completed") {
      say(`experiment ${experiment.id} is already completed`);
      return 0;
    } else if (experiment.executionStatus === "cancelled") {
      throw new Error(`experiment ${experiment.id} was cancelled`);
    } else if (experiment.executionStatus === "failed") {
      // A new execution window is what lets the slots that failed in the last one be reported again.
      experiment = await api.post(`/experiments/${encodeURIComponent(experiment.id)}/retry`);
      retried = true;
      say(`experiment ${experiment.id} had failed; retried it (now ${experiment.executionStatus})`);
      results = await pageResults(api, experiment.id);
    }

    const { slots, total } = await pageSlots(api, experiment.id);
    if (!args.resume && total !== selectedRows.length * args.trials) throw new Error(`the experiment pinned ${total} slots but the dataset plan has ${selectedRows.length * args.trials}`);
    const reported = new Set();
    // Only a retry opens a window in which a slot that ended in error may be reported again; until then the error stands.
    const redoErrors = retried;
    for (const slot of results?.slots ?? []) {
      if (TERMINAL_TASK_STATUS.has(slot.taskStatus) || (slot.taskStatus === "error" && !redoErrors)) reported.add(slotKey(slot));
    }
    const pending = pendingOutbox(stateDir, experiment.id, slots);
    const replayKeys = new Set(pending.map(slotKey));
    const todo = runOrder(slots.filter(slot => !reported.has(slotKey(slot)) && !replayKeys.has(slotKey(slot))));
    say(`${slots.length} slots: ${reported.size} already reported, ${pending.length} to replay from the outbox, ${todo.length} to run`);

    const stats = { ok: 0, error: 0, skipped: 0, cost: 0, costKnown: true, rejected: [] };
    const submit = async entry => {
      const response = await api.post(`/experiments/${encodeURIComponent(experiment.id)}/records`, entry.payload);
      entry.rejections = rejectionsOf(entry.payload, response);
      entry.status = entry.rejections.length === 0 ? "accepted" : "rejected";
      saveOutbox(stateDir, experiment.id, entry);
      if (entry.rejections.length > 0) {
        stats.rejected.push(...entry.rejections);
        for (const r of entry.rejections) say(`REJECTED ${r.kind} for row ${r.rowId} trial ${r.trialIndex}: ${r.code}: ${r.message}`);
      }
      return entry.status === "accepted";
    };

    let stopped = false;
    for (const entry of pending) {
      if (interrupted || !(await submit(entry))) {
        stopped = true;
        break;
      }
      say(`replayed the report for row ${entry.rowId} trial ${entry.trialIndex}`);
    }

    for (const slot of stopped ? [] : todo) {
      if (interrupted) break;
      const { row, problem } = rowOfSlot(slot);
      const rowKey = `${row.repo}@${row.mergeBase}..${row.head}`.toLowerCase();
      const traceId = (deps.traceId ?? (() => randomUUID().replaceAll("-", "")))();
      let report;
      let groupStuck = false;
      const pendingEntry = report => ({ rowId: slot.rowId, trialIndex: slot.trialIndex, status: "pending", payload: mapStrings({ records: [report.record], scores: report.scores }, scrub), rejections: [] });
      if (problem) {
        report = buildSlotReport({ slot, fingerprint, summary: null, latencyMs: 0, traceId, failure: `invalid dataset row: ${problem}` });
      } else {
        const wait = cooldownWaitMs({ state: readCooldown(stateDir), rowKey, gapMs: args.gapMs, scope: args.gapScope, now: now() });
        if (wait > 0) {
          say(`waiting ${Math.ceil(wait / 1000)} s before the next review (cooldown, scope ${args.gapScope})`);
          for (let left = wait; left > 0 && !interrupted; left -= 1_000) await sleep(Math.min(1_000, left));
        }
        if (interrupted) break;
        touchCooldown(stateDir, rowKey, now());
        const heartbeat = setInterval(() => touchCooldown(stateDir, rowKey, now()), HEARTBEAT_MS);
        heartbeat.unref();
        const scratch = mkdtempSync(join(scratchRoot, "ai-review-exp-"));
        const started = now();
        let engineResult = null;
        let failure = "";
        try {
          for (const dir of ["home", "tmp", "artifacts"]) mkdirSync(join(scratch, dir));
          const apart = workDirProblem(stateDir, join(scratch, "pr"));
          if (apart) throw new Error(apart);
          (deps.checkout ?? checkoutPinned)({ repo: row.repo, mergeBase: row.mergeBase, head: row.head, dir: join(scratch, "pr"), home: join(scratch, "home"), baseUrl: env.REVIEW_EXPERIMENT_GIT_BASE_URL });
          const engineEnv = buildEngineEnv({
            env, row, experiment, settings, scratch, engineDir, prDir: join(scratch, "pr"), artifactDir: join(scratch, "artifacts"), traceId,
            prices: pricing.usd_per_million, traceAuth: traceAuthFrom(env),
          });
          say(`reviewing ${row.repo}#${row.prNumber} (row ${row.rowId}, trial ${row.trialIndex})`);
          current = (deps.runEngine ?? spawnEngine)({
            args: [join(engineDir, "scripts/ai-review/run-review.mjs")], cwd: join(engineDir, "scripts/ai-review"), env: engineEnv,
            onSpawn: pgid => recordEngineGroup(stateDir, pgid, rowKey), onGone: () => clearEngineGroup(stateDir),
          });
          engineResult = await current.promise;
          current = null;
        } catch (err) {
          failure = `could not prepare the review: ${err.message}`;
        } finally {
          clearInterval(heartbeat);
          touchCooldown(stateDir, rowKey, now());
        }
        const summary = failure ? null : readRunSummary(join(scratch, "artifacts"));
        rmSync(scratch, { recursive: true, force: true });
        groupStuck = Boolean(engineResult?.groupAlive);
        report = buildSlotReport({ slot, fingerprint, summary, engine: engineResult, latencyMs: now() - started, traceId, failure });
        if (interrupted) {
          // A review that finished before the interrupt is paid for: keep its report for the resume (not submitted, nothing finalized); a cut-off one is redone.
          if (report.record.status !== "error") saveOutbox(stateDir, experiment.id, pendingEntry(report));
          break;
        }
      }
      const entry = pendingEntry(report);
      saveOutbox(stateDir, experiment.id, entry);
      // The paid review is saved, so a resume replays it; the group's record stays and nothing more starts (no review, no finalize).
      if (groupStuck) throw new Error("the engine process group is still alive after its engine ended; the slot's report is saved and the run stops so no second review runs beside it (the group's record stays in the work directory)");
      stats[report.record.status] += 1;
      if (report.record.cost === undefined) stats.costKnown = false;
      else stats.cost += report.record.cost;
      say(`row ${slot.rowId} trial ${slot.trialIndex}: ${report.record.status}${report.record.cost !== undefined ? `, $${report.record.cost.toFixed(4)}` : ""}${report.record.errorMessage ? ` (${report.record.errorMessage.slice(0, 200)})` : ""}`);
      if (!(await submit(entry))) {
        stopped = true;
        break;
      }
    }

    if (interrupted) {
      say(`interrupted; not finalized. Resume with --resume ${experiment.id}`);
      return 130;
    }
    if (stopped) {
      say(`stopped on refused reports; not finalized. Fix the cause and resume with --resume ${experiment.id} (the refused reports are replayed first)`);
      return 1;
    }
    await api.post(`/experiments/${encodeURIComponent(experiment.id)}/finalize`);
    say(`finalized ${experiment.id}: ${stats.ok} ok, ${stats.error} error, ${stats.skipped} skipped this run; estimated cost $${stats.cost.toFixed(4)}${stats.costKnown ? "" : " (some runs unpriced)"}`);
    say(experimentUrl(env, experiment.id));
    return 0;
  } catch (err) {
    say(`${err instanceof UsageError ? "usage" : "error"}: ${err.message}`);
    if (err instanceof ApiError && err.status === 409) say("the experiment refused the request (sealed or conflicting state)");
    return err instanceof UsageError ? 2 : 1;
  } finally {
    await releaseLock();
    if (handleSignals) for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, onSignal);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; });
}
