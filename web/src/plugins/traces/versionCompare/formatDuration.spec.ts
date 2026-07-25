import { describe, it, expect } from "vitest";
import { formatDuration } from "./formatDuration";

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
