// Copyright 2026 OpenObserve Inc.
// HT-12 AC 8: every state the harness cannot reach yet is a visible gap, named with the WP that closes it.

import { test } from "@playwright/test";

const GAPS = [
  ["SEC-11 the shared page renders the three blocks and no forged fourth (history half: record.spec.ts)", "WP-12"],
  ["CTX-05 a door refuses the 21st row with the cap line and no In chat tick", "WP-07"],
  ["GATE-10 off_for_org copy per role (B-14 settingsEnabled)", "WP-14"],
  ["PERF-06 open and close x50 and 30 chat_300 records from history", "WP-11"],
  ["DOOR log-row Explain sends through openAssistant", "WP-07"],
  ["EVID query block runs inline and opens in Logs", "WP-08"],
  ["HIST history list, thread header and local-only mode", "WP-11"],
  ["SHARE one-click snapshot and the shared page", "WP-12"],
  ["RCA incident analysis card before ?stream=true", "WP-13"],
  ["HELPER inline query helper proposes a diff", "WP-13"],
  ["ADMIN-14 Settings › Assistant status @edition", "WP-14"],
];

test.describe("assistant states not reachable yet", () => {
  for (const [state, wp] of GAPS) {
    test.fixme(`${state} (${wp})`, async () => {});
  }
});
