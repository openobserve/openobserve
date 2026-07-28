// stats.bootstrap.spec.ts
import { describe, it, expect } from "vitest";
import { percentile, mean, bootstrapDiffCI } from "./stats";

describe("percentile", () => {
  it("computes p50/p95 with linear interpolation", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(xs, 0.5)).toBeCloseTo(50.5, 1);
    expect(percentile(xs, 0.95)).toBeGreaterThan(94);
  });
});

describe("bootstrapDiffCI (seeded → deterministic)", () => {
  const rngNormalish = (base: number, n: number, seed: number) => {
    // cheap deterministic pseudo-samples around `base`
    let s = seed;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      out.push(base + (s % 1000) / 100);
    }
    return out;
  };
  it("CI excludes zero for a clearly higher A distribution", () => {
    const A = rngNormalish(200, 500, 1);
    const B = rngNormalish(100, 500, 2);
    const ci = bootstrapDiffCI(A, B, (xs) => percentile(xs, 0.95), 2000, 0.9, 42);
    expect(ci.delta).toBeGreaterThan(0);
    expect(ci.straddlesZero).toBe(false);
  });
  it("CI straddles zero for two identical-center distributions", () => {
    const A = rngNormalish(100, 400, 3);
    const B = rngNormalish(100, 400, 4);
    const ci = bootstrapDiffCI(A, B, mean, 2000, 0.9, 7);
    expect(ci.straddlesZero).toBe(true);
  });
  it("is deterministic under a fixed seed", () => {
    const A = rngNormalish(150, 300, 5),
      B = rngNormalish(120, 300, 6);
    const c1 = bootstrapDiffCI(A, B, mean, 1000, 0.9, 99);
    const c2 = bootstrapDiffCI(A, B, mean, 1000, 0.9, 99);
    expect(c1).toEqual(c2);
  });
});
