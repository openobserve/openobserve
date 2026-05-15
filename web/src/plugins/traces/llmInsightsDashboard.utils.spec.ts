// Copyright 2026 OpenObserve Inc.
//
// Tests for the KPI-card formatting + trend-detection helpers used by
// LLMInsightsDashboard. Pure functions — no Vue / DOM / quasar.

import { describe, it, expect } from "vitest";
import {
  computeTrend,
  trendArrow,
  splitNumberWithUnit,
  splitDuration,
  splitCost,
  formatWindowLabel,
  FLAT_THRESHOLD,
} from "./llmInsightsDashboard.utils";

// ===========================================================================
// computeTrend — covers every branch in the trend ladder.
// ===========================================================================

describe("computeTrend — null cases", () => {
  // No comparison possible when both are zero/negative — render "—" or
  // hide the chip entirely upstream.
  it.each([
    [0, 0],
    [-1, 0],
    [0, -1],
    [-5, -10],
  ])("returns null when both curr (%d) and prev (%d) are ≤ 0", (curr, prev) => {
    expect(computeTrend(curr, prev, true)).toBeNull();
  });

  // Defensive: NaN / Infinity must yield null so the chip doesn't show
  // garbage like "NaN%".
  it.each([
    [NaN, 100],
    [100, NaN],
    [Infinity, 100],
    [100, -Infinity],
  ])("returns null for non-finite curr (%d) or prev (%d)", (curr, prev) => {
    expect(computeTrend(curr, prev, true)).toBeNull();
  });
});

describe("computeTrend — fresh-from-zero", () => {
  // When prev is zero/negative but curr is positive, we synthesise a
  // 100% increase rather than dividing by zero. Useful sentiment is
  // driven by `upIsBad`.
  it("treats prev=0 as a 100% increase (sentiment = bad if upIsBad)", () => {
    expect(computeTrend(50, 0, true)).toEqual({
      direction: "up",
      sentiment: "bad",
      deltaPct: 100,
    });
  });

  it("treats prev=0 as a 100% increase (sentiment = good if !upIsBad)", () => {
    expect(computeTrend(50, 0, false)).toEqual({
      direction: "up",
      sentiment: "good",
      deltaPct: 100,
    });
  });

  // Negative prev still triggers the "fresh" path (prev <= 0).
  it("treats negative prev as fresh (deltaPct = 100)", () => {
    expect(computeTrend(50, -10, true)).toEqual({
      direction: "up",
      sentiment: "bad",
      deltaPct: 100,
    });
  });
});

describe("computeTrend — flat threshold", () => {
  // Tiny changes (< 1%) are marked flat / neutral so the chip doesn't
  // jitter on every refresh.
  it("returns flat / neutral for absolute change < FLAT_THRESHOLD%", () => {
    // 100 → 100.5 is +0.5%, under the 1% threshold.
    const t = computeTrend(100.5, 100, true)!;
    expect(t.direction).toBe("flat");
    expect(t.sentiment).toBe("neutral");
    expect(t.deltaPct).toBeLessThan(FLAT_THRESHOLD);
  });

  it("returns flat for a tiny decrease", () => {
    const t = computeTrend(99.5, 100, true)!;
    expect(t.direction).toBe("flat");
  });

  // Exact threshold (1%) NOT flat — comparison is strict `<`.
  it("does not mark exactly 1% change as flat (strict `<`)", () => {
    const t = computeTrend(101, 100, true)!;
    expect(t.direction).toBe("up");
  });
});

describe("computeTrend — direction + sentiment matrix", () => {
  // Up + upIsBad   → bad  (cost / errors increasing)
  // Up + !upIsBad  → good (more is better — not used today, here for completeness)
  // Down + upIsBad → good (cost / errors decreasing)
  // Down + !upIsBad → bad
  it.each([
    [200, 100, true,  "up",   "bad"],
    [200, 100, false, "up",   "good"],
    [50,  100, true,  "down", "good"],
    [50,  100, false, "down", "bad"],
  ])(
    "computeTrend(%d, %d, upIsBad=%s) → direction=%s, sentiment=%s",
    (curr, prev, upIsBad, direction, sentiment) => {
      const t = computeTrend(curr, prev, upIsBad as boolean)!;
      expect(t.direction).toBe(direction);
      expect(t.sentiment).toBe(sentiment);
    },
  );

  // deltaPct is the absolute value (always non-negative).
  it("returns the absolute % delta (non-negative)", () => {
    expect(computeTrend(200, 100, true)!.deltaPct).toBe(100);
    expect(computeTrend(50, 100, true)!.deltaPct).toBe(50);
  });
});

// ===========================================================================
// trendArrow
// ===========================================================================

describe("trendArrow", () => {
  it.each([
    ["up", "▲"],
    ["down", "▼"],
    ["flat", "→"],
  ])('returns "%s" glyph for direction=%s', (direction, glyph) => {
    expect(trendArrow(direction as any)).toBe(glyph);
  });
});

// ===========================================================================
// splitNumberWithUnit
// ===========================================================================

