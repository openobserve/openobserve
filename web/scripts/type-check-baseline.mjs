#!/usr/bin/env node
// Type-check with a baseline ratchet.
//
// Enables us to turn on `strict` (and later flags) without a big-bang fix: the
// recorded baseline of known errors is grandfathered, and CI fails ONLY on
// errors NOT in the baseline. The baseline may only shrink — a PR that adds a
// new strict error fails; a PR that fixes one lets you regenerate a smaller
// baseline. Delete the baseline (and switch back to a plain 0-error gate) once
// it reaches empty.
//
// Signatures drop line/column so ordinary edits don't churn the baseline; a
// file+code+message multiset is compared, so counts still ratchet.
//
//   node scripts/type-check-baseline.mjs           # check (fails on NEW errors)
//   node scripts/type-check-baseline.mjs --update  # regenerate the baseline
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const vueTsc = require.resolve("vue-tsc/bin/vue-tsc.js");

const PROJECT = "tsconfig.app.json";
const BASELINE = "typecheck-baseline.txt";
const update = process.argv.includes("--update");

const res = spawnSync(
  process.execPath,
  [vueTsc, "--noEmit", "-p", PROJECT, "--composite", "false"],
  {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024, // vue-tsc's full diagnostic output can exceed the 1MB default and would silently truncate
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=12288`.trim() },
  },
);
const stdout = res.stdout ?? "";
const combined = stdout + (res.stderr ?? "");

// Fail-closed: a crash/OOM must never read as "no new errors".
if (res.signal != null || res.status == null || /Mark-Compact|allocation failure|FATAL ERROR|JavaScript heap out of memory/i.test(combined)) {
  console.error(`[baseline] vue-tsc crashed or ran out of memory (signal=${res.signal}, status=${res.status}) — failing.`);
  process.exit(1);
}

// path(line,col): error TSxxxx: message  ->  path\tTSxxxx\tmessage  (line/col dropped).
// Diagnostics are read from stdout only (vue-tsc echoes them to stderr too; using
// both would double every signature).
const sigOf = (line) => {
  const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/);
  return m ? `${m[1]}\t${m[2]}\t${m[3]}` : null;
};
const signatures = stdout.split("\n").map(sigOf).filter(Boolean).sort();

if (update) {
  writeFileSync(BASELINE, signatures.join("\n") + (signatures.length ? "\n" : ""));
  console.log(`[baseline] wrote ${signatures.length} known errors to ${BASELINE}.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, "utf8").split("\n").filter(Boolean)
  : [];

// Multiset diff: current − baseline = newly introduced errors.
const counts = new Map();
for (const s of baseline) counts.set(s, (counts.get(s) ?? 0) + 1);
const added = [];
for (const s of signatures) {
  const c = counts.get(s) ?? 0;
  if (c > 0) counts.set(s, c - 1);
  else added.push(s);
}
// Anything left with a positive count was fixed → baseline can shrink.
let cleared = 0;
for (const c of counts.values()) cleared += c;

if (added.length) {
  console.error(`[baseline] ${added.length} NEW type error(s) not in the baseline:\n`);
  for (const s of added) console.error("  " + s.replace(/\t/g, "  "));
  console.error(`\nFix them, or if intentional run: npm run type-check:app -- --update (only when the baseline should change).`);
  process.exit(1);
}

console.log(
  `[baseline] OK — no new type errors (baseline=${baseline.length}` +
    (cleared ? `, ${cleared} cleared — run --update to shrink the baseline` : "") +
    ").",
);
process.exit(0);
