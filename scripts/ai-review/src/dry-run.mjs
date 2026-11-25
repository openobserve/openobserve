import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { inspect } from "node:util";

import { FULL_SHA_RE, runFile, safeGitEnv } from "./pr-diff.mjs";
import { LOADER_DIRS, LOADER_FILES } from "./sanitize.mjs";
import { parseTokenPrices } from "./run-summary.mjs";
import { scrubSecrets } from "./scrub.mjs";

export const EXPERIMENT_TRACE_STREAM = "ai_code_review_experiments";
// Streams production cost and review numbers are read from; an experiment must never write into them.
export const PRODUCTION_TRACE_STREAMS = new Set(["github_ai_code_review", "github_actions_ai_traces"]);

const CREDENTIAL_FILES = new Set([".git-credentials", ".netrc", ".npmrc", ".env"]);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const KEY_VAR_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
// The only commands a dry run may hand to gh: the PR metadata read (own PR, or the paired one) the runner already makes.
const GH_READ_RE = /^pr view "\d+"(?: --repo "[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+")? --json [A-Za-z,]+(?: --jq '\.')?$/;

export function dryRunEnabled(env = process.env) {
  return env.REVIEW_DRY_RUN === "true";
}

export function dryRunGhAllowed(args) {
  return GH_READ_RE.test(String(args));
}

function isWithin(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function realOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// opencode reads instruction files from every ancestor of its working directory, so the scratch checkout must not sit under any.
function ancestorProblems(prDir) {
  const problems = [];
  for (let dir = dirname(prDir); ; dir = dirname(dir)) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      // An unreadable ancestor holds nothing opencode can read either.
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      if (LOADER_FILES.has(lower) || LOADER_DIRS.has(lower) || CREDENTIAL_FILES.has(lower)) {
        problems.push(`${resolve(dir, name)} sits above PR_DIR, where opencode could load it`);
      }
    }
    if (dirname(dir) === dir) return problems;
  }
}

function pairedProblems(env) {
  const names = ["PAIRED_REPO", "PAIRED_PR_NUMBER", "PAIRED_DIR", "PAIRED_MERGE_BASE_SHA", "PAIRED_HEAD_SHA"];
  if (!names.some(name => env[name])) return [];
  const problems = names.filter(name => !env[name]).map(name => `${name} is required when any paired value is set`);
  if (env.PAIRED_REPO && !REPO_RE.test(env.PAIRED_REPO)) problems.push("PAIRED_REPO must be owner/name");
  if (env.PAIRED_PR_NUMBER && !/^\d+$/.test(env.PAIRED_PR_NUMBER)) problems.push("PAIRED_PR_NUMBER must be a number");
  if (env.PAIRED_DIR && !/^[A-Za-z0-9._-]+$/.test(env.PAIRED_DIR)) problems.push("PAIRED_DIR must be one directory name");
  for (const name of ["PAIRED_MERGE_BASE_SHA", "PAIRED_HEAD_SHA"]) {
    if (env[name] && !FULL_SHA_RE.test(env[name])) problems.push(`${name} must be a full 40-character commit SHA`);
  }
  return problems;
}

// The diff comes from the two pinned commits, but the impact map and opencode's read tools see the working files, so those must be exactly the
// head's: the checkout's own root, at the pinned commit, with nothing changed or added. `exclude` is a nested checkout checked on its own.
export function checkoutProblems({ dir, head, label, exclude = "", run = runFile }) {
  try {
    const git = args => run("git", ["-C", dir, ...args], { env: safeGitEnv() });
    const problems = [];
    const top = realOrNull(git(["rev-parse", "--show-toplevel"]).trim());
    if (top !== realOrNull(dir)) problems.push(`${label} is not the root of its own git checkout (its git root is ${top})`);
    const at = git(["rev-parse", "HEAD"]).trim();
    if (at !== head) problems.push(`${label} is at ${at.slice(0, 12)}, not the pinned head ${head.slice(0, 12)}`);
    // --ignored: a file the checkout's own .gitignore hides is still a file the reviewer can read.
    const extra = git(["status", "--porcelain", "--untracked-files=all", "--ignored"]).split("\n").map(line => line.slice(3)).filter(path => path && !(exclude && path.startsWith(exclude)));
    // Sparse checkout, skip-worktree and assume-unchanged all report a clean status while the reviewer misses files the pinned commit has.
    const sparse = (() => { try { return git(["config", "--bool", "--get", "core.sparseCheckout"]).trim() === "true"; } catch { return false; } })();
    const hidden = git(["ls-files", "-v"]).split("\n").filter(line => line && line[0] !== "H");
    if (sparse || hidden.length > 0) problems.push(`${label} is not a whole checkout (${sparse ? "core.sparseCheckout is on" : `${hidden.length} entries are skip-worktree or assume-unchanged, such as ${hidden[0].slice(2)}`})`);
    if (extra.length > 0) problems.push(`${label} has ${extra.length} changed or extra file(s), such as ${extra[0]}`);
    return problems;
  } catch (err) {
    return [`${label} is not a git checkout of its pinned head (${String(err.stderr || err.message).trim().split("\n")[0]})`];
  }
}

