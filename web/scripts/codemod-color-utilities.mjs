#!/usr/bin/env node
// Converts Tailwind arbitrary-value color usages to the registered utility class:
//   bg-[var(--color-surface-base)]  -> bg-surface-base
//   text-(--color-text-primary)     -> text-text-primary   (v4 shorthand)
//   border-[var(--color-border-default)] -> border-border-default
// SAFE by construction: only converts tokens registered in @theme inline (so the
// utility is guaranteed to exist). Skips: fallback-containing values (would drop the
// fallback), tw:-prefixed usages (legacy dead prefix), and compound values.
//
// Usage: node scripts/codemod-color-utilities.mjs [file-or-dir ...]  (default: src)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

// registered tokens (have utilities) — parsed from @theme inline blocks
const REG = new Set();
for (const f of ["semantic.css", "component.css", "base.css"]) {
  const txt = readFileSync(join(SRC, "lib/styles/tokens", f), "utf8");
  for (const m of txt.matchAll(/@theme\s+inline\s*\{([\s\S]*?)\n\}/g))
    for (const d of m[1].matchAll(/(--color-[A-Za-z0-9-]+)\s*:/g)) REG.add(d[1]);
}

// color-taking utility prefixes
const PREFIXES = new Set(["bg","text","border","border-t","border-b","border-l","border-r",
  "border-x","border-y","fill","stroke","ring","ring-offset","outline","decoration","divide",
  "accent","caret","from","via","to","placeholder"]);

// prefix-[var(--color-X)]  or  prefix-(--color-X)   — NO comma (no fallback) inside.
const RE = /(^|[\s"'`])((?:[a-z-]+:)*)([a-z][a-z-]*)-(?:\[var\(\s*(--color-[A-Za-z0-9-]+)\s*\)\]|\(\s*(--color-[A-Za-z0-9-]+)\s*\))/g;

function convert(text) {
  let n = 0;
  const out = text.replace(RE, (full, pre, variants, prefix, tokA, tokB) => {
    const tok = tokA || tokB;
    if (!PREFIXES.has(prefix)) return full;
    if (!REG.has(tok)) return full;
    if (variants.includes("tw:")) return full;        // leave legacy tw: usages alone
    n++;
    return `${pre}${variants}${prefix}-${tok.replace("--color-", "")}`;
  });
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

const targets = process.argv.slice(2);
const roots = targets.length ? targets.map((t) => join(SRC, t)) : [SRC];
let tf = 0, tn = 0;
for (const r of roots) {
  const files = statSync(r).isDirectory() ? walk(r) : [r];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const { out, n } = convert(src);
    if (n > 0) { writeFileSync(f, out); tf++; tn += n; console.log(`${f.replace(SRC + "/", "src/")}: ${n}`); }
  }
}
console.log(`\nDone — ${tn} conversion(s) across ${tf} file(s).`);
