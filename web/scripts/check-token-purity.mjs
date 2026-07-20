#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.
//
// CI guard: the 4 token files must contain TOKENS ONLY — no class/element rules,
// no keyframes, no media queries, no layers. See O2_STYLE_MIGRATION_PLAN.md §5.1.
//
// Sanctioned constructs (W1 target end-state):
//   :root { --x: … }                 token definitions (color-scheme allowed)
//   .dark / :root.dark / .dark :root  dark token overrides (--x only)
//   [data-variant=…] / [data-x=…]     variant token overrides (--x only)
//   @theme { … } / @theme inline      Tailwind registration
//   @font-face { … }                  font declarations (base.css)
//   comments
//
// Anything else is non-token content that must be evacuated to base-elements.css,
// utilities.css, or a component. Starts in ratchet mode (warn vs baseline) and
// flips to error in W1.e by deleting token-purity-baseline.json.
//
// Run:
//   node scripts/check-token-purity.mjs             # fail if worse than baseline
//   node scripts/check-token-purity.mjs --baseline  # (re)write the baseline
//   node scripts/check-token-purity.mjs --list      # show every offending construct

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = join(__dirname, "..", "src", "lib", "styles", "tokens");
const BASELINE = join(__dirname, "token-purity-baseline.json");
const FILES = ["base.css", "semantic.css", "component.css", "dark.css"];

// Selectors that may legitimately carry token definitions.
// `[data-…]` uses `[^\]]*` (not `[a-z-]+…[^\]]*`) so a single selector has one
// unambiguous parse — the overlapping-quantifier form tripped CodeQL's ReDoS check.
const TOKEN_SELECTOR =
  "(?::root|html|\\.dark|:root\\.dark|\\.dark :root|\\[data-[^\\]]*\\]|\\.dark \\[data-[^\\]]*\\])";
const TOKEN_SELECTOR_RE = new RegExp(
  `^${TOKEN_SELECTOR}(?:\\s*,\\s*${TOKEN_SELECTOR})*$`,
);

// Declarations allowed alongside custom properties inside a token block.
const ALLOWED_DECL_RE = /^(color-scheme|--[A-Za-z0-9_-]+)$/;

/**
 * Strip comments while preserving byte offsets (so line numbers stay correct).
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Walk top-level constructs of a stylesheet.
 * Returns [{ kind: 'at'|'rule', prelude, body, line }]
 */
function topLevelConstructs(css) {
  const out = [];
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
        const prelude = css.slice(start, braceStart).trim();
        const body = css.slice(braceStart + 1, i);
        const line = css.slice(0, start).split("\n").length;
        if (prelude) {
          out.push({
            kind: prelude.startsWith("@") ? "at" : "rule",
            prelude,
            body,
            line,
          });
        }
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      // top-level statement, e.g. @import / @charset
      const stmt = css.slice(start, i).trim();
      if (stmt.startsWith("@")) {
        out.push({
          kind: "at",
          prelude: stmt,
          body: "",
          line: css.slice(0, start).split("\n").length,
        });
      }
      start = i + 1;
    }
  }
  return out;
}

/**
 * Property names declared directly in a block body (ignores nested blocks).
 */
function declaredProps(body) {
  const flat = body.replace(/\{[^{}]*\}/g, "");
  const props = [];
  for (const seg of flat.split(";")) {
    const idx = seg.indexOf(":");
    if (idx === -1) continue;
    const name = seg.slice(0, idx).trim();
    if (name) props.push(name);
  }
  return props;
}

const violations = [];

for (const file of FILES) {
  const full = join(TOKENS_DIR, file);
  if (!existsSync(full)) continue;
  const css = stripComments(readFileSync(full, "utf8"));

  for (const node of topLevelConstructs(css)) {
    const at = node.prelude.split(/\s|\{/)[0].toLowerCase();

    if (node.kind === "at") {
      // @theme / @theme inline / @font-face are sanctioned.
      if (at === "@theme" || at === "@font-face" || at === "@import" || at === "@charset") continue;
      violations.push({
        file,
        line: node.line,
        selector: node.prelude.split("\n")[0].slice(0, 80),
        reason: `${at} is not a token construct`,
      });
      continue;
    }

    // Plain rule: selector must be a token-carrying selector...
    const selector = node.prelude.replace(/\s+/g, " ").trim();
    if (!TOKEN_SELECTOR_RE.test(selector)) {
      violations.push({
        file,
        line: node.line,
        selector: selector.slice(0, 80),
        reason: "class/element selector — not a token block",
      });
      continue;
    }

    // ...and may only declare custom properties.
    const bad = declaredProps(node.body).filter((p) => !ALLOWED_DECL_RE.test(p));
    if (bad.length > 0) {
      violations.push({
        file,
        line: node.line,
        selector: selector.slice(0, 80),
        reason: `non-token declaration(s): ${[...new Set(bad)].slice(0, 4).join(", ")}`,
      });
    }
  }
}

// Count per file.
const current = {};
for (const v of violations) current[v.file] = (current[v.file] || 0) + 1;
const total = violations.length;

if (process.argv.includes("--list")) {
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  ${v.selector}\n      → ${v.reason}`);
  }
  console.log(`\n${total} non-token construct(s).`);
  process.exit(0);
}

if (process.argv.includes("--baseline")) {
  writeFileSync(BASELINE, JSON.stringify({ total, files: current }, null, 2) + "\n");
  console.log(`Wrote token-purity baseline: ${total} non-token construct(s) across ${Object.keys(current).length} file(s).`);
  process.exit(0);
}

// No baseline = zero-tolerance mode (the W1.e end state).
if (!existsSync(BASELINE)) {
  if (total === 0) {
    console.log("OK — token files contain tokens only.");
    process.exit(0);
  }
  console.error(`\ncheck-token-purity: ${total} non-token construct(s) in token files (zero-tolerance mode):\n`);
  for (const v of violations.slice(0, 40)) {
    console.error(`  ${v.file}:${v.line}  ${v.selector}\n      → ${v.reason}`);
  }
  if (total > 40) console.error(`  ...and ${total - 40} more (--list to see all)`);
  console.error("\nToken files may contain tokens only. Move rules to src/styles/base-elements.css,");
  console.error("src/styles/utilities.css, or the owning component. See O2_STYLE_MIGRATION_PLAN.md §3.\n");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const base = baseline.files || {};
const regressions = [];
let improved = 0;

for (const file of new Set([...Object.keys(current), ...Object.keys(base)])) {
  const now = current[file] || 0;
  const was = base[file] || 0;
  if (now > was) regressions.push({ file, was, now });
  else if (now < was) improved += was - now;
}

if (regressions.length > 0) {
  console.error(`\ncheck-token-purity: ${regressions.length} regression(s) above baseline:\n`);
  for (const r of regressions) {
    console.error(`  ${r.file}  ${r.was} → ${r.now}  (+${r.now - r.was})`);
  }
  console.error("\nDo not add class/element/keyframe rules to token files. See O2_STYLE_MIGRATION_PLAN.md §3.\n");
  process.exit(1);
}

console.log(`check-token-purity: OK — ${total} non-token construct(s), at or below baseline (${baseline.total}).`);
if (improved > 0) {
  console.log(`Improved by ${improved} — re-run with --baseline and commit the update.`);
}
