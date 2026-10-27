// Copyright 2026 OpenObserve Inc.
// HT-12 AC 8: every state the harness cannot reach yet is a visible gap, named with the WP that closes it.

import { test } from "@playwright/test";

const GAPS = [
  ["SEC-11 the shared page renders the three blocks and no forged fourth (history half: record.spec.ts)", "WP-12"],
  ["CTX-05 a door refuses the 21st row with the cap line and no In chat tick", "WP-07"],
  ["PERF-06 open and close x50 and 30 chat_300 records from history", "WP-11"],
  ["DOOR log-row Explain sends through openAssistant", "WP-07"],
  ["EVID query block runs inline and opens in Logs", "WP-08"],
  ["XTAB-10 a hidden tail holder hands the tail to the visible tab (needs the B-03 tail)", "WP-21"],
  ["SHARE-06 the continued chat opens with the shared turns read-only above the divider (history open)", "WP-11"],
  ["GATE-07 Download chat in the thread overflow beside the disabled Share", "WP-11"],
];

test.describe("assistant states not reachable yet", () => {
  for (const [state, wp] of GAPS) {
    test.fixme(`${state} (${wp})`, async () => {});
  }
});
