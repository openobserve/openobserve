// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { countsByAlert, parseSummaryRows } from "./useAlertHistorySummary";

describe("parseSummaryRows", () => {
  it("converts microsecond buckets to ms and drops unusable rows", () => {
    const rows = parseSummaryRows([
      { bucket: 3_600_000_000, alert_id: "a", outcome: "firing", n: 2, silenced: 0 },
      { bucket: "x", alert_id: "b", outcome: "firing", n: 1, silenced: 0 },
    ]);
    expect(rows).toEqual([
      { bucketMs: 3_600_000, alertId: "a", outcome: "firing", n: 2, silenced: 0 },
    ]);
  });

  it("returns nothing for a non-array payload", () => {
    expect(parseSummaryRows(undefined)).toEqual([]);
  });
});

describe("countsByAlert", () => {
  it("splits firings, errors and evaluations per alert", () => {
    const counts = countsByAlert([
      { bucketMs: 0, alertId: "a", outcome: "firing", n: 2, silenced: 0 },
      { bucketMs: 60_000, alertId: "a", outcome: "notify_failed", n: 1, silenced: 0 },
      { bucketMs: 0, alertId: "a", outcome: "normal", n: 5, silenced: 0 },
      { bucketMs: 0, alertId: "b", outcome: "error", n: 3, silenced: 0 },
    ]);
    expect(counts.get("a")).toEqual({
      firings: 3,
      errors: 0,
      evaluations: 8,
      lastFiringMs: 60_000,
    });
    expect(counts.get("b")).toEqual({ firings: 0, errors: 3, evaluations: 3, lastFiringMs: null });
  });
});