// Everything a dry run needs before it may touch a model or GitHub; the caller stops on any entry.
export function dryRunProblems({ env, engineDir, prDir, readOnly }) {
  const problems = [];
  const realPr = prDir ? realOrNull(prDir) : null;
  if (!prDir) {
    problems.push("PR_DIR is required: a dry run reviews a scratch checkout of the two pinned commits");
  } else if (!realPr || !statSync(realPr).isDirectory()) {
    problems.push(`PR_DIR ${prDir} is not an existing directory`);
  } else {
    const engine = realOrNull(engineDir) ?? resolve(engineDir);
    if (isWithin(realPr, engine) || isWithin(engine, realPr)) problems.push("PR_DIR must be a scratch directory apart from the engine checkout");
    problems.push(...ancestorProblems(realPr));
    if (FULL_SHA_RE.test(env.HEAD_SHA ?? "")) {
      problems.push(...checkoutProblems({ dir: realPr, head: env.HEAD_SHA, label: "PR_DIR", exclude: env.PAIRED_DIR ? `${env.PAIRED_DIR}/` : "" }));
    }
    if (/^[A-Za-z0-9._-]+$/.test(env.PAIRED_DIR ?? "") && FULL_SHA_RE.test(env.PAIRED_HEAD_SHA ?? "")) {
      problems.push(...checkoutProblems({ dir: join(realPr, env.PAIRED_DIR), head: env.PAIRED_HEAD_SHA, label: "the paired checkout" }));
    }
  }
  for (const name of ["MERGE_BASE_SHA", "HEAD_SHA"]) {
    if (!FULL_SHA_RE.test(env[name] ?? "")) problems.push(`${name} must be a full 40-character commit SHA`);
  }
  if (!/^\d+$/.test(env.PR_NUMBER ?? "")) problems.push("PR_NUMBER must be a number");
  if (!REPO_RE.test(env.GITHUB_REPOSITORY ?? "")) problems.push("GITHUB_REPOSITORY must be owner/name");
  problems.push(...pairedProblems(env));
  const artifactDir = env.REVIEW_ARTIFACT_DIR ?? "";
  if (!artifactDir) problems.push("REVIEW_ARTIFACT_DIR is required: the findings and run summary are a dry run's only output");
  else if (!isAbsolute(artifactDir)) problems.push("REVIEW_ARTIFACT_DIR must be an absolute path");
  else if (realPr && isWithin(resolve(artifactDir), realPr)) problems.push("REVIEW_ARTIFACT_DIR must be outside PR_DIR");
  if (!readOnly) problems.push("a dry run needs the read-only opencode config (REVIEW_OPENCODE_CONFIG=default)");
  if (env.REVIEW_API_KEY_ENV && !KEY_VAR_RE.test(env.REVIEW_API_KEY_ENV)) problems.push("REVIEW_API_KEY_ENV must name an environment variable (A-Z, 0-9, _)");
  if (PRODUCTION_TRACE_STREAMS.has(env.O2_TRACE_STREAM ?? "")) problems.push(`O2_TRACE_STREAM ${env.O2_TRACE_STREAM} is a production stream; experiments use ${EXPERIMENT_TRACE_STREAM}`);
  const prices = parseTokenPrices(env.REVIEW_TOKEN_PRICES);
  if (prices.problem) problems.push(prices.problem);
  return problems;
}

// gh in a dry run reads PR metadata with the token it was given and sees nothing else: not the model key, not the trace credential.
export function dryRunGhEnv(env = process.env) {
  return Object.fromEntries(["PATH", "HOME", "GH_TOKEN", "GH_HOST", "GH_CONFIG_DIR"].filter(name => env[name]).map(name => [name, env[name]]));
}

export function scrubber(env = process.env) {
  return text => scrubSecrets(String(text), env).text;
}

// Everything a dry run prints passes the scrubber, errors included (their stack can quote a header or a key).
export function installScrubbedConsole(scrub, target = console) {
  const clean = arg => {
    if (typeof arg === "string") return scrub(arg);
    if (arg instanceof Error) return scrub(arg.stack || arg.message);
    if (arg && typeof arg === "object") return scrub(inspect(arg, { depth: 4 }));
    return arg;
  };
  for (const method of ["log", "warn", "error"]) {
    const original = target[method].bind(target);
    target[method] = (...args) => original(...args.map(clean));
  }
}
