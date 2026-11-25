import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ARM_ENV, parseArmFlags } from "./arms.mjs";
import { FULL_SHA_RE, safeGitEnv } from "./pr-diff.mjs";
import { parseColdPasses } from "./passes.mjs";
import { CONTEXT_SOURCES } from "./sanitize.mjs";
import { SUMMARY_FILE } from "./run-summary.mjs";

export const EXPERIMENT_PROVIDER = "openrouter-review";
export const DEFAULT_EXPERIMENT_MODEL = "anthropic/claude-sonnet-5.5";
export const EXPERIMENT_KEY_ENV = "OPENROUTER_REVIEW_API_KEY";
// What the production workflow runs at when AI_REVIEW_EFFORT is unset; the coordinator follows the reviewers.
const BASELINE_VARIANT = "high";
const ENGINE_TIMEOUT_MS = 45 * 60 * 1000;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;
// The engine files the fingerprint stands for: the commit names them only while they are exactly as committed. That includes the trusted
// skill references sanitize copies into the review's tree, which the model reads.
const ENGINE_PATHS = ["scripts/ai-review", "opencode.jsonc", "opencode.ci.jsonc", "AGENTS.md", ...CONTEXT_SOURCES.map(source => source.from)];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = text => createHash("sha256").update(text).digest("hex");

