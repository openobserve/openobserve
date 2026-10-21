import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// opencode reads these at read time from every ancestor dir, and 1.18.x loads project .opencode plugins even with OPENCODE_DISABLE_PROJECT_CONFIG set.
export const LOADER_FILES = new Set(["agents.md", "claude.md", "context.md", "opencode.json", "opencode.jsonc"]);
export const LOADER_DIRS = new Set([".opencode", ".claude", ".agents"]);
export const CONTEXT_DIR = ".o2-review-context";
export const CONTEXT_SOURCES = [
  { from: ".claude/skills/ui-architect/references", to: "skills/ui-architect/references" },
  { from: ".claude/skills/eslint-error-handling/SKILL.md", to: "skills/eslint-error-handling/SKILL.md" },
];

export function sanitizePrTree(prDir, contextSourceDir) {
  const root = resolve(prDir);
  if (contextSourceDir && resolve(contextSourceDir) === root) {
    throw new Error("refusing to sanitize: the PR tree and the trusted engine tree are the same directory");
  }
  const removed = [];
  walk(root, root, removed);
  const leftover = findForbidden(root);
  if (leftover.length > 0) throw new Error(`sanitize left loaders or symlinks behind: ${leftover.join(", ")}`);

  const contextDir = join(root, CONTEXT_DIR);
  rmSync(contextDir, { recursive: true, force: true });
  const copied = [];
  if (contextSourceDir) {
    for (const source of CONTEXT_SOURCES) {
      const from = join(contextSourceDir, source.from);
      if (!existsSync(from)) continue;
      const to = join(contextDir, source.to);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true, dereference: false, verbatimSymlinks: true });
      copied.push(source.to);
    }
    const copiedLinks = findForbidden(contextDir);
    if (copiedLinks.length > 0) throw new Error(`review context contains loaders or symlinks: ${copiedLinks.join(", ")}`);
  }
  return { removed, contextFiles: copied };
}

function walk(dir, root, removed) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (entry.isSymbolicLink()) {
      unlinkSync(path);
      removed.push({ path: rel, reason: "symlink" });
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      if (LOADER_DIRS.has(entry.name.toLowerCase())) {
        rmSync(path, { recursive: true, force: true });
        removed.push({ path: rel, reason: "loader" });
        continue;
      }
      walk(path, root, removed);
      continue;
    }
    const name = entry.name.toLowerCase();
    if (LOADER_FILES.has(name) || LOADER_DIRS.has(name)) {
      unlinkSync(path);
      removed.push({ path: rel, reason: "loader" });
    }
  }
}

function findForbidden(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const name = entry.name.toLowerCase();
      if (lstatSync(path).isSymbolicLink() || LOADER_FILES.has(name) || LOADER_DIRS.has(name)) found.push(path);
      else if (entry.isDirectory() && entry.name !== ".git") stack.push(path);
    }
  }
  return found;
}
