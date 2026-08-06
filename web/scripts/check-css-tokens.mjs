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

// Library-injected custom properties that are never statically `--x: value;`
// defined in our source (Reka UI, Tailwind internals, vue-flow).
// These resolve at runtime, so a static "undefined" report on them would be a
// false positive — hence the prefix allowlist.
//
// HARD RULE: NO `--o2-*` name may ever appear in any allowlist here. The entire
// `--o2-*` vocabulary is banned and being migrated away; even the ones set at
// runtime via Vue `:style` (OTable tree indents, row status, row height) must be
// renamed off the `--o2-` namespace. If you find a `--o2-*` here, delete it and
// fix the usage — never re-exempt it.
const ALLOW_PREFIXES = [/^--reka-/, /^--tw-/, /^--vf-/];
const ALLOW_EXACT = new Set([
  // Non-o2 custom properties set per-element at runtime via Vue `:style`
  // bindings — dynamic values with no static `--x:` definition.
  "--node-color", // plugins/pipelines/CustomNode.vue  :style={ '--node-color': ... }
  "--chip-color",
]);

// Guard against accidental re-introduction of an --o2-* exemption above.
for (const name of [...ALLOW_EXACT, ...ALLOW_PREFIXES.map((re) => re.source)]) {
  if (String(name).includes("--o2-")) {
    console.error(`check-css-tokens: '${name}' — --o2-* tokens must never be allowlisted. Remove it.`);
    process.exit(2);
  }
}

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
// Tailwind v4 CSS-variable shorthand: `bg-(--x)`, `text-(--x)`, `border-(--x)`.
// The compiler expands these to a bare `var(--x)` with NO fallback, so a phantom
// token voids the declaration exactly like `var(--x)` does — but VAR_RE never
// sees the `var(` text, so this form slipped past the guard entirely. The
// fallback form `(--x,#fff)` is safe and skipped, mirroring VAR_RE.
// Requires a utility prefix (`bg`, `text`, `border-t`, …) before the `-(`, which
// is what distinguishes the shorthand from an ordinary `var(` / `calc(` call.
const TW_SHORTHAND_RE = /[A-Za-z0-9\]]-\(\s*(--[A-Za-z0-9_-]+)\s*(,[^)]*)?\)/g;
// ANY --o2-* occurrence used AS A CSS CUSTOM PROPERTY, in any syntax (var(),
// Tailwind `[var(--o2-*)]` / `(--o2-*)` shorthand, `[--o2-*]` arbitrary,
// `:style` keys, template-literal CSS). The whole vocabulary is banned, so a
// fallback does NOT make it acceptable — unlike the undefined-ref check.
const O2_RE = /--o2-[A-Za-z0-9-]+/g;

// The `--o2-` prefix collides with the OpenObserve collector's CLI flags (e.g.
// the k8s install command's `--o2-<flag>=<value>` URL flag) and with
// prose/comments that name those flags. Those are NOT CSS custom properties, so
// they must not trip the ban. A `--o2-*` is a CSS custom property only when used
// as one: inside var(), a Tailwind shorthand/arbitrary bracket, or as a
// declaration / `:style` key (immediately followed by `:`). Everything else (a
// bare flag in a shell-command string, or a backticked mention in a comment) is
// ignored.
function isO2CssUsage(line, index, name) {
  const before = line.slice(Math.max(0, index - 6), index);
  const after = line.slice(index + name.length);
  return (
    /var\(\s*$/.test(before) || // var(--o2-*
    /[A-Za-z0-9\]]-\(\s*$/.test(before) || // bg-(--o2-*  (Tailwind shorthand)
    /\[\s*$/.test(before) || // [--o2-*  (arbitrary property/value)
    /^\s*['"]?\s*:/.test(after) // --o2-*:  or  '--o2-*':  (decl / :style key)
  );
}

const defined = new Set();
const referenced = new Map(); // name -> [{file, line}]
const bannedO2 = new Map(); // name -> [{file, line}]

for (const file of walk(SRC_DIR)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(DECL_RE)) defined.add(m[1]);
    for (const re of [VAR_RE, TW_SHORTHAND_RE]) {
      for (const m of line.matchAll(re)) {
        const [, name, fallback] = m;
        if (fallback) continue; // has a fallback, safe either way
        if (!referenced.has(name)) referenced.set(name, []);
        referenced.get(name).push({ file: file.replace(SRC_DIR + "/", "src/"), line: i + 1 });
      }
    }
    for (const m of line.matchAll(O2_RE)) {
      const name = m[0];
      if (!isO2CssUsage(line, m.index, name)) continue; // CLI flag / prose, not a CSS token
      if (!bannedO2.has(name)) bannedO2.set(name, []);
      bannedO2.get(name).push({ file: file.replace(SRC_DIR + "/", "src/"), line: i + 1 });
    }
  });
}

const undefinedRefs = [];
for (const [name, sites] of referenced) {
  if (defined.has(name) || isAllowed(name)) continue;
  undefinedRefs.push({ name, sites });
}

function printGroup(map) {
  for (const [name, sites] of map) {
    console.error(`  ${name}`);
    for (const { file, line } of sites.slice(0, 5)) console.error(`    ${file}:${line}`);
    if (sites.length > 5) console.error(`    ...and ${sites.length - 5} more`);
  }
}

let failed = false;

// 1) Banned --o2-* vocabulary — zero tolerance, fallback or not.
if (bannedO2.size > 0) {
  const total = [...bannedO2.values()].reduce((n, s) => n + s.length, 0);
  console.error(`\nFound ${total} banned --o2-* token reference${total === 1 ? "" : "s"} (${bannedO2.size} distinct name${bannedO2.size === 1 ? "" : "s"}):\n`);
  printGroup(bannedO2);
  console.error("\nThe entire --o2-* vocabulary is banned. Migrate each to its --color-* equivalent");
  console.error("(see scripts/o2-token-map.json) or a Tailwind utility. There is no allowlist.\n");
  failed = true;
}

// 2) Undefined non-o2 references with no fallback (voids the whole declaration).
if (undefinedRefs.length > 0) {
  console.error(`\nFound ${undefinedRefs.length} undefined CSS custom propert${undefinedRefs.length === 1 ? "y" : "ies"} referenced with no fallback:\n`);
  printGroup(new Map(undefinedRefs.map((r) => [r.name, r.sites])));
  console.error("\nEach of these voids its whole declaration in browsers (invalid var() = unset).");
  console.error("Either define the token or add a var(--x, fallback).\n");
  failed = true;
}

if (failed) {
  process.exit(1);
} else {
  console.log(`OK — no --o2-* tokens and no undefined CSS custom property references (${defined.size} tokens defined, ${referenced.size} distinct refs checked).`);
}
