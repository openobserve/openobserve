#!/usr/bin/env node
// Phase C/F AUTO-TIER — only value-identical, theme-independent renames that carry
// ZERO visual risk (§7). Excludes every "review tier" case (gray text shades,
// bg-white, status colors, dark-pair collapse) which needs human/visual judgment.
//
//   node scripts/codemod-safe-renames.mjs [dir]   (default: src)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

// [regex, replacement] — each is an EXACT-VALUE rename (same rendered px/rem).
// text-xs = 0.75rem = 12px (Tailwind default, NOT re-pinned) → identical.
const RULES = [
  [/text-\[12px\]/g, "text-xs"],
  [/text-\[0\.75rem\]/g, "text-xs"],
];

function convert(text) {
  let n = 0;
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, (m) => { n++; return rep; });
  }
  return { out, n };
}

function walk(d, a = []) {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === "dist") continue;
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p, a) : (extname(e) === ".vue" && a.push(p));
  }
  return a;
}

const root = process.argv[2] ? join(SRC, process.argv[2]) : SRC;
const files = statSync(root).isDirectory() ? walk(root) : [root];
let tf = 0, tn = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const { out, n } = convert(src);
  if (n > 0) { writeFileSync(f, out); tf++; tn += n; console.log(`${f.replace(SRC + "/", "src/")}: ${n}`); }
}
console.log(`\nDone — ${tn} rename(s) across ${tf} file(s).`);
