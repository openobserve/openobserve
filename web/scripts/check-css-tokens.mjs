#!/usr/bin/env node
// CI guard: fail if any `var(--x)` reference has no matching `--x:` definition
// anywhere in src (.css / .vue / .ts), and no CSS fallback (`var(--x, fallback)`).
// This catches the root-cause class of bug fixed in O2_TOKEN_MIGRATION_PLAN.md §3
// (undefined-token references that silently void the whole declaration).
//
// Run: node scripts/check-css-tokens.mjs   (from web/)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");
const EXTS = new Set([".css", ".vue", ".ts"]);

// Runtime/library-injected custom properties that are never statically
// `--x: value;` defined in our source (Reka UI, Tailwind internals, vue-flow,
// Quasar remnants) plus a handful of JS-bound `:style` names set only via
// element.style.setProperty at runtime.
const ALLOW_PREFIXES = [/^--reka-/, /^--tw-/, /^--vf-/, /^--q-/, /^--o2-span-\d+$/];
const ALLOW_EXACT = new Set([
  "--o2-tree-node-color",
  "--node-color",
  "--chip-color",
  "--o2-row-status-color",
  "--o2-table-row-height",

  // Pre-existing undefined-token bugs found when this guard was introduced,
  // out of scope for O2_TOKEN_MIGRATION_PLAN.md (which only covers the named
  // Bucket A-D families). Tracked separately — do not add new entries here;
  // fix the reference or its definition instead.
  "--o2-color-primary",
  "--o2-color-primary-light",
  "--o2-primary",
  "--o2-primary-btn-bg-rgb",
  "--o2-status-error",
  "--o2-text-color",
  "--o2-text",
  "--o2-brand",
  "--o2-font-mono",
  "--o2-font",
  "--color-success-bg",
  "--o2-tree-x",
  "--o2-tree-parent-x",
  "--o2-tree-connector-x",
  "--o2-bg-light",
  "--o2-bg-dark",
  "--o2-text-primary-dark",
  "--o2-hover-bg",
  "--o2-status-error-border",
  "--o2-bg",
  "--o2-surface",
  "--o2-dark-page-bg",
  "--o2-red-800",
  "--o2-green-700",
  "--o2-yellow-700",
  "--o2-blue-700",
  "--o2-gray-700",
]);

function isAllowed(name) {
  if (ALLOW_EXACT.has(name)) return true;
  return ALLOW_PREFIXES.some((re) => re.test(name));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (EXTS.has(extname(entry))) files.push(full);
  }
  return files;
}

const DECL_RE = /(--[A-Za-z0-9_-]+)\s*:/g;
// var(--x) or var(--x, fallback) — only flag the no-fallback form.
const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,[^)]*)?\)/g;

const defined = new Set();
const referenced = new Map(); // name -> [{file, line}]

for (const file of walk(SRC_DIR)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(DECL_RE)) defined.add(m[1]);
    for (const m of line.matchAll(VAR_RE)) {
      const [, name, fallback] = m;
      if (fallback) continue; // has a fallback, safe either way
      if (!referenced.has(name)) referenced.set(name, []);
      referenced.get(name).push({ file: file.replace(SRC_DIR + "/", "src/"), line: i + 1 });
    }
  });
}

const undefinedRefs = [];
for (const [name, sites] of referenced) {
  if (defined.has(name) || isAllowed(name)) continue;
  undefinedRefs.push({ name, sites });
}

if (undefinedRefs.length > 0) {
  console.error(`\nFound ${undefinedRefs.length} undefined CSS custom propert${undefinedRefs.length === 1 ? "y" : "ies"} referenced with no fallback:\n`);
  for (const { name, sites } of undefinedRefs) {
    console.error(`  ${name}`);
    for (const { file, line } of sites.slice(0, 5)) {
      console.error(`    ${file}:${line}`);
    }
    if (sites.length > 5) console.error(`    ...and ${sites.length - 5} more`);
  }
  console.error("\nEach of these voids its whole declaration in browsers (invalid var() = unset).");
  console.error("Either define the token, add a var(--x, fallback), or allowlist it in check-css-tokens.mjs if runtime/library-injected.\n");
  process.exit(1);
} else {
  console.log(`OK — no undefined CSS custom property references (${defined.size} tokens defined, ${referenced.size} distinct refs checked).`);
}
