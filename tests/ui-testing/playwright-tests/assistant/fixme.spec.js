// Copyright 2026 OpenObserve Inc.
// HT-12 AC 8: every state the harness cannot reach yet is a visible gap, named with the WP that closes it.

import { test } from "@playwright/test";

const GAPS = [
  ["SMOKE-02 v2 happy path from the header to done", "WP-06"],
  ["SHELL-01 the chord lands on assistant-composer", "WP-05"],
  ["SHELL-08 the composer and last message stay above an emulated keyboard", "WP-05"],
  ["SHELL-12 Escape closes and never stops a running turn; IME-safe", "WP-05"],
  ["GATE-06 a 403 mid-session swaps the container to G2", "WP-05"],
  ["GATE-11 and GATE-13 the first send settles an unknown role", "WP-05"],
  ["GATE-10 off_for_org copy per role (B-14 settingsEnabled)", "WP-14"],
  ["PERF-06 open and close x50 and 30 chat_300 records from history", "WP-11"],
  ["TURN drop_mid_stream ends as failed{stream_dropped} with Retry", "WP-06"],
  ["TURN keepalive_stall shows 'No response for {n} s'", "WP-06"],
  ["ERR refusals restore the composer (HT-03) for every HTTP scenario", "WP-06"],
  ["CTX tray shows what the assistant sees", "WP-05"],
  ["DOOR log-row Explain sends through openAssistant", "WP-07"],
  ["EVID query block runs inline and opens in Logs", "WP-08"],
  ["DOCK alert editor docks the chat with Insert as diff", "WP-09"],
  ["APPR approval card from the confirmation scenario", "WP-10"],
  ["CONS consent as a turn state (CONS-*) @edition", "WP-10"],
  ["HIST history list, thread header and local-only mode", "WP-11"],
  ["SHARE one-click snapshot and the shared page", "WP-12"],
  ["RCA incident analysis card before ?stream=true", "WP-13"],
  ["HELPER inline query helper proposes a diff", "WP-13"],
  ["ADMIN-14 Settings › Assistant status @edition", "WP-14"],
  ["XTAB two-tab scenarios 3b and 3e", "WP-09"],
  ["TEL-01 complete run records the ai_turn_* sequence", "WP-06"],
];

test.describe("assistant states not reachable yet", () => {
  for (const [state, wp] of GAPS) {
    test.fixme(`${state} (${wp})`, async () => {});
  }
});
