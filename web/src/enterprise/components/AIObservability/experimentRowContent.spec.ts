// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { durationLabel, durationUnit, formatDuration } from "./experimentRowContent";

// A latency reads as a magnitude, not a digit count: "10449.4821" costs the
// reader the scale and overflows the tile it sits in.
describe("durationUnit", () => {
  it("switches to seconds at exactly one second", () => {
    expect(durationUnit(999)).toBe("ms");
    expect(durationUnit(1000)).toBe("s");
  });

  // Two scales inside one comparison make the smaller number look bigger.
  it("picks one unit for a whole set, from the largest member", () => {
    expect(durationUnit(800, 1200)).toBe("s");
    expect(durationUnit(800, 900)).toBe("ms");
  });

  it("ignores absent values rather than treating them as zero-length input", () => {
    expect(durationUnit(null, undefined, 2000)).toBe("s");
    expect(durationUnit(null, undefined)).toBe("ms");
  });

  it("measures magnitude, so a negative delta scales like its positive twin", () => {
    expect(durationUnit(-1500)).toBe("s");
  });
});

describe("formatDuration", () => {
  it("rounds to whole milliseconds and groups thousands", () => {
    expect(formatDuration(10449.4821, "ms")).toBe("10,449");
  });

  // Two decimals below ten seconds, one above: the digits that carry meaning.
  it("keeps seconds to the precision that still says something", () => {
    expect(formatDuration(1240, "s")).toBe("1.24");
    expect(formatDuration(10449.4821, "s")).toBe("10.4");
  });

  it("renders a sub-millisecond value as a number, not empty", () => {
    expect(formatDuration(0.4, "ms")).toBe("0");
  });
});

describe("durationLabel", () => {
  it("spells the unit out for a value that has no sibling to share one with", () => {
    expect(durationLabel(840)).toBe("840 ms");
    expect(durationLabel(10449)).toBe("10.4 s");
  });

  it("renders an absent latency as a dash rather than 'null ms'", () => {
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel(undefined)).toBe("—");
  });

  it("keeps a real zero, which is a measurement rather than a gap", () => {
    expect(durationLabel(0)).toBe("0 ms");
  });
});
