import { describe, expect, it } from "vitest";
import { periodMs, useSecurityRange } from "./useSecurityRange";

describe("useSecurityRange", () => {
  it("reads a relative period and falls back to 24h", () => {
    expect(useSecurityRange({ period: "6h" }).windowMs.value).toBe(6 * 3_600_000);
    expect(useSecurityRange({ period: "bogus" }).period.value).toBe("24h");
  });

  it("converts every picker unit", () => {
    expect(periodMs("15m")).toBe(900_000);
    expect(periodMs("2w")).toBe(2 * 604_800_000);
    expect(periodMs("1M")).toBe(2_592_000_000);
    expect(periodMs("today")).toBe(0);
  });

  it("keeps an absolute range from a link and carries it in the link query", () => {
    const r = useSecurityRange({ from: "1000000000", to: "2000000000" });
    expect(r.absolute.value).toEqual({ startMs: 1_000_000, endMs: 2_000_000 });
    expect(r.linkQuery.value).toEqual({ from: "1000000000", to: "2000000000" });
  });

  it("applies a picker change and ignores a replay", () => {
    const r = useSecurityRange({});
    expect(
      r.apply({ startTime: 0, endTime: 1, relativeTimePeriod: "1h", userChangedValue: false }),
    ).toBe(false);
    expect(
      r.apply({ startTime: 0, endTime: 1, relativeTimePeriod: "1h", userChangedValue: true }),
    ).toBe(true);
    expect(r.linkQuery.value).toEqual({ period: "1h" });
    r.apply({
      startTime: 5_000_000,
      endTime: 9_000_000,
      relativeTimePeriod: null,
      userChangedValue: true,
    });
    expect(r.windowMs.value).toBe(4000);
  });
});
