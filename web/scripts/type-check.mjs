#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.

// Runs the real frontend typecheck. Two things this wrapper guarantees that a
// bare `vue-tsc` invocation does not:
//   1. Enough V8 heap to actually finish over the full source tree (~1,600
//      files). Without this vue-tsc OOMs partway through.
//   2. An OOM / fatal crash is treated as FAILURE even when vue-tsc exits 0.
//      Historically the check "passed" precisely because it crashed silently.
//
// See web/.claude/rules or the type-check PRD for the full story.

import { spawn } from "node:child_process";
import { looksLikeCrash } from "./lib/detect-crash.mjs";

// Measured peak RSS over the full source tree (~2,650 files) is ~3.5 GB, so
// 8 GB is ~2.3x headroom while staying under a 16 GB CI runner's physical RAM.
// Do NOT set this above the CI runner's RAM: V8 would defer GC and the OS OOM-
// killer would SIGKILL the process instead — the exact silent-death we guard.
const HEAP_MB = 8192;
const COMMAND = "vue-tsc --noEmit -p tsconfig.vitest.json --composite false";

const env = {
  ...process.env,
  // Applies to vue-tsc's node process and any node it spawns.
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${HEAP_MB}`.trim(),
};

// stdout is inherited so type errors stream live; stderr is captured so we can
// inspect it for a crash trace, and re-emitted so the user still sees it.
const child = spawn(COMMAND, {
  env,
  shell: true,
  stdio: ["inherit", "inherit", "pipe"],
});

let stderrBuf = "";
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  stderrBuf += text;
  process.stderr.write(text);
});

child.on("close", (code) => {
  if (looksLikeCrash(stderrBuf)) {
    process.stderr.write(
      "\n[type-check] vue-tsc crashed (out of memory / fatal error). " +
        "Treating as FAILURE regardless of its exit code — the typecheck did " +
        "NOT run to completion.\n",
    );
    process.exit(1);
  }
  process.exit(code ?? 1);
});
