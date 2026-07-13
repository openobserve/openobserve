// Copyright 2026 OpenObserve Inc.

// vue-tsc / node can run out of heap and STILL exit 0, printing only a GC
// trace to stderr. That is the dangerous "fails open" case: CI goes green on a
// run that never actually type-checked anything. These markers identify such a
// crash so the wrapper can force a non-zero exit regardless of the real code.
export const CRASH_MARKERS = [
  "JavaScript heap out of memory",
  "FATAL ERROR",
  "Last few GCs",
  "Allocation failed",
  "Reached heap limit",
];

const CRASH_RE = new RegExp(
  CRASH_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

/**
 * True when the given process output looks like an OOM / fatal V8 crash
 * rather than an ordinary "found N type errors" result.
 * @param {string} output combined stdout + stderr
 * @returns {boolean}
 */
export const looksLikeCrash = (output) => CRASH_RE.test(output ?? "");
