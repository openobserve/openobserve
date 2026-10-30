import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { integer } from "./partition.mjs";
import { settings } from "./runtime.mjs";

export async function coordinate(options, dependencies = {}) {
  const {
    repository,
    runId,
    attempt,
    count,
    token,
    apiUrl = "https://api.github.com",
    timeoutMs = 540000,
    pollMs = 5000,
    artifactGraceMs = 15000,
  } = options;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  for (const [name, value] of Object.entries({ runId, attempt, count })) integer(value, name);
  for (const [name, value, limit] of [
    ["timeoutMs", timeoutMs, 540000],
    ["pollMs", pollMs, 5000],
    ["artifactGraceMs", artifactGraceMs, 15000],
  ]) {
    if (integer(value, name) > limit) throw new Error(`${name} exceeds ${limit}`);
  }
  if (!token) throw new Error("Missing GitHub token");
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || (() => performance.now());
  const sleep = dependencies.sleep || setTimeout;
  const log = dependencies.log || console.log;
  const start = now();
  const deadline = start + timeoutMs;
  const path = `/repos/${repository}/actions/runs/${runId}`;
  const names = Array.from({ length: count }, (_, index) => `UI unit shard ${index + 1}`);
  const previousJobs = new Map();
  let readySince;
  let pending = "shard jobs";
  let requests = 0;

  async function get(endpoint) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${pending}`);
    requests++;
    const response = await request(`${apiUrl}${endpoint}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(15000, remaining)))),
    });
    if (!response.ok)
      throw new Error(`GitHub API failed: HTTP ${response.status} after ${requests} requests`);
    return response.json();
  }

  async function pages(endpoint, field) {
    const records = [];
    for (let page = 1; ; page++) {
      if (page > 100) throw new Error(`GitHub ${field} pagination exceeded 100 pages`);
      const result = await get(`${endpoint}?per_page=100&page=${page}`);
      if (!Array.isArray(result[field])) throw new Error(`Invalid GitHub ${field} response`);
      records.push(...result[field]);
      if (result[field].length < 100) return records;
    }
  }

  while (now() < deadline) {
    const run = await get(path);
    if (run.id !== runId || run.run_attempt !== attempt) {
      throw new Error("Workflow run or attempt changed while waiting");
    }
    if (run.status === "completed" || run.conclusion === "cancelled") {
      throw new Error(`Workflow ended while waiting: ${run.conclusion}`);
    }
    const latest = new Map();
    for (let current = attempt; current >= 1 && latest.size < count; current--) {
      let jobs = previousJobs.get(current);
      if (!jobs) {
        jobs = await pages(`${path}/attempts/${current}/jobs`, "jobs");
        if (
          current < attempt &&
          jobs.every((job) => !names.includes(job.name) || job.status === "completed")
        ) {
          previousJobs.set(current, jobs);
        }
      }
      const seen = new Set();
      for (const job of jobs) {
        if (!names.includes(job.name)) continue;
        if (seen.has(job.name)) throw new Error(`Duplicate shard job: ${job.name}`);
        seen.add(job.name);
        if (!latest.has(job.name)) latest.set(job.name, { ...job, attempt: current });
      }
    }
    const waiting = [];
    for (const name of names) {
      const job = latest.get(name);
      if (job && job.run_id !== runId) {
        throw new Error(`Wrong workflow run for ${name}`);
      }
      if (job?.status === "completed" && job.conclusion !== "success") {
        throw new Error(`${name} ended with ${job.conclusion}; rerun failed jobs`);
      }
      // The coordinator's terminal result is checked by the dependent required gate.
      if (name === names.at(-1)) {
        if (job?.attempt === attempt && job.status === "in_progress") continue;
        waiting.push(name);
        continue;
      }
      if (!job || job.status !== "completed") waiting.push(name);
    }
    if (waiting.length) {
      pending = waiting.join(", ");
      readySince = undefined;
    } else {
      readySince ??= now();
      const artifacts = await pages(`${path}/artifacts`, "artifacts");
      const ids = [];
      const missing = [];
      for (let index = 1; index <= count; index++) {
        const name = `ui-unit-shard-${index}-${count}`;
        const matches = artifacts.filter((artifact) => artifact.name === name);
        if (matches.length > 1) throw new Error(`Duplicate artifact: ${name}`);
        if (!matches.length) {
          missing.push(name);
          continue;
        }
        const artifact = matches[0];
        if (artifact.expired) throw new Error(`Expired artifact: ${name}; rerun all jobs`);
        ids.push(integer(artifact.id, "Artifact ID"));
      }
      if (!missing.length) {
        log(
          `All shard producers succeeded; waited ${Math.ceil((now() - start) / 1000)}s with ${requests} API requests`,
        );
        return ids;
      }
      pending = `missing artifacts: ${missing.join(", ")}`;
      if (now() - readySince >= artifactGraceMs) {
        throw new Error(`${pending}; artifacts may have expired, rerun all jobs`);
      }
    }
    log(`Waiting for ${pending} (${Math.ceil((now() - start) / 1000)}s elapsed)`);
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error(
    `Timed out waiting for ${pending}; rerun failed jobs or all jobs if artifacts expired`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const ids = await coordinate({
    repository: process.env.GITHUB_REPOSITORY,
    runId: integer(process.env.GITHUB_RUN_ID, "Run ID"),
    attempt: integer(process.env.GITHUB_RUN_ATTEMPT, "Run attempt"),
    count: settings(root).shards,
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
    timeoutMs: integer(process.env.UI_TEST_WAIT_TIMEOUT_MS || 540000, "Wait timeout"),
    pollMs: integer(process.env.UI_TEST_POLL_INTERVAL_MS || 5000, "Poll interval"),
    artifactGraceMs: integer(process.env.UI_TEST_ARTIFACT_GRACE_MS || 15000, "Artifact grace"),
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GitHub output path");
  appendFileSync(process.env.GITHUB_OUTPUT, `artifact_ids=${ids.join(",")}\n`);
}
