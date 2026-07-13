#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.

// Proves the typecheck is ALIVE on every CI run. A passing typecheck means
// nothing unless we can show the tool is capable of FAILING. This asserts two
// independent fail paths:
//   1. A deliberate type error IS reported  (guards the no-op-glob / dark case).
//   2. An OOM / crash trace is treated as failure (guards the exit-0-on-crash
//      case) — verified against the exact detector the real wrapper uses.
// If either assertion fails, the checker is dark and this script exits non-zero.

import { spawnSync } from "node:child_process";
import { looksLikeCrash } from "./lib/detect-crash.mjs";

const EXPECTED_CODE = "TS2322";
let ok = true;

// --- Assertion 1: a real type error is reported -----------------------------
const run = spawnSync(
  "vue-tsc --noEmit -p tsconfig.canary.json --composite false",
  { shell: true, encoding: "utf8" },
);
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

if (run.status !== 0 && output.includes(EXPECTED_CODE)) {
  console.log(`[canary] PASS — checker reported ${EXPECTED_CODE} for the planted error.`);
} else {
  ok = false;
  console.error(
    `[canary] FAIL — the deliberate type error was NOT reported.\n` +
      `  exit=${run.status}, expected code=${EXPECTED_CODE}\n` +
      `  The typecheck is DARK (matching nothing / OOM-exiting-0 / misconfigured).\n` +
      `--- checker output ---\n${output}`,
  );
}

// --- Assertion 2: the OOM/crash fail-safe actually trips ---------------------
const FAKE_GC_TRACE =
  "<--- Last few GCs --->\n[62141] Mark-Compact ... allocation failure\n" +
  "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
const NORMAL_ERRORS = "src/foo.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.";

if (looksLikeCrash(FAKE_GC_TRACE) && !looksLikeCrash(NORMAL_ERRORS)) {
  console.log("[canary] PASS — OOM/crash output is detected; ordinary type errors are not misread as crashes.");
} else {
  ok = false;
  console.error(
    "[canary] FAIL — crash detector is broken: an OOM crash could pass as success (exit 0).",
  );
}

process.exit(ok ? 0 : 1);
