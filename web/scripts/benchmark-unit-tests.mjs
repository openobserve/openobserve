import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const metrics = ["lines", "functions", "branches", "statements"];
const stripAnsi = (value) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export async function measure(mode, directory, output, shard) {
  await mkdir(output, { recursive: true });
  const lock = await readFile(path.join(directory, "package-lock.json"));
  const result = {
    mode,
    shard,
    sha: spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).stdout.trim(),
    node: process.version,
    npm: spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim(),
    workers: Number(process.env.VITEST_MAX_WORKERS ?? 8),
    cpus: os.cpus().map(({ model }) => model),
    memoryBytes: os.totalmem(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    lockfileSha256: createHash("sha256").update(lock).digest("hex"),
    startedAt: Date.now(),
    errors: [],
  };
  const command =
    mode === "shard"
      ? [
          "npm",
          "run",
          "test:unit:coverage",
          "--",
          "--config",
          "vitest.shard.config.ts",
          `--shard=${shard}`,
        ]
      : ["bash", "./coverage.sh", mode === "merge" ? "merge" : "check"];
  const log = createWriteStream(path.join(output, "run.log"));
  let text = "";
  const started = performance.now();
  const child = spawn("/usr/bin/time", [os.platform() === "darwin" ? "-l" : "-v", ...command], {
    cwd: directory,
    env: { ...process.env, VITEST_MAX_WORKERS: String(result.workers), DEBUG: "vitest:coverage" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const timeoutMinutes = mode === "merge" ? 10 : 45;
  const deadline = setTimeout(
    () => {
      result.errors.push(`Coverage run exceeded ${timeoutMinutes} minutes`);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    },
    timeoutMinutes * 60 * 1000,
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      log.write(chunk);
      process.stdout.write(chunk);
      text += chunk.toString();
    });
  }
  result.exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(deadline));
  await new Promise((resolve) => log.end(resolve));
  result.endedAt = Date.now();
  result.wallSeconds = (performance.now() - started) / 1000;
  const clean = stripAnsi(text);
  for (const [key, heading] of [
    ["files", "Test Files"],
    ["tests", "Tests"],
  ]) {
    const line = clean.split("\n").findLast((entry) => entry.trimStart().startsWith(`${heading} `));
    const total = line?.match(/\((\d+)\)/);
    if (!total) result.errors.push(`Missing ${heading} total`);
    result[key] = {
      total: total ? Number(total[1]) : null,
      skipped: Number(line?.match(/(\d+) skipped/)?.[1] ?? 0),
      failed: Number(line?.match(/(\d+) failed/)?.[1] ?? 0),
    };
  }
  if (mode !== "shard") {
    try {
      const summaryPath = path.join(directory, "coverage/coverage-summary.json");
      const summary = await readJson(summaryPath);
      await copyFile(summaryPath, path.join(output, "coverage-summary.json"));
      result.coverage = summary.total;
      result.coverageFiles = Object.keys(summary)
        .filter((file) => file !== "total")
        .map((file) => path.relative(directory, file))
        .sort();
      if (!result.coverageFiles.length) result.errors.push("Coverage file scope is empty");
      for (const metric of metrics) {
        if (!(summary.total?.[metric]?.total > 0) || !Number.isFinite(summary.total[metric].pct)) {
          result.errors.push(`Empty or invalid ${metric} coverage`);
        }
      }
    } catch (error) {
      result.errors.push(`Coverage summary unavailable: ${error.message}`);
    }
  }
  if (result.exitCode !== 0) result.errors.push(`Coverage check exited ${result.exitCode}`);
  if (result.files.failed || result.tests.failed) result.errors.push("Tests failed");
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  return result;
}

