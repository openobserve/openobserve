import { describe, it, expect } from "vitest";
import { formatDuration, formatMicros } from "./formatDuration";

describe("formatDuration", () => {
  it("renders sub-minute as rounded seconds (the 0.00994h bug → '36s')", () => {
    expect(formatDuration(0.009945833)).toBe("36s");
  });
  it("renders 0 as '0s'", () => {
    expect(formatDuration(0)).toBe("0s");
  });
  it("renders sub-hour as minutes", () => {
    expect(formatDuration(0.5)).toBe("30m");
    expect(formatDuration(0.75)).toBe("45m");
  });
  it("renders single-digit hours with one decimal", () => {
    expect(formatDuration(6)).toBe("6.0h");
    expect(formatDuration(2.5)).toBe("2.5h");
  });
  it("renders double-digit hours rounded (under 48h)", () => {
    expect(formatDuration(36)).toBe("36h");
  });
  it("renders >=48h as days", () => {
    expect(formatDuration(72)).toBe("3d");
    expect(formatDuration(168)).toBe("7d");
  });
  it("never emits a raw unrounded float", () => {
    expect(formatDuration(0.009945833333333333)).not.toContain("0.00994");
  });
  it("clamps negatives to 0s", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("formatMicros", () => {
  it("humanizes the p95 bug value (263772189µs → '4m 24s'), not raw ms", () => {
    expect(formatMicros(263772189)).toBe("4m 24s");
    expect(formatMicros(263772189)).not.toContain("263772189");
  });
  it("renders sub-millisecond as µs", () => {
    expect(formatMicros(0)).toBe("0µs");
    expect(formatMicros(1)).toBe("1µs");
    expect(formatMicros(999)).toBe("999µs");
  });
  it("renders sub-second as ms (one decimal under 10ms)", () => {
    expect(formatMicros(1000)).toBe("1.0ms");
    expect(formatMicros(45000)).toBe("45ms");
    expect(formatMicros(999_000)).toBe("999ms");
  });
  it("renders sub-minute as seconds (2 decimals under 10s, 1 above)", () => {
    expect(formatMicros(6_140_833)).toBe("6.14s"); // p50 arm
    expect(formatMicros(1_500_000)).toBe("1.50s");
    expect(formatMicros(59_400_000)).toBe("59.4s");
  });
  it("renders >=60s as minutes + seconds", () => {
    expect(formatMicros(65_000_000)).toBe("1m 5s");
    expect(formatMicros(120_000_000)).toBe("2m");
  });
  it("clamps negatives to 0µs", () => {
    expect(formatMicros(-10)).toBe("0µs");
  });
});