// Every git call of the harness gets the same secret-free environment unless it brings its own (the checkout does).
export function runGit(args, { cwd, env = safeGitEnv() } = {}) {
  return execFileSync("git", args, { cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
}

// The trusted engine's commit. An engine with uncommitted or untracked files has no commit that names it, so it is refused.
export function engineIdentity(engineDir, git = runGit) {
  const changed = git(["status", "--porcelain", "--untracked-files=all", "--", ...ENGINE_PATHS], { cwd: engineDir }).split("\n").filter(Boolean).map(line => line.slice(3));
  if (changed.length > 0) {
    throw new Error(`the engine has uncommitted changes (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? `, and ${changed.length - 3} more` : ""}); commit them first, since the experiment's fingerprint names a commit`);
  }
  // assume-unchanged and skip-worktree entries edit a tracked file without showing in status.
  const hidden = git(["ls-files", "-v", "--", ...ENGINE_PATHS], { cwd: engineDir }).split("\n").filter(line => line && line[0] !== "H");
  if (hidden.length > 0) throw new Error(`the engine has assume-unchanged or skip-worktree files (${hidden.slice(0, 3).map(line => line.slice(2)).join(", ")}); reset them, since the commit does not name what is on disk`);
  // sanitize copies these trees whole, ignored files included; ignored files elsewhere under the engine (node_modules) are never read by the model.
  const ignored = git(["status", "--porcelain", "--ignored", "--untracked-files=all", "--", ...CONTEXT_SOURCES.map(source => source.from)], { cwd: engineDir }).split("\n").filter(line => line.startsWith("!! "));
  if (ignored.length > 0) throw new Error(`the engine has ignored files in the review's context (${ignored.slice(0, 3).map(line => line.slice(3)).join(", ")}); remove them, since the commit does not name them`);
  return { commit: git(["rev-parse", "HEAD"], { cwd: engineDir }).trim() };
}

// Model, effort and pass count as the engine will run them: the arm decides the effort, nothing in the caller's shell does.
export function effectiveSettings({ arm, env }) {
  const armEnv = ARM_ENV[arm];
  if (!armEnv) throw new Error(`unknown arm "${arm}" (expected ${Object.keys(ARM_ENV).join(", ")})`);
  if (env.REVIEW_PROVIDER_ID && env.REVIEW_PROVIDER_ID !== EXPERIMENT_PROVIDER) throw new Error(`experiments run on ${EXPERIMENT_PROVIDER}, not ${env.REVIEW_PROVIDER_ID}`);
  const flags = Object.fromEntries(Object.entries(armEnv).filter(([name]) => name.startsWith("REVIEW_ARM_")));
  return {
    arm,
    flags: parseArmFlags(flags),
    provider: EXPERIMENT_PROVIDER,
    model: env.REVIEW_MODEL_ID || DEFAULT_EXPERIMENT_MODEL,
    variant: armEnv.REVIEW_MODEL_VARIANT ?? BASELINE_VARIANT,
    coldPasses: parseColdPasses(env.REVIEW_COLD_PASSES),
  };
}

// The identity of the code under evaluation: engine commit, arm and the effective settings. Pricing is configuration, not identity.
export function taskIdentity({ engine, settings }) {
  const identity = { engine, ...settings };
  return { identity, fingerprint: `ai-review-engine:${sha256(canonicalJson(identity)).slice(0, 40)}` };
}

// The row's commits fetched into a fresh checkout as data: git runs from argument vectors with no config files, hooks, filters, submodules or credentials.
export function checkoutPinned({ repo, mergeBase, head, dir, home, baseUrl = "https://github.com", run = runGit }) {
  if (!REPO_RE.test(repo ?? "")) throw new Error(`"${repo}" is not an owner/name repository`);
  for (const [name, sha] of [["merge_base_sha", mergeBase], ["head_sha", head]]) {
    if (!FULL_SHA_RE.test(sha ?? "")) throw new Error(`${name} must be a full 40-character commit SHA`);
  }
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    LC_ALL: "C",
  };
  const flags = [
    "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null",
    "-c", "credential.helper=", "-c", "protocol.version=2", "-c", "submodule.recurse=false", "-c", "fetch.recurseSubmodules=false",
    "-c", "advice.detachedHead=false", "-c", "filter.lfs.required=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.clean=",
  ];
  run([...flags, "init", "-q", "--template=", dir], { env });
  run([...flags, "-C", dir, "remote", "add", "origin", `${baseUrl.replace(/\/+$/, "")}/${repo}.git`], { env });
  run([...flags, "-C", dir, "fetch", "-q", "--no-tags", "--no-recurse-submodules", "--depth=1", "origin", mergeBase, head], { env });
  run([...flags, "-C", dir, "checkout", "-q", "--detach", head], { env });
}

// Only what the engine needs. The OpenObserve API token never goes here (the trace credential is the one exception, and opencode never sees it);
// neither does any other variable of the caller's shell.
export function buildEngineEnv({ env, row, experiment, settings, scratch, engineDir, prDir, artifactDir, traceId, prices, traceAuth }) {
  const out = {
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: join(scratch, "home"),
    TMPDIR: join(scratch, "tmp"),
    LANG: "C.UTF-8",
    ENGINE_DIR: engineDir,
    PR_DIR: prDir,
    REVIEW_ARTIFACT_DIR: artifactDir,
    GITHUB_REPOSITORY: row.repo,
    PR_NUMBER: String(row.prNumber),
    MERGE_BASE_SHA: row.mergeBase,
    HEAD_SHA: row.head,
    REVIEW_DRY_RUN: "true",
    REVIEW_OPENCODE_CONFIG: "default",
    REVIEW_PROVIDER_ID: settings.provider,
    REVIEW_MODEL_ID: settings.model,
    REVIEW_API_KEY_ENV: EXPERIMENT_KEY_ENV,
    [EXPERIMENT_KEY_ENV]: env[EXPERIMENT_KEY_ENV],
    REVIEW_MODEL_VARIANT: settings.variant,
    REVIEW_COLD_PASSES: String(settings.coldPasses),
    REVIEW_TOKEN_PRICES: JSON.stringify(prices),
    REVIEW_EXPERIMENT_ID: experiment.id,
    REVIEW_EXPERIMENT_ARM: settings.arm,
    REVIEW_EXPERIMENT_ROW_ID: row.rowId,
    REVIEW_EXPERIMENT_TRIAL: String(row.trialIndex),
    O2_TRACE_ID: traceId,
    O2_TRACE_STREAM: env.O2_TRACE_STREAM || "ai_code_review_experiments",
    GH_NO_UPDATE_NOTIFIER: "1",
  };
  for (const [name, value] of Object.entries(ARM_ENV[settings.arm])) {
    if (name.startsWith("REVIEW_ARM_")) out[name] = value;
  }
  if (traceAuth) Object.assign(out, { O2_TRACE_INGEST_URL: env.OPENOBSERVE_URL, O2_TRACE_ORG: env.OPENOBSERVE_ORG, O2_TRACE_AUTH: traceAuth });
  if (env.OPENCODE_BIN) out.OPENCODE_BIN = env.OPENCODE_BIN;
  // Optional, and only for the PR metadata read; the engine in a dry run can call nothing else on GitHub.
  if (env.REVIEW_EXPERIMENT_GH_TOKEN) out.GH_TOKEN = env.REVIEW_EXPERIMENT_GH_TOKEN;
  return out;
}

// OPENOBSERVE_AUTH_TOKEN is the whole Authorization value; the engine's exporter can only send a Basic credential.
export function traceAuthFrom(env) {
  const token = (env.O2_TRACE_AUTH || env.OPENOBSERVE_AUTH_TOKEN || "").trim();
  if (!token) return "";
  const [scheme] = token.split(" ");
  return /^bearer$/i.test(scheme) ? "" : token;
}

export function readRunSummary(artifactDir) {
  try {
    return JSON.parse(readFileSync(join(artifactDir, SUMMARY_FILE), "utf-8"));
  } catch {
    return null;
  }
}

const KILL_GRACE_MS = 10_000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// What a group may take to disappear after its engine exited; past it the result says the group is still there.
const GROUP_WAIT_MS = 60_000;

// Runs the engine in its own process group, which `kill` ends whole; the result arrives once the group is empty. Its stdin is a pipe only
// this process holds: the engine does nothing until the "go" byte sent after `onSpawn` published the group, and ends the group on EOF.
export function spawnEngine({ command = process.execPath, args, cwd, env, timeoutMs = ENGINE_TIMEOUT_MS, graceMs = KILL_GRACE_MS, groupWaitMs = GROUP_WAIT_MS, kill = process.kill, onSpawn, onGone }) {
  const child = spawn(command, args, { cwd, env: { ...env, REVIEW_EXIT_WITH_PARENT: "true" }, stdio: ["pipe", "pipe", "pipe"], detached: true });
  child.stdin.on("error", () => {});
  let tail = "";
  const keep = chunk => { tail = (tail + chunk.toString()).slice(-4000); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const signalGroup = signal => {
    try {
      kill(-child.pid, signal);
    } catch {
      // The group is already gone.
    }
  };
  const groupAlive = () => {
    try {
      kill(-child.pid, 0);
      return true;
    } catch (err) {
      return err.code === "EPERM";
    }
  };
  // The group id is the pid (detached). `onGone` fires only once nothing of the group is left; a group that cannot be recorded never gets "go".
  if (child.pid) {
    try {
      onSpawn?.(child.pid);
      child.stdin.write("g");
    } catch (err) {
      signalGroup("SIGKILL");
      tail = `could not record the engine group: ${err.message}`;
    }
  }
  let forceTimer = null;
  const stop = () => {
    signalGroup("SIGTERM");
    forceTimer ??= setTimeout(() => signalGroup("SIGKILL"), graceMs);
  };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  const promise = new Promise(resolve => {
    child.on("error", err => { clearTimeout(timer); resolve({ exitCode: null, signal: null, tail: err.message, timedOut: false, groupAlive: false }); });
    // "exit", not "close": a leftover child that still holds the output pipe would keep "close" from ever firing.
    child.on("exit", async (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      // The engine has ended, and so has its own cleanup: anything of its still running is a leak, killed until it is gone or the wait is spent.
      for (let waited = 0; ; waited += 50) {
        signalGroup("SIGKILL");
        if (!groupAlive() || waited >= groupWaitMs) break;
        await wait(50);
      }
      const left = groupAlive();
      if (!left) onGone?.();
      if (!child.stdout.destroyed) await Promise.race([new Promise(done => child.stdout.once("close", done)), wait(1_000)]);
      resolve({ exitCode, signal, tail, timedOut, groupAlive: left });
    });
  });
  return { promise, kill: stop };
}
