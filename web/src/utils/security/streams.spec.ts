// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { sourceHealth, widerPeriodFor } from "./streams";

const NOW = 1_800_000_000_000_000;
const MIN = 60_000_000;

describe("sourceHealth", () => {
  it("separates live, quiet and never-reported sources", () => {
    expect(sourceHealth({ doc_num: 3, doc_time_max: NOW - MIN }, NOW)).toBe("live");
    expect(sourceHealth({ doc_num: 3, doc_time_max: NOW - 25 * 60 * MIN }, NOW)).toBe("quiet");
    expect(sourceHealth({ doc_num: 0, doc_time_max: 0 }, NOW)).toBe("never");
    expect(sourceHealth(null, NOW)).toBe("never");
  });
});

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