export function compareResults(before, after, shards) {
  const errors = [...before.errors, ...after.errors, ...shards.flatMap((shard) => shard.errors)];
  const shardIds = shards.map((shard) => shard.shard).sort();
  if (JSON.stringify(shardIds) !== JSON.stringify(["1/4", "2/4", "3/4", "4/4"])) {
    errors.push("Expected exactly four distinct successful shards");
  }
  for (const run of [after, ...shards]) {
    for (const key of ["node", "npm", "workers", "lockfileSha256"]) {
      if (run[key] !== before[key]) errors.push(`${key} differs between runs`);
    }
  }
  if (shards.some((shard) => shard.sha !== after.sha)) errors.push("Candidate SHAs differ");
  for (const key of ["files", "tests"]) {
    if (before[key].total !== after[key].total || before[key].skipped !== after[key].skipped) {
      errors.push(`${key} count changed`);
    }
    if (
      shards.reduce((sum, shard) => sum + shard[key].total, 0) !== after[key].total ||
      shards.reduce((sum, shard) => sum + shard[key].skipped, 0) !== after[key].skipped
    ) {
      errors.push(`Merged ${key} count does not match shards`);
    }
  }
  if (JSON.stringify(before.coverageFiles) !== JSON.stringify(after.coverageFiles)) {
    errors.push("Coverage file scope changed");
  }
  for (const metric of metrics) {
    if (before.coverage?.[metric]?.total !== after.coverage?.[metric]?.total) {
      errors.push(`${metric} coverage denominator changed`);
    }
  }
  const comparison = { before, after, shards, errors };
  if (
    ![before, after, ...shards].every(
      (run) => Number.isFinite(run.wallSeconds) && run.wallSeconds > 0,
    ) ||
    !shards.every((shard) => Number.isFinite(shard.startedAt) && shard.startedAt < after.endedAt)
  ) {
    errors.push("Missing or invalid timing data");
  }
  if (!errors.length) {
    comparison.candidateCriticalPathSeconds =
      (after.endedAt - Math.min(...shards.map((shard) => shard.startedAt))) / 1000;
    comparison.candidateTimedRunnerSeconds = shards.reduce(
      (sum, shard) => sum + shard.wallSeconds,
      after.wallSeconds,
    );
    comparison.wallReductionPercent =
      (1 - comparison.candidateCriticalPathSeconds / before.wallSeconds) * 100;
  }
  return comparison;
}

async function main() {
  const [mode, directoryArg, outputArg, extra] = process.argv.slice(2);
  if (!directoryArg || !outputArg || !["baseline", "merge", "shard", "compare"].includes(mode)) {
    throw new Error(
      "Usage: benchmark-unit-tests.mjs <baseline|merge|shard> <web> <output> [1/4]; or compare <artifacts> <output>",
    );
  }
  const directory = path.resolve(directoryArg);
  const output = path.resolve(outputArg);
  if (mode !== "compare") {
    if (mode === "shard" && !/^[1-4]\/4$/.test(extra ?? ""))
      throw new Error("Expected shard 1/4 through 4/4");
    const result = await measure(mode, directory, output, extra);
    process.exitCode = result.errors.length ? 1 : 0;
    return;
  }
  const before = await readJson(path.join(directory, "ui-unit-baseline/result.json"));
  const after = await readJson(path.join(directory, "ui-unit-merged/result.json"));
  const shardDirs = (await readdir(directory)).filter((name) => /^ui-unit-shard-[1-4]$/.test(name));
  const shards = await Promise.all(
    shardDirs.map((name) => readJson(path.join(directory, name, "result.json"))),
  );
  const comparison = compareResults(before, after, shards);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "comparison.json"), JSON.stringify(comparison, null, 2));
  const summary = comparison.errors.length
    ? `UI benchmark is invalid: ${comparison.errors.join("; ")}. Inspect the archived logs.\n`
    : `UI coverage suite: baseline ${before.wallSeconds.toFixed(2)}s; four-runner candidate critical path ${comparison.candidateCriticalPathSeconds.toFixed(2)}s (${comparison.wallReductionPercent.toFixed(2)}% reduction). Candidate timed runner occupancy: ${comparison.candidateTimedRunnerSeconds.toFixed(2)}s, versus baseline ${before.wallSeconds.toFixed(2)}s. ${after.tests.total} tests, ${after.files.total} files. Candidate uses four 8-CPU runners plus a merge runner; critical path includes time between shard execution and merged coverage completion. Runner occupancy excludes installation and artifact transfer.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
  process.exitCode = comparison.errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
