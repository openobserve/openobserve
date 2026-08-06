#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.
//
// Prove a CSS refactor is a no-op at the BUILT stylesheet level
// (O2_STYLE_MIGRATION_PLAN.md §7.2). Emits a stable, sorted, diffable summary of
// every selector in a built CSS bundle plus a hash of its declarations, so
// `diff before.txt after.txt` shows exactly what changed — and nothing else.
//
// Declarations are normalised (whitespace collapsed, declarations sorted) so a
// pure MOVE between files/layers hashes identically and produces no diff noise.
//
// Usage:
//   npm run build-only
//   node scripts/css-selector-diff.mjs dist/assets/*.css > /tmp/css-before.txt
//   # ...on the migration branch...
//   node scripts/css-selector-diff.mjs dist/assets/*.css > /tmp/css-after.txt
//   diff /tmp/css-before.txt /tmp/css-after.txt

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("Usage: node scripts/css-selector-diff.mjs <built.css>...");
  process.exit(2);
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Normalise a declaration body: sort declarations, collapse whitespace.
 * Makes a moved rule hash identically to its original.
 */
function normaliseBody(body) {
  return body
    .split(";")
    .map((d) => d.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join(";");
}

function hash(s) {
  return createHash("sha1").update(s).digest("hex").slice(0, 10);
}

/**
 * Recursively collect rules, tracking at-rule context (@media/@layer/@supports)
 * so a rule that changes layer shows up as a changed context.
 */
function collect(css, context, out) {
  let depth = 0;
  let start = 0;
  let braceStart = -1;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) braceStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const prelude = css.slice(start, braceStart).replace(/\s+/g, " ").trim();
        const body = css.slice(braceStart + 1, i);
        if (prelude.startsWith("@")) {
          const at = prelude.split(/\s|\(/)[0].toLowerCase();
          if (at === "@media" || at === "@layer" || at === "@supports" || at === "@container") {
            // nested context — recurse
            collect(body, context ? `${context} > ${prelude}` : prelude, out);
          } else {
            // @keyframes / @font-face / @theme — hash body as a unit
            out.push({ context, selector: prelude, hash: hash(body.replace(/\s+/g, " ").trim()) });
          }
        } else if (prelude) {
          // Split grouped selectors so reordering a group isn't a false diff.
          const norm = normaliseBody(body);
          for (const sel of prelude.split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)) {
            out.push({ context, selector: sel, hash: hash(norm) });
          }
        }
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      start = i + 1;
    }
  }
}

const rules = [];
for (const file of files) {
  collect(stripComments(readFileSync(file, "utf8")), "", rules);
}

// Sort for a stable diff; dedupe identical (context, selector, hash) triples.
const seen = new Set();
const lines = [];
for (const r of rules) {
  const key = `${r.context}|${r.selector}|${r.hash}`;
  if (seen.has(key)) continue;
  seen.add(key);
  lines.push(`${r.context ? r.context + "  ::  " : ""}${r.selector}  #${r.hash}`);
}
lines.sort();

console.log(lines.join("\n"));
console.error(`css-selector-diff: ${lines.length} unique rules from ${files.length} file(s).`);
