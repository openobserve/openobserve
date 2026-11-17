// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";

import alertsService from "@/services/alerts";
import { countsByAlert, parseSummaryRows, useAlertHistorySummary } from "./useAlertHistorySummary";

vi.mock("@/services/alerts", () => ({ default: { getHistorySummary: vi.fn() } }));

const getHistorySummary = alertsService.getHistorySummary as unknown as ReturnType<typeof vi.fn>;

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

describe("useAlertHistorySummary", () => {
  it("reads a 403 as a missing grant, not as the raw status text", async () => {
    const refusal = {
      response: { status: 403, data: "Unauthorized Access" },
      message: "Request failed with status code 403",
    };
    getHistorySummary.mockRejectedValue(refusal);
    const summary = useAlertHistorySummary();
    await summary.load("acme", 0, 1);
    expect(summary.forbidden.value).toBe(true);
    expect(summary.error.value).toBe("");
    expect(summary.failure.value).toBe(refusal);
  });

  it("keeps a server error as the message", async () => {
    getHistorySummary.mockRejectedValue({ response: { status: 500, data: { message: "boom" } } });
    const summary = useAlertHistorySummary();
    await summary.load("acme", 0, 1);
    expect(summary.forbidden.value).toBe(false);
    expect(summary.error.value).toBe("boom");
  });
});
