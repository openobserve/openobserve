#!/usr/bin/env node
// Finds the private repo config next to the openobserve checkout. Usage: private-config.mjs [--oss <dir>] json|env|--self-test
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = join(".claude", "bounty-board.private.json");
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SEGMENT_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const PREFIX_RE = /^[A-Za-z0-9_.-]{1,64}\/$/;

export class ConfigError extends Error {}

// Inherited GIT_DIR / GIT_WORK_TREE would point every git call at some other repo, so they are always dropped.
export function gitEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: gitEnv() }).trim();
}

const strings = (a, re) => Array.isArray(a) && a.every((s) => typeof s === "string" && (!re || re.test(s)));

export function validateConfig(c, where) {
  const bad = (msg) => {
    throw new ConfigError(`${where}: ${msg}`);
  };
  if (!c || typeof c !== "object" || c.v !== 1) bad("v must be 1");
  if (typeof c.repo !== "string" || !NAME_RE.test(c.repo) || c.repo === "openobserve") bad("repo must be a repo name other than openobserve");
  if (typeof c.dir_name !== "string" || !NAME_RE.test(c.dir_name)) bad("dir_name must be a directory name");
  if (!strings(c.bug_labels) || !strings(c.file_here_when)) bad("bug_labels and file_here_when must be string arrays");
  if (typeof c.issue_template !== "string" || typeof c.edition !== "string") bad("issue_template and edition must be strings");
  if (!strings(c.route_prefixes, PREFIX_RE) || !c.route_prefixes.length) bad("route_prefixes must be top-level dirs ending in /");
  if (!strings(c.protected_segments, SEGMENT_RE)) bad("protected_segments must be plain path segments");
  if (typeof c.needs_oss_sibling !== "boolean") bad("needs_oss_sibling must be a boolean");
  return c;
}

function readConfig(dir) {
  const file = join(dir, CONFIG_PATH);
  let c;
  try {
    c = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`${file}: ${e.message}`);
  }
  return { dir: realpathSync(dir), config: validateConfig(c, file) };
}

