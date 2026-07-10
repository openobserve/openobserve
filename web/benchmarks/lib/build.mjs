import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, WORKTREE_DIR, SERVE_PORT, BASE_PATH } from "../config.mjs";
import { ensureDir, log } from "./util.mjs";

const IS_WIN = process.platform === "win32";
const NPM = IS_WIN ? "npm.cmd" : "npm";

function git(args, cwd = REPO_ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(cmd, args, cwd, extraEnv = {}) {
  log(`$ ${cmd} ${args.join(" ")}  (cwd=${cwd})`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: IS_WIN, // npm.cmd needs a shell on Windows
    env: { ...process.env, ...extraEnv },
  });
}

// Resolve a ref to a stable short hash so worktree dirs are deterministic.
function resolveRef(ref) {
  return git(["rev-parse", "--short", ref]);
}

// Create (or reuse) an isolated worktree checked out at `ref`, build the web
// frontend inside it pointing at our local serve port, and return the dist dir.
export function buildCommit(ref, { reuse = false } = {}) {
  ensureDir(WORKTREE_DIR);
  const short = resolveRef(ref);
  const wt = path.join(WORKTREE_DIR, short);
  const webDir = path.join(wt, "web");
  const distDir = path.join(webDir, "dist");

  if (reuse && fs.existsSync(path.join(distDir, "index.html"))) {
    log(`reusing existing build for ${ref} (${short})`);
    return { distDir, webDir, short };
  }

  // (Re)create the worktree.
  if (fs.existsSync(wt)) {
    log(`removing stale worktree ${wt}`);
    try {
      git(["worktree", "remove", "--force", wt]);
    } catch {
      fs.rmSync(wt, { recursive: true, force: true });
      try {
        git(["worktree", "prune"]);
      } catch {}
    }
  }
  log(`creating worktree for ${ref} (${short}) at ${wt}`);
  git(["worktree", "add", "--detach", wt, ref]);

  // Install deps. Prefer the reproducible `npm ci`; fall back to install if
  // the lockfile is out of sync (common on an old baseline commit).
  try {
    run(NPM, ["ci", "--no-audit", "--no-fund"], webDir);
  } catch (e) {
    log(`npm ci failed (${e.message?.split("\n")[0]}), falling back to npm install`);
    run(NPM, ["install", "--no-audit", "--no-fund"], webDir);
  }

  // Build. Use `build-only` to skip the slow vue-tsc type-check (which can
  // fail on an old commit under a newer toolchain and isn't needed for a
  // runtime benchmark). Bake our serve endpoint in so API calls are same-origin.
  const buildEnv = {
    VITE_OPENOBSERVE_ENDPOINT: `http://localhost:${SERVE_PORT}`,
    // Don't let the remote datasource-content fetch abort an offline build.
    DS_CONTENT_STRICT: "",
    DS_CONTENT_FORCE: "",
    // Keep dev-ish so .env.production isn't force-loaded.
    NODE_ENV: "",
  };

  const scripts = readScripts(webDir);
  const buildScript = scripts["build-only"] ? "build-only" : "build";
  run(NPM, ["run", buildScript, "--", `--base`, BASE_PATH], webDir, buildEnv);

  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    throw new Error(`build produced no dist/index.html for ${ref}`);
  }
  return { distDir, webDir, short };
}

function readScripts(webDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(webDir, "package.json"), "utf8")).scripts || {};
  } catch {
    return {};
  }
}

// Read the checked-out source of a file from a worktree (for static analysis
// steps like shortcut counting). Returns null if absent.
export function readSource(webDir, relPath) {
  const full = path.join(webDir, relPath);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

export function cleanupWorktree(short) {
  const wt = path.join(WORKTREE_DIR, short);
  try {
    execSync(`git worktree remove --force "${wt}"`, { cwd: REPO_ROOT });
  } catch {
    fs.rmSync(wt, { recursive: true, force: true });
  }
}
