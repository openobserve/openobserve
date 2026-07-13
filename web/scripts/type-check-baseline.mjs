#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.

// Phase 1 ratchet for the frontend typecheck. The codebase carries thousands of
// pre-existing type errors that cannot block merges on day one. This records
// those known errors in a baseline and fails CI only on errors that are NOT in
// it — so new code is checked immediately while the debt is paid down over time.
//
//   node scripts/type-check-baseline.mjs            GATE mode (CI): exit non-zero
//        only when a type error appears that is not in the baseline.
//
//   node scripts/type-check-baseline.mjs --update   Re-record the baseline from
//        the current errors. REFUSES to grow the total, so a regression can
//        never be laundered into the baseline — it must be fixed.
//
// The baseline may only shrink. Delete it once it reaches zero and promote the
// gate to a hard check. See the type-check PRD, Phase 1.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { looksLikeCrash } from "./lib/detect-crash.mjs";

const BASELINE_PATH = "type-check-baseline.json";
const HEAP_MB = 8192; // ~2.3x the ~3.5 GB measured peak; keep under CI runner RAM. See type-check.mjs.
const UPDATE = process.argv.includes("--update");

// tsc "pretty false" diagnostics are one per line: path(line,col): error TSxxxx: message
const ERROR_RE = /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.*)$/;

function runTypecheck() {
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${HEAP_MB}`.trim(),
  };
  const res = spawnSync(
    "vue-tsc --noEmit --pretty false -p tsconfig.vitest.json --composite false",
    // Thousands of error lines easily exceed the 1 MB default stdout buffer.
    { shell: true, encoding: "utf8", env, maxBuffer: 256 * 1024 * 1024 },
  );
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (looksLikeCrash(output)) {
    console.error("[type-check] vue-tsc crashed (out of memory / fatal). Results cannot be trusted — failing.");
    process.exit(1);
  }
  return output;
}

// Key = "<relative file>|<code>|<message>". Line/column are deliberately dropped
// so an edit that only shifts line numbers does not churn the baseline.
function collectErrors(output) {
  const counts = new Map();
  for (const raw of output.split(/\r?\n/)) {
    const m = raw.match(ERROR_RE);
    if (!m) continue;
    const key = `${m.groups.file}|${m.groups.code}|${m.groups.msg}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  const json = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return new Map(Object.entries(json.errors ?? {}));
}

const total = (counts) => [...counts.values()].reduce((a, n) => a + n, 0);

function writeBaseline(counts) {
  const errors = {};
  for (const key of [...counts.keys()].sort()) errors[key] = counts.get(key);
  const doc = {
    version: 1,
    tool: "vue-tsc --noEmit -p tsconfig.vitest.json",
    note: "Known pre-existing type errors. May only shrink. Regenerate with: npm run type-check:baseline",
    total: total(counts),
    errors,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
}

// Per-key: occurrences in `current` beyond what the baseline permits.
function newErrors(current, baseline) {
  const out = [];
  for (const [key, cnt] of current) {
    const allowed = baseline.get(key) ?? 0;
    if (cnt > allowed) out.push({ key, extra: cnt - allowed });
  }
  return out;
}

const current = collectErrors(runTypecheck());

// ---- --update: re-record, but never grow the total --------------------------
if (UPDATE) {
  const baseline = loadBaseline();
  if (baseline && total(current) > total(baseline)) {
    const added = newErrors(current, baseline);
    console.error(
      `[baseline] Refusing to update: this would grow the baseline from ` +
        `${total(baseline)} to ${total(current)} errors. The baseline may only shrink.\n` +
        `Fix these instead of recording them:\n` +
        added.slice(0, 50).map((e) => `  + [${e.extra}] ${e.key.replaceAll("|", "  ")}`).join("\n"),
    );
    process.exit(1);
  }
  writeBaseline(current);
  console.log(`[baseline] Wrote ${BASELINE_PATH} — ${total(current)} known error(s) recorded.`);
  process.exit(0);
}

// ---- GATE mode (CI) ---------------------------------------------------------
const baseline = loadBaseline();
if (!baseline) {
  console.error(`[baseline] No ${BASELINE_PATH} found. Generate it once with: npm run type-check:baseline`);
  process.exit(1);
}

const added = newErrors(current, baseline);
const fixedCount = total(baseline) - (total(current) - added.reduce((a, e) => a + e.extra, 0));

if (fixedCount > 0) {
  console.log(
    `[baseline] ${fixedCount} baseline error(s) no longer occur. ` +
      `Run 'npm run type-check:baseline' to lock in the improvement.`,
  );
}

if (added.length) {
  const n = added.reduce((a, e) => a + e.extra, 0);
  console.error(`\n[baseline] ${n} type error(s) not in the baseline:\n`);
  for (const e of added.slice(0, 200)) console.error(`  + [${e.extra}] ${e.key.replaceAll("|", "  ")}`);
  if (added.length > 200) console.error(`  ...and ${added.length - 200} more`);
  console.error(
    `\nNew type errors are not allowed. Fix them. ` +
      `If you MOVED existing code (same errors, different file), run 'npm run type-check:baseline' to re-record.`,
  );
  process.exit(1);
}

console.log(
  `[baseline] OK — no new type errors. ` +
    `${total(current)} known error(s) remain (baseline allows ${total(baseline)}).`,
);
process.exit(0);