function mainCheckoutOf(dir) {
  try {
    return dirname(git(["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]));
  } catch {
    return null;
  }
}

export function ossCheckout(env = process.env) {
  return env.BB_OSS_DIR || mainCheckoutOf(dirname(fileURLToPath(import.meta.url)));
}

// BB_PRIVATE_DIR wins; else exactly one sibling of the openobserve checkout may carry the config.
export function findPrivate({ ossDir, env = process.env } = {}) {
  if (env.BB_PRIVATE_DIR) return readConfig(env.BB_PRIVATE_DIR);
  const oss = ossDir ?? ossCheckout(env);
  if (!oss || !existsSync(oss)) return null;
  const parent = dirname(realpathSync(oss));
  const self = realpathSync(oss);
  const hits = readdirSync(parent)
    .map((n) => join(parent, n))
    .filter((d) => {
      try {
        return statSync(d).isDirectory() && realpathSync(d) !== self && existsSync(join(d, CONFIG_PATH));
      } catch {
        return false;
      }
    });
  // Worktrees of the private repo carry the config too, so hits are grouped by their main checkout.
  const groups = new Map();
  for (const h of hits) {
    const main = mainCheckoutOf(h) ?? h;
    if (!groups.has(main)) groups.set(main, []);
    groups.get(main).push(h);
  }
  if (groups.size > 1) {
    throw new ConfigError(`more than one private repo config next to ${self} (${[...groups.keys()].map((h) => basename(h)).join(", ")}); set BB_PRIVATE_DIR`);
  }
  if (!groups.size) return null;
  const [[main, members]] = [...groups];
  return readConfig(existsSync(join(main, CONFIG_PATH)) ? main : members[0]);
}

// Production lookup: also requires the checkout's origin to be openobserve/<repo> and warns when the directory name differs.
export function checkedPrivate(opts = {}) {
  const hit = findPrivate(opts);
  if (!hit) return null;
  const main = mainCheckoutOf(hit.dir) ?? hit.dir;
  let url = "";
  try {
    url = git(["-C", main, "config", "--get", "remote.origin.url"]).replace(/\.git$/, "");
  } catch {
    url = "";
  }
  const m = url.match(/[/:]openobserve\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (!m || m[1] !== hit.config.repo) throw new ConfigError(`${main} carries the private repo config but its origin is not openobserve/${hit.config.repo}`);
  if (basename(main) !== hit.config.dir_name) console.error(`private-config: warning: ${main} is not named ${hit.config.dir_name}`);
  return hit;
}

export function loadPrivate() {
  return checkedPrivate()?.config ?? null;
}

function selfTest() {
  let failed = 0;
  const assert = (cond, msg) => {
    console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
    if (!cond) failed = 1;
  };
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch (e) {
      return e instanceof ConfigError;
    }
  };
  const root = mkdtempSync(join(tmpdir(), "bb-private-"));
  const good = {
    v: 1, repo: "acme-private", dir_name: "acme-private", bug_labels: ["bug"], issue_template: "t.yaml", edition: "Acme",
    file_here_when: ["acme things"], route_prefixes: ["acme_ext/"], protected_segments: ["acme_secret"], needs_oss_sibling: true,
  };
  const put = (name, cfg) => {
    mkdirSync(join(root, name, ".claude"), { recursive: true });
    writeFileSync(join(root, name, CONFIG_PATH), typeof cfg === "string" ? cfg : JSON.stringify(cfg));
  };
  try {
    mkdirSync(join(root, "openobserve"));
    const env = {};
    assert(findPrivate({ ossDir: join(root, "openobserve"), env }) === null, "no config → null");
    put("acme-private", good);
    const hit = findPrivate({ ossDir: join(root, "openobserve"), env });
    assert(hit?.config.repo === "acme-private" && hit.dir === realpathSync(join(root, "acme-private")), "one sibling config found");
    const git = (...a) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { stdio: "ignore", env: gitEnv() });
    git("-C", join(root, "acme-private"), "init", "-q");
    git("-C", join(root, "acme-private"), "add", "-A");
    git("-C", join(root, "acme-private"), "commit", "-qm", "init");
    git("-C", join(root, "acme-private"), "worktree", "add", "-q", join(root, "wt-acme"));
    const wt = findPrivate({ ossDir: join(root, "openobserve"), env });
    assert(wt?.dir === realpathSync(join(root, "acme-private")), "a worktree of the private repo is not a second config");
    assert(throws(() => checkedPrivate({ ossDir: join(root, "openobserve"), env })), "checkout without a matching origin rejected");
    git("-C", join(root, "acme-private"), "remote", "add", "origin", "https://github.com/openobserve/acme-private.git");
    assert(checkedPrivate({ ossDir: join(root, "openobserve"), env })?.config.repo === "acme-private", "matching origin accepted");
    put("other", { ...good, repo: "other" });
    assert(throws(() => findPrivate({ ossDir: join(root, "openobserve"), env })), "two configs → error");
    assert(findPrivate({ ossDir: join(root, "openobserve"), env: { BB_PRIVATE_DIR: join(root, "other") } }).config.repo === "other", "BB_PRIVATE_DIR wins");
    put("bad", { ...good, repo: "openobserve" });
    assert(throws(() => findPrivate({ env: { BB_PRIVATE_DIR: join(root, "bad") } })), "repo openobserve rejected");
    put("bad", { ...good, route_prefixes: ["../x/"] });
    assert(throws(() => findPrivate({ env: { BB_PRIVATE_DIR: join(root, "bad") } })), "path-escaping prefix rejected");
    put("bad", { ...good, protected_segments: ["a|b"] });
    assert(throws(() => findPrivate({ env: { BB_PRIVATE_DIR: join(root, "bad") } })), "regex-like segment rejected");
    put("bad", "{not json");
    assert(throws(() => findPrivate({ env: { BB_PRIVATE_DIR: join(root, "bad") } })), "broken JSON rejected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(failed ? "private-config self-test FAILED" : "private-config self-test passed");
  process.exit(failed);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  let ossDir;
  if (args[0] === "--oss") {
    ossDir = args[1];
    args.splice(0, 2);
  }
  if (args[0] === "--self-test") selfTest();
  try {
    const hit = checkedPrivate({ ossDir });
    if (args[0] === "json") process.stdout.write(`${JSON.stringify(hit ? { dir: hit.dir, ...hit.config } : null)}\n`);
    else if (args[0] === "env") {
      if (hit) {
        const c = hit.config;
        process.stdout.write(`private_dir=${hit.dir}\nprivate_repo=${c.repo}\nprivate_dir_name=${c.dir_name}\nneeds_oss_sibling=${c.needs_oss_sibling}\n`);
      }
    } else {
      console.error("usage: private-config.mjs [--oss <dir>] json|env|--self-test");
      process.exit(2);
    }
  } catch (e) {
    console.error(`private-config: ${e.message}`);
    process.exit(e instanceof ConfigError ? 4 : 3);
  }
}
