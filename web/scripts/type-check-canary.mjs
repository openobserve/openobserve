#!/usr/bin/env node
// Asserts the type-check toolchain REPORTS a known planted error
// (src/__canary__/typecheck-canary.ts). If the error is NOT reported, the
// checker is dark (no-op glob, silent OOM, wrong config) → fail CI.
//
// Inverted logic vs a normal check: a reported error here means SUCCESS.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vueTsc = require.resolve("vue-tsc/bin/vue-tsc.js");

const res = spawnSync(
  process.execPath,
  [vueTsc, "--noEmit", "-p", "tsconfig.canary.json", "--composite", "false"],
  { encoding: "utf8" },
);
const combined = (res.stdout ?? "") + (res.stderr ?? "");

if (/error TS\d+/.test(combined)) {
  console.log("[type-check:canary] OK — the planted error was reported; the type-check is live.");
  process.exit(0);
}

console.error(
  "[type-check:canary] FAIL — the planted type error was NOT reported. The type-check is DARK (reads no source / crashed silently / wrong config).\n" +
    combined,
);
process.exit(1);
