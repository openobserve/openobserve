// Copyright 2026 OpenObserve Inc.
//
// Tests for `computeInsightsTimeRange` — the helper that resolves the
// LLM Insights tab's time window from `searchObj.data.datetime`.
// Pure function, getConsumableRelativeTime is injected so we can drive
// every branch without a real Date.now() dependency.

import { describe, it, expect, vi } from "vitest";
import {
  computeInsightsTimeRange,
  EMPTY_INSIGHTS_TIME_RANGE,
} from "./tracesIndex.utils";

// ===========================================================================
// Null / empty input
// ===========================================================================

describe("computeInsightsTimeRange — null / undefined input", () => {
  // The dashboard reads {0,0} as "no usable window" and renders the
  // skeleton — so this branch must produce that fallback safely.
  it("returns {0,0} when dt is null", () => {
    const result = computeInsightsTimeRange(null, () => null);
    expect(result).toEqual(EMPTY_INSIGHTS_TIME_RANGE);
  });

  it("returns {0,0} when dt is undefined", () => {
    expect(computeInsightsTimeRange(undefined, () => null)).toEqual(
      EMPTY_INSIGHTS_TIME_RANGE,
    );
  });

  // The function returns a fresh object each time so callers can safely
  // mutate the returned ref's value (no shared reference to the const).
  it("returns a fresh object (not a reference to the constant)", () => {
    const a = computeInsightsTimeRange(null, () => null);
    const b = computeInsightsTimeRange(null, () => null);
    expect(a).toEqual(b);
    expect(a).not.toBe(EMPTY_INSIGHTS_TIME_RANGE);
    expect(a).not.toBe(b);
  });
});

// ===========================================================================
// Relative ranges
// ===========================================================================

describe("computeInsightsTimeRange — relative", () => {
  // The injected getConsumableRelativeTime is called with the period
  // string and its result is propagated through.
  it("delegates to getConsumableRelativeTime when period is set", () => {
    const spy = vi.fn(() => ({ startTime: 1_000_000, endTime: 2_000_000 }));
    const result = computeInsightsTimeRange(
      { type: "relative", relativeTimePeriod: "12h" },
      spy,
    );
    expect(spy).toHaveBeenCalledWith("12h");
    expect(result).toEqual({ startTime: 1_000_000, endTime: 2_000_000 });
  });

  // Falsy period (null / "") → {0,0} without invoking the resolver.
  it("returns {0,0} when relativeTimePeriod is missing", () => {
    const spy = vi.fn();
    const r1 = computeInsightsTimeRange({ type: "relative" }, spy);
    const r2 = computeInsightsTimeRange(
      { type: "relative", relativeTimePeriod: null },
      spy,
    );
    const r3 = computeInsightsTimeRange(
      { type: "relative", relativeTimePeriod: "" },
      spy,
    );
    expect(r1).toEqual(EMPTY_INSIGHTS_TIME_RANGE);
    expect(r2).toEqual(EMPTY_INSIGHTS_TIME_RANGE);
    expect(r3).toEqual(EMPTY_INSIGHTS_TIME_RANGE);
    expect(spy).not.toHaveBeenCalled();
  });

  // Resolver returns null/undefined (period was unrecognized) → {0,0}.
  it("returns {0,0} when getConsumableRelativeTime yields null", () => {
    const result = computeInsightsTimeRange(
      { type: "relative", relativeTimePeriod: "weird" },
      () => null,
    );
    expect(result).toEqual(EMPTY_INSIGHTS_TIME_RANGE);
  });

  it("returns {0,0} when getConsumableRelativeTime yields undefined", () => {
    const result = computeInsightsTimeRange(
      { type: "relative", relativeTimePeriod: "weird" },
      () => undefined,
    );
    expect(result).toEqual(EMPTY_INSIGHTS_TIME_RANGE);
  });
});

// ===========================================================================
// Absolute ranges
// ===========================================================================

describe("computeInsightsTimeRange — absolute", () => {
  // Numeric timestamps pass through unchanged (already in microseconds).
  it("uses numeric startTime / endTime as-is", () => {
    const result = computeInsightsTimeRange(
      { type: "absolute", startTime: 100, endTime: 200 },
      () => null,
    );
    expect(result).toEqual({ startTime: 100, endTime: 200 });
  });

  // String timestamps are parsed via Date and scaled to microseconds.
  it("converts ISO-string timestamps to microseconds", () => {
    const result = computeInsightsTimeRange(
      {
        type: "absolute",
        startTime: "2026-05-08T00:00:00Z",
        endTime: "2026-05-08T01:00:00Z",
      },
      () => null,
    );
    // 1 hour difference, in microseconds = 3,600,000,000
    expect(result.endTime - result.startTime).toBe(3_600_000_000);
  });

  // Mixed (one number, one string) → still works.
  it("handles mixed numeric + string timestamps", () => {
    const result = computeInsightsTimeRange(
      { type: "absolute", startTime: 1_700_000_000_000, endTime: "2026-05-08T01:00:00Z" },
      () => null,
    );
    expect(typeof result.startTime).toBe("number");
    expect(typeof result.endTime).toBe("number");
  });

  // Type unspecified → falls through to absolute branch (defensive).
  it("treats missing dt.type as absolute", () => {
    const result = computeInsightsTimeRange(
      { startTime: 100, endTime: 200 },
      () => null,
    );
    expect(result).toEqual({ startTime: 100, endTime: 200 });
  });

  // Invalid date strings → NaN (the function doesn't sanitize). Caller
  // should validate. Documenting the behaviour here so a future change
  // that adds NaN-guarding is intentional, not accidental.
  it("yields NaN start/end for unparseable date strings", () => {
    const result = computeInsightsTimeRange(
      { type: "absolute", startTime: "not a date", endTime: "also not" },
      () => null,
    );
    expect(Number.isNaN(result.startTime)).toBe(true);
    expect(Number.isNaN(result.endTime)).toBe(true);
  });
});

// ===========================================================================
// Boundary: relative resolver returns 0/0 explicitly
// ===========================================================================

describe("computeInsightsTimeRange — resolver returning {0,0}", () => {
  // Some resolvers return {0,0} for a known-bad period instead of null.
  // The function should pass that through (not falsy-coerce).
  it("passes through resolver's {0,0} result", () => {
    const result = computeInsightsTimeRange(
      { type: "relative", relativeTimePeriod: "0s" },
      () => ({ startTime: 0, endTime: 0 }),
    );
    expect(result).toEqual({ startTime: 0, endTime: 0 });
  });
});
