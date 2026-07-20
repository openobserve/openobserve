#!/usr/bin/env node
// Phase F MECHANICAL burn-down — theme-neutral, value-identical renames only.
// Radius (§3.I), typography (§3.J), spacing (§3.N and §3.M).
// NO color / dark-mode work here (that needs semantic judgment → separate pass).
// z-index intentionally excluded (needs the §12.5 ladder sign-off).
//
//   node scripts/codemod-mechanical.mjs [dir]   (default: src)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

// Exact-value string replacements (order matters — longest/most-specific first).
const RULES = [
  // ── Typography (§3.J) — all map to registered utilities, identical rendered size ──
  [/text-\[11\.5px\]/g, "text-2xs"],
  [/text-\[11px\]/g, "text-2xs"],
  [/text-\[0\.6875rem\]/g, "text-2xs"],
  // NOTE: text-[10px]/[0.625rem] intentionally NOT mapped — the 10px floor is an
  // undecided call (§12.6). Lifting to 11px would be an unsanctioned visual change.
  [/text-\[13px\]/g, "text-compact"],
  [/text-\[0\.8125rem\]/g, "text-compact"],
  [/text-\[14px\]/g, "text-sm"],
  [/text-\[0\.875rem\]/g, "text-sm"],
  [/text-\[15px\]/g, "text-sm"],
  [/text-\[0\.9375rem\]/g, "text-sm"],

  // ── Radius (§3.I) — arbitrary → policy-table utility (identical px) ──
  [/rounded-\[2px\]/g, "rounded-sm"],
  [/rounded-\[3px\]/g, "rounded-sm"],
  [/rounded-\[4px\]/g, "rounded-sm"],
  [/rounded-\[0\.25rem\]/g, "rounded-sm"],
  [/rounded-\[5px\]/g, "rounded-md"],
  [/rounded-\[6px\]/g, "rounded-md"],
  [/rounded-\[0\.3rem\]/g, "rounded-md"],
  [/rounded-\[0\.375rem\]/g, "rounded-md"],
  [/rounded-\[8px\]/g, "rounded-lg"],
  [/rounded-\[0\.5rem\]/g, "rounded-lg"],
  [/rounded-\[10px\]/g, "rounded-lg"],
  [/rounded-\[0\.625rem\]/g, "rounded-lg"],
  [/rounded-\[12px\]/g, "rounded-xl"],
  [/rounded-\[0\.75rem\]/g, "rounded-xl"],
  [/rounded-\[20px\]/g, "rounded-full"],
  [/rounded-\[3\.125rem\]/g, "rounded-full"],

  // ── Typography weight utils (§3.M) — the old helper CSS isn't loaded ──
  [/\btext-weight-bold\b/g, "font-bold"],
  [/\btext-weight-bolder\b/g, "font-extrabold"],
  [/\btext-weight-medium\b/g, "font-medium"],
  [/\btext-weight-regular\b/g, "font-normal"],
  [/\btext-weight-light\b/g, "font-light"],
  [/\btext-weight-thin\b/g, "font-thin"],
];

// Bare `rounded` → `rounded-sm` (identical 4px). Handled separately so we can use a
// lookbehind/lookahead that requires it be a standalone class token in an attribute.
const BARE_ROUNDED = /(?<=[\s"'`:])rounded(?=[\s"'`])/g;

// Spacing: X-[Npx] → X-{N/4} for EVEN N (exact Tailwind step). Odd N left as oddball.
const SPACING_PROPS = "gap|p|pt|pb|pl|pr|px|py|m|mt|mb|ml|mr|mx|my|w|h|min-w|min-h|max-w|max-h|top|left|right|bottom|inset|leading";
const SPACING_RE = new RegExp(`\\b(${SPACING_PROPS})-\\[(\\d+)px\\]`, "g");

function convert(text) {
  let n = 0;
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, () => { n++; return rep; });
  out = out.replace(BARE_ROUNDED, () => { n++; return "rounded-sm"; });
  out = out.replace(SPACING_RE, (full, prop, px) => {
    const p = parseInt(px, 10);
    if (p === 0) { n++; return `${prop}-0`; }
    if (p % 2 !== 0) return full;            // odd px — leave for manual review
    const stepQuarter = p / 4;               // Tailwind step (supports .5)
    if (!Number.isInteger(stepQuarter * 2)) return full;
    const s = Number.isInteger(stepQuarter) ? String(stepQuarter) : String(stepQuarter);
    n++; return `${prop}-${s}`;
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

const root = process.argv[2] ? join(SRC, process.argv[2]) : SRC;
const files = statSync(root).isDirectory() ? walk(root) : [root];
let tf = 0, tn = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const { out, n } = convert(src);
  if (n > 0) { writeFileSync(f, out); tf++; tn += n; console.log(`${f.replace(SRC + "/", "src/")}: ${n}`); }
}
console.log(`\nDone — ${tn} rename(s) across ${tf} file(s).`);
