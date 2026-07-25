// windows.spec.ts
import { describe, it, expect } from "vitest";
import { resolveCompareWindows } from "./windows";

const H = 3_600_000_000; // 1 hour in microseconds

describe("resolveCompareWindows — sinceRollout (disjoint)", () => {
  it("equal-duration windows anchored at A.firstSeen and B.lastSeen; disjoint overlap", () => {
    // A: live 48h ending now (durA=48h). B: ran 100h, ended before A started (durB=100h).
    // A is the SHORTER arm → Δ=48h, limitedBy="a". A uses its full 48h; B is truncated to its last 48h.
    const now = 1000 * H;
    const a = { firstSeen: now - 48 * H, lastSeen: now };
    const b = { firstSeen: now - 200 * H, lastSeen: now - 100 * H };
    const w = resolveCompareWindows(a, b, now);
    expect(w.mode).toBe("sinceRollout");
    expect(w.overlap).toBe("disjoint");
    expect(w.deltaMicros).toBe(48 * H);                              // Δ = min(48h, 100h) = 48h
    expect(w.a).toEqual({ start: now - 48 * H, end: now });          // A's first Δ (== all of A)
    expect(w.b).toEqual({ start: (now - 100 * H) - 48 * H, end: now - 100 * H }); // B's last Δ
    expect(w.limitedBy).toBe("a");                                   // A (48h) is the shorter arm
  });

  it("FAIRNESS CLAMP: when B's lifetime (6h) < A's window (48h), both windows are 6h", () => {
    const now = 1000 * H;
    const a = { firstSeen: now - 48 * H, lastSeen: now };            // durA = 48h
    const b = { firstSeen: now - 106 * H, lastSeen: now - 100 * H }; // durB = 6h (the limiter)
    const w = resolveCompareWindows(a, b, now);
    expect(w.deltaMicros).toBe(6 * H);
    expect(w.a).toEqual({ start: now - 48 * H, end: now - 48 * H + 6 * H }); // A's FIRST 6h
    expect(w.b).toEqual({ start: now - 106 * H, end: now - 100 * H });        // B's last 6h == all of B
    expect(w.limitedBy).toBe("b");   // B (6h) is the shorter/limiting arm
  });
});

describe("resolveCompareWindows — overlap three-state", () => {
  it("concurrent (overlapFraction >= 0.5) → sameWallClock auto", () => {
    const now = 1000 * H;
    const a = { firstSeen: now - 10 * H, lastSeen: now };
    const b = { firstSeen: now - 12 * H, lastSeen: now - 1 * H }; // heavy overlap
    const w = resolveCompareWindows(a, b, now);
    expect(w.mode).toBe("sameWallClock");
    expect(w.overlap).toBe("concurrent");
    expect(w.overlapFraction).toBeGreaterThanOrEqual(0.5);
  });

  it("partial (0 < frac < 0.5) → sinceRollout but overlap='partial'", () => {
    const now = 1000 * H;
    const a = { firstSeen: now - 10 * H, lastSeen: now };
    const b = { firstSeen: now - 100 * H, lastSeen: now - 9 * H }; // 1h overlap of min(10h,91h)
    const w = resolveCompareWindows(a, b, now);
    expect(w.mode).toBe("sinceRollout");
    expect(w.overlap).toBe("partial");
    expect(w.overlapFraction).toBeGreaterThan(0);
    expect(w.overlapFraction).toBeLessThan(0.5);
  });
});

describe("resolveCompareWindows — manual passthrough", () => {
  it("manual mode leaves caller windows to override (returns natural, mode manual)", () => {
    const now = 1000 * H;
    const a = { firstSeen: now - 5 * H, lastSeen: now };
    const b = { firstSeen: now - 20 * H, lastSeen: now - 10 * H };
    const w = resolveCompareWindows(a, b, now, "manual");
    expect(w.mode).toBe("manual");
  });
});
