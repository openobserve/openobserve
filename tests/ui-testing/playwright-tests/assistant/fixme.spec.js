// Copyright 2026 OpenObserve Inc.
// Every state the harness cannot reach yet is a visible gap, named with the capability it waits for.

import { test } from "@playwright/test";

const GAPS = [
  [
    "XTAB-10 a hidden tail holder hands the tail to the visible tab",
    "the client does not resume a dropped stream from the server's turn tail yet",
  ],
];

test.describe("assistant states not reachable yet", () => {
  for (const [state, blocker] of GAPS) {
    test.fixme(`${state} (blocked: ${blocker})`, async () => {});
  }
});
