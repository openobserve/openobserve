// Copyright 2026 OpenObserve Inc.
// HT-12 AC 8: every state the harness cannot reach yet is a visible gap, named with the WP that closes it.

import { test } from "@playwright/test";

const GAPS = [
  ["SMOKE-02 v2 happy path from the header to done", "WP-06"],
  ["SH-01 sidebar shell renders the active session (assistant-shell-sidebar)", "WP-04"],
  ["GATE-01 OSS build shows the locked header and no doors @edition", "WP-04"],
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
