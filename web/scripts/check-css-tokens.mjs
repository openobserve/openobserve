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
const ALLOW_PREFIXES = [/^--reka-/, /^--tw-/, /^--vf-/, /^--q-/, /^--o2-span-/];
const ALLOW_EXACT = new Set([
  "--node-color",
  "--chip-color",
  "--o2-tree-node-color",

  // JS-set-at-runtime custom properties (OTable tree indents, row status, virtual height).
  "--o2-row-status-color",
  "--o2-table-row-height",
  "--o2-tree-x",
  "--o2-tree-parent-x",
  "--o2-tree-connector-x",

  // Pre-existing UNDEFINED/broken --o2-* tokens left out of scope of the token
  // migration (they reference nothing today). Tracked separately — do NOT add
  // new entries; fix the reference or migrate it to a --color-* token instead.
  "--o2-bg",
  "--o2-bg-card-dark",
  "--o2-bg-color",
  "--o2-bg-dark",
  "--o2-bg-light",
  "--o2-bg-primary",
  "--o2-blue-700",
  "--o2-brand",
  "--o2-color-primary",
  "--o2-color-primary-light",
  "--o2-dark-page-bg",
  "--o2-destructive",
  "--o2-font",
  "--o2-font-mono",
  "--o2-gray-700",
  "--o2-green-700",
  "--o2-hover-bg",
  "--o2-hover-color",
  "--o2-input-bg",
  "--o2-primary",
  "--o2-primary-btn-bg-rgb",
  "--o2-primary-dark",
  "--o2-red-800",
  "--o2-selected-color",
  "--o2-shadow-lg",
  "--o2-status-error",
  "--o2-status-error-border",
  "--o2-surface",
  "--o2-text",
  "--o2-text-color",
  "--o2-text-primary-dark",
  "--o2-url",
  "--o2-yellow-700",
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
