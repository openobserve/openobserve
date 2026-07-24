// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { parseSamplingRate, samplingRateForForm, samplingRatePercent } from "./jobSampling";

describe("job sampling", () => {
  it("formats scalar and legacy object rates for editing", () => {
    expect(samplingRateForForm(0.1)).toBe("0.1");
    expect(samplingRateForForm({ rate: 0.25 })).toBe("0.25");
    expect(samplingRateForForm(null)).toBe("");
    expect(samplingRateForForm({ count: 10 })).toBe("");
  });

  it("accepts inclusive sampling-rate boundaries", () => {
    expect(parseSamplingRate("0", "Sampling rate")).toBe(0);
    expect(parseSamplingRate("0.1", "Sampling rate")).toBe(0.1);
    expect(parseSamplingRate(1, "Sampling rate")).toBe(1);
  });

  it("converts a usable rate to a display percentage", () => {
    expect(samplingRatePercent("0.1")).toBe(10);
    expect(samplingRatePercent(0.25)).toBe(25);
    expect(samplingRatePercent("1")).toBe(100);
  });

  it("rounds to one decimal and absorbs float artifacts", () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE-754.
    expect(samplingRatePercent("0.29")).toBe(29);
    expect(samplingRatePercent(1 / 3)).toBe(33.3);
  });

  it.each(["", "   ", "0", "-0.1", "1.01", "abc"])("has no percentage preview for %s", (value) => {
    expect(samplingRatePercent(value)).toBeNull();
  });

  it.each(["", "-0.1", "1.01", "true", "null", '{"rate":0.1}'])(
    "rejects invalid rate %s",
    (value) => {
      expect(() => parseSamplingRate(value, "Sampling rate")).toThrow(
        "Sampling rate must be a number between 0 and 1",
      );
    },
  );
});
