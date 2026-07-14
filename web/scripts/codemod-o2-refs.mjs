#!/usr/bin/env node
// Rewrites --o2-* references to their modern --color-* equivalent, per
// o2-token-map.json (Bucket A/B/C only -- Bucket D is handled separately in
// Stage 4, and "skip" entries are intentionally left alone).
//
// Rewrites three call shapes:
//   var(--o2-x)            -> var(--color-y)
//   var(--o2-x, fallback)  -> var(--color-y, fallback)
//   (--o2-x)  / (--o2-x,fallback)   -- Tailwind v4 `bg-(--o2-x)` shorthand
//
// Usage: node scripts/codemod-o2-refs.mjs <dir> [<dir> ...]   (relative to web/src)
//   e.g. node scripts/codemod-o2-refs.mjs lib components
//   With no args, runs across all of src/.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");
const MAP = JSON.parse(readFileSync(join(__dirname, "o2-token-map.json"), "utf8"));
const FLAT_MAP = { ...MAP.migrate };
delete FLAT_MAP._comment;

const EXTS = new Set([".vue", ".ts", ".css"]);

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

function rewrite(text) {
  let changed = 0;
  for (const [legacy, modern] of Object.entries(FLAT_MAP)) {
    const escaped = legacy.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    // var(--o2-x) / var(--o2-x, fallback) -- boundary so --o2-x-2 doesn't match --o2-x
    const varRe = new RegExp(`var\\(\\s*${escaped}(?![\\w-])`, "g");
    text = text.replace(varRe, (m) => {
      changed++;
      return m.replace(legacy, modern);
    });
    // Tailwind v4 `(--o2-x)` / `(--o2-x,fallback)` shorthand (not inside var())
    const shortRe = new RegExp(`\\(${escaped}(?![\\w-])`, "g");
    text = text.replace(shortRe, (m, offset, str) => {
      // skip if this is actually `var(--o2-x` (already handled above)
      const before = str.slice(Math.max(0, offset - 4), offset);
      if (/var\(\s*$/.test(before)) return m;
      changed++;
      return m.replace(legacy, modern);
    });
  }
  return { text, changed };
}

const targets = process.argv.slice(2);
const dirs = targets.length > 0 ? targets.map((t) => join(SRC_DIR, t)) : [SRC_DIR];

let totalFiles = 0;
let totalChanges = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    const original = readFileSync(file, "utf8");
    const { text, changed } = rewrite(original);
    if (changed > 0) {
      writeFileSync(file, text);
      totalFiles++;
      totalChanges += changed;
      console.log(`${file.replace(SRC_DIR + "/", "src/")}: ${changed} ref(s)`);
    }
  }
}
console.log(`\nDone -- ${totalChanges} reference(s) rewritten across ${totalFiles} file(s).`);
