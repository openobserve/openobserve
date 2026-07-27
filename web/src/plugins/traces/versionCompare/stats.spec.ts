// stats.spec.ts (Newcombe + classifier portion)
import { describe, it, expect } from "vitest";
import { proportionDiffCI, classifyVerdict } from "./stats";

describe("proportionDiffCI (Newcombe)", () => {
  it("excludes zero for a clear error-rate difference", () => {
    // A: 200/1000 = 20% errors; B: 50/1000 = 5%. Clear worse.
    const ci = proportionDiffCI(200, 1000, 50, 1000);
    expect(ci.delta).toBeCloseTo(0.15, 5);
    expect(ci.lower).toBeGreaterThan(0);      // entire CI above zero
    expect(ci.straddlesZero).toBe(false);
  });
  it("straddles zero for a tiny difference on small n", () => {
    const ci = proportionDiffCI(11, 100, 9, 100); // 11% vs 9%, n=100
    expect(ci.straddlesZero).toBe(true);
  });
  it("is symmetric-ish: swapping arms negates the delta", () => {
    const ab = proportionDiffCI(200, 1000, 50, 1000);
    const ba = proportionDiffCI(50, 1000, 200, 1000);
    expect(ba.delta).toBeCloseTo(-ab.delta, 5);
  });
});

describe("classifyVerdict", () => {
  // CI delta is oriented A − B. The verdict describes the NEWER version B:
  //   delta > 0 (A > B) → B is LOWER than A → verdict "lower" (better for up-worse).
  //   delta < 0 (A < B) → B is HIGHER than A → verdict "higher" (worse).
  const bLower = { delta: 0.15, lower: 0.11, upper: 0.19, straddlesZero: false }; // A>B
  const bHigher = { delta: -0.15, lower: -0.19, upper: -0.11, straddlesZero: false }; // A<B
  const noisy = { delta: 0.02, lower: -0.03, upper: 0.07, straddlesZero: true };
  it("up-worse metric, A>B (CI entirely positive) → lower (B improved)", () => {
    expect(classifyVerdict(bLower, "up-worse", true)).toBe("lower");
  });
  it("up-worse metric, A<B (CI entirely negative) → higher (B regressed)", () => {
    expect(classifyVerdict(bHigher, "up-worse", true)).toBe("higher");
  });
  it("CI straddles zero → nochange regardless of point estimate", () => {
    expect(classifyVerdict(noisy, "up-worse", true)).toBe("nochange");
  });
  it("insufficient sample → insufficient, even with a clean CI", () => {
    expect(classifyVerdict(bLower, "up-worse", false)).toBe("insufficient");
  });
});