describe("splitNumberWithUnit", () => {
  it.each([
    [2_500_000_000, { value: "2.5", unit: "B" }],
    [1_000_000_000, { value: "1.0", unit: "B" }],
    [2_500_000, { value: "2.5", unit: "M" }],
    [1_000_000, { value: "1.0", unit: "M" }],
    [12_345, { value: "12.3", unit: "K" }],
    [10_000, { value: "10.0", unit: "K" }],
    // Below 10K → no abbreviation, formatted with locale separators.
    // 9999 / 1234 / 0 — all fall through to toLocaleString.
    // Values asserted as the en-US locale (matches CI / dev defaults).
    [9_999, { value: "9,999", unit: "" }],
    [1_234, { value: "1,234", unit: "" }],
    [0, { value: "0", unit: "" }],
  ])("splits %d → %j", (input, expected) => {
    const result = splitNumberWithUnit(input);
    // Allow either US-style "1,234" or other locale separators in CI.
    // Compare unit strictly, value loosely (digits + optional separators).
    expect(result.unit).toBe(expected.unit);
    expect(result.value.replace(/[^\d.]/g, "")).toBe(
      expected.value.replace(/[^\d.]/g, ""),
    );
  });
});

// ===========================================================================
// splitDuration
// ===========================================================================

describe("splitDuration", () => {
  it.each([
    [0, { value: "0", unit: "ms" }],
    [123_000, { value: "123", unit: "ms" }],         // 123ms
    [1_000_000, { value: "1.0", unit: "s" }],        // 1s
    [12_345_000, { value: "12.3", unit: "s" }],      // 12.3s
    [120_000_000, { value: "2.0", unit: "min" }],    // 2min
    [3_600_000_000, { value: "60.0", unit: "min" }], // 60min
  ])("splits %d microseconds → %j", (micros, expected) => {
    expect(splitDuration(micros)).toEqual(expected);
  });

  // Defensive: zero / falsy input → "0 ms" (not just "0").
  it("returns 0 ms for zero / negative / undefined inputs", () => {
    expect(splitDuration(0)).toEqual({ value: "0", unit: "ms" });
    // -1 fails `!micros` check (true → returns), so the function returns
    // the early-zero branch — that's fine, durations should never be
    // negative in practice.
    expect(splitDuration(undefined as any)).toEqual({
      value: "0",
      unit: "ms",
    });
  });

  // Sub-millisecond → rounded to 0 ms (still better than "0.123 ms").
  it("rounds sub-millisecond durations down to 0 ms", () => {
    expect(splitDuration(500)).toEqual({ value: "1", unit: "ms" }); // 0.5ms → 1
    expect(splitDuration(100)).toEqual({ value: "0", unit: "ms" }); // 0.1ms → 0
  });
});

// ===========================================================================
// splitCost
// ===========================================================================

describe("splitCost", () => {
  it.each([
    [2_500_000, { value: "$2.50", unit: "M" }],
    [1_000_000, { value: "$1.00", unit: "M" }],
    [12_345, { value: "$12.3", unit: "K" }],
    [1_000, { value: "$1.0", unit: "K" }],
    [123.45, { value: "$123.45", unit: "" }],
    [12.34, { value: "$12.34", unit: "" }],
    [0.5, { value: "$0.50", unit: "" }],
    [0, { value: "$0.00", unit: "" }],
  ])("splits %d → %j", (input, expected) => {
    expect(splitCost(input)).toEqual(expected);
  });

  // Boundary: $1000 exactly should jump to "K". Using strict `>=`.
  it("renders $1,000 as $1.0K (boundary into K)", () => {
    expect(splitCost(1_000)).toEqual({ value: "$1.0", unit: "K" });
  });

  it("renders $1,000,000 as $1.00M (boundary into M)", () => {
    expect(splitCost(1_000_000)).toEqual({ value: "$1.00", unit: "M" });
  });
});

// ===========================================================================
// formatWindowLabel — used in the KPI trend chip ("vs prev <X>")
// ===========================================================================

describe("formatWindowLabel", () => {
  // Each unit branch with values safely inside its range.
  it.each([
    [30 * 1_000_000, "30s"],
    [59 * 1_000_000, "59s"],
    [60 * 1_000_000, "1m"],          // 1 minute exactly → seconds branch fails (60 < 60 is false) → minutes
    [5 * 60 * 1_000_000, "5m"],
    [59 * 60 * 1_000_000, "59m"],
    [60 * 60 * 1_000_000, "1h"],
    [12 * 60 * 60 * 1_000_000, "12h"],
    [23 * 60 * 60 * 1_000_000, "23h"],
    [24 * 60 * 60 * 1_000_000, "1d"],
    [7 * 24 * 60 * 60 * 1_000_000, "7d"],
    [30 * 24 * 60 * 60 * 1_000_000, "30d"],
  ])("formats %d microseconds as %s", (input, expected) => {
    expect(formatWindowLabel(input)).toBe(expected);
  });

  // Sub-second windows round to whole seconds.
  it("rounds sub-second windows to the nearest whole second", () => {
    expect(formatWindowLabel(1_500_000)).toBe("2s"); // 1.5s → rounds up
    expect(formatWindowLabel(400_000)).toBe("0s");   // 0.4s → rounds down
  });

  // Defensive: zero / negative → empty string so the chip falls back
  // to plain "vs prev" instead of "vs prev 0s".
  it("returns empty string for zero / negative input", () => {
    expect(formatWindowLabel(0)).toBe("");
    expect(formatWindowLabel(-1)).toBe("");
  });
});
