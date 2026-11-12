// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { widerPeriodFor } from "./streams";

const NOW = 1_800_000_000_000_000;
const MIN = 60_000_000;

describe("widerPeriodFor", () => {
  const fifteenMinutesAgo = NOW - 15 * MIN;

  it("offers nothing when the last event is inside the window or unknown", () => {
    expect(widerPeriodFor(NOW - MIN, fifteenMinutesAgo, NOW)).toBeNull();
    expect(widerPeriodFor(0, fifteenMinutesAgo, NOW)).toBeNull();
    expect(widerPeriodFor(null, fifteenMinutesAgo, NOW)).toBeNull();
  });

  it("offers the smallest window that reaches the last event", () => {
    expect(widerPeriodFor(NOW - 40 * MIN, fifteenMinutesAgo, NOW)).toBe("1h");
    expect(widerPeriodFor(NOW - 3 * 60 * MIN, fifteenMinutesAgo, NOW)).toBe("24h");
    expect(widerPeriodFor(NOW - 3 * 1440 * MIN, fifteenMinutesAgo, NOW)).toBe("7d");
    expect(widerPeriodFor(NOW - 20 * 1440 * MIN, fifteenMinutesAgo, NOW)).toBe("30d");
    expect(widerPeriodFor(NOW - 90 * 1440 * MIN, fifteenMinutesAgo, NOW)).toBeNull();
  });
});
