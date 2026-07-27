// compareResult.spec.ts
import { describe, it, expect } from "vitest";
import {
  buildCompareResult,
  buildCompareResultFromEndpoint,
  endpointHasSufficientLatencyAndCost,
} from "./compareResult";
import type { MetricDelta } from "@/services/gen-ai-agent-mapping.service";

const kpi = (traceCount: number, errorCount: number, totalCost: number) => ({
  requestCount: traceCount,
  traceCount,
  errorCount,
  totalTokens: traceCount * 100,
  totalCost,
  p95DurationMicros: 0,
});
const disjointWin = {
  mode: "sinceRollout" as const,
  a: { start: 0, end: 1 },
  b: { start: 2, end: 3 },
  deltaMicros: 1,
  limitedBy: null,
  overlap: "disjoint" as const,
  overlapFraction: 0,
};

describe("buildCompareResult", () => {
  it("suppresses CI-backed verdicts when either arm < MIN_SAMPLE", () => {
    const r = buildCompareResult(
      kpi(42, 5, 1),
      kpi(88, 3, 1),
      { durations: [1, 2, 3], costs: [1] },
      { durations: [1], costs: [1] },
      disjointWin,
      1,
    );
    expect(r.enoughSample).toBe(false);
    // Every CI-backed flagged metric drops to "insufficient". p99 is directional-
    // only (no CI, verdict always "nochange"), so it's exempt from this rule.
    expect(
      r.metrics.every((m) => !m.flagged || m.key === "p99" || m.verdict === "insufficient"),
    ).toBe(true);
  });
  // 500-sample arrays through three real 10k-iter bootstraps (p50/p95/cost) is
  // genuinely heavy — a few seconds on slow CI — so give this case extra
  // headroom over the 5s default rather than weaken its coverage.
  it("flags {errorRate,p50,p95,p99,cost} (all colored by direction); volume stays neutral", () => {
    const durs = Array.from({ length: 500 }, (_, i) => 100 + i);
    const r = buildCompareResult(
      kpi(500, 100, 50),
      kpi(500, 20, 30),
      { durations: durs, costs: durs },
      { durations: durs.map((d) => d / 2), costs: durs.map((d) => d / 2) },
      disjointWin,
      9,
    );
    const flagged = r.metrics
      .filter((m) => m.flagged)
      .map((m) => m.key)
      .sort();
    expect(flagged).toEqual(["cost", "errorRate", "p50", "p95", "p99"]);
    // p99 is directional-only — flagged, but no CI.
    expect(r.metrics.find((m) => m.key === "p99")!.ci).toBeNull();
    expect(r.metrics.find((m) => m.key === "volume")!.flagged).toBe(false);
  }, 20000);
  it("marks results associative in sinceRollout mode", () => {
    const durs = Array.from({ length: 200 }, (_, i) => i + 1);
    const r = buildCompareResult(
      kpi(200, 10, 5),
      kpi(200, 8, 5),
      { durations: durs, costs: durs },
      { durations: durs, costs: durs },
      disjointWin,
      3,
    );
    expect(r.metrics.every((m) => m.associative)).toBe(true);
  });
  it("empty raw-sample with traceCount>=MIN_SAMPLE yields insufficient p50/p95/cost, not a confident nochange", () => {
    const r = buildCompareResult(
      kpi(500, 10, 50),
      kpi(500, 8, 45),
      { durations: [], costs: [] },
      { durations: [], costs: [] },
      disjointWin,
      5,
    );
    expect(r.enoughSample).toBe(true);
    for (const key of ["p50", "p95", "cost"] as const) {
      const m = r.metrics.find((x) => x.key === key)!;
      expect(m.verdict).toBe("insufficient");
      expect(m.ci).toBeNull();
    }
    // errorRate rides KPI aggregates (not raw samples) — unaffected by empty samples.
    const errRate = r.metrics.find((m) => m.key === "errorRate")!;
    expect(errRate.verdict).not.toBe("insufficient");
    expect(errRate.ci).not.toBeNull();
  });
});

function md(overrides: Partial<MetricDelta> = {}): MetricDelta {
  return {
    a: 100,
    b: 90,
    delta: 10,
    lo: 2,
    hi: 18,
    straddles_zero: false,
    insufficient: false,
    ...overrides,
  };
}

describe("buildCompareResultFromEndpoint", () => {
  it("maps p50/p95/p99/cost a/b/delta/CI from the endpoint MetricDelta shape", () => {
    const endpoint = {
      p50: md({ a: 100, b: 90, delta: 10, lo: 2, hi: 18 }),
      p95: md({ a: 300, b: 250, delta: 50, lo: 10, hi: 90 }),
      p99: md({ a: 500, b: 400, delta: 100, lo: 20, hi: 180 }),
      cost: md({ a: 0.01, b: 0.008, delta: 0.002, lo: 0.0005, hi: 0.0035 }),
    };
    const r = buildCompareResultFromEndpoint(
      kpi(500, 50, 5),
      kpi(500, 10, 4),
      endpoint,
      disjointWin,
    );
    const p50 = r.metrics.find((m) => m.key === "p50")!;
    expect(p50.a).toBe(100);
    expect(p50.b).toBe(90);
    expect(p50.ci).toEqual({ delta: 10, lower: 2, upper: 18, straddlesZero: false });

    const p99 = r.metrics.find((m) => m.key === "p99")!;
    expect(p99.a).toBe(500);
    expect(p99.b).toBe(400);
    // p99 is colored by direction (flagged) but carries NO CI — it's a directional
    // signal only, not a significance-gated verdict.
    expect(p99.ci).toBeNull();
    expect(p99.flagged).toBe(true);
  });

  it("error-rate + volume are computed from KPI, NOT the endpoint (endpoint has no error-rate field)", () => {
    const endpoint = {
      p50: md(),
      p95: md(),
      p99: md(),
      cost: md(),
    };
    const r = buildCompareResultFromEndpoint(
      kpi(500, 100, 5),
      kpi(500, 20, 4),
      endpoint,
      disjointWin,
    );
    const errRate = r.metrics.find((m) => m.key === "errorRate")!;
    expect(errRate.a).toBeCloseTo(0.2); // 100/500
    expect(errRate.b).toBeCloseTo(0.04); // 20/500
  });

  it("straddles_zero:true MetricDelta -> verdict nochange", () => {
    const endpoint = {
      p50: md({ straddles_zero: true, lo: -5, hi: 5, delta: 0 }),
      p95: md(),
      p99: md(),
      cost: md(),
    };
    const r = buildCompareResultFromEndpoint(
      kpi(500, 10, 5),
      kpi(500, 10, 5),
      endpoint,
      disjointWin,
    );
    expect(r.metrics.find((m) => m.key === "p50")!.verdict).toBe("nochange");
  });

  it("p95 CI delta>0 (A>B, so B is LOWER) on an up-worse metric -> verdict lower (B improved)", () => {
    // delta = A − B = 50 > 0 → B's latency is lower than A → an improvement.
    const endpoint = {
      p50: md(),
      p95: md({ straddles_zero: false, delta: 50, lo: 10, hi: 90 }),
      p99: md(),
      cost: md(),
    };
    const r = buildCompareResultFromEndpoint(
      kpi(500, 10, 5),
      kpi(500, 10, 5),
      endpoint,
      disjointWin,
    );
    expect(r.metrics.find((m) => m.key === "p95")!.verdict).toBe("lower");
  });

  it("p95 CI delta<0 (A<B, so B is HIGHER) on an up-worse metric -> verdict higher (B regressed)", () => {
    const endpoint = {
      p50: md(),
      p95: md({ straddles_zero: false, delta: -50, lo: -90, hi: -10 }),
      p99: md(),
      cost: md(),
    };
    const r = buildCompareResultFromEndpoint(
      kpi(500, 10, 5),
      kpi(500, 10, 5),
      endpoint,
      disjointWin,
    );
    expect(r.metrics.find((m) => m.key === "p95")!.verdict).toBe("higher");
  });

  it("insufficient:true on a metric yields verdict insufficient and null ci for that metric only", () => {
    const endpoint = {
      p50: md({ insufficient: true }),
      p95: md(),
      p99: md(),
      cost: md(),
    };
    const r = buildCompareResultFromEndpoint(
      kpi(500, 10, 5),
      kpi(500, 10, 5),
      endpoint,
      disjointWin,
    );
    const p50 = r.metrics.find((m) => m.key === "p50")!;
    expect(p50.verdict).toBe("insufficient");
    expect(p50.ci).toBeNull();
    const p95 = r.metrics.find((m) => m.key === "p95")!;
    expect(p95.verdict).not.toBe("insufficient");
  });
});

describe("endpointHasSufficientLatencyAndCost", () => {
  it("true when p95 is sufficient (uses the endpoint path)", () => {
    expect(
      endpointHasSufficientLatencyAndCost({
        p50: md(),
        p95: md(),
        cost: md(),
      }),
    ).toBe(true);
  });
  it("stays true when p50 or cost is insufficient but p95 is good — p50-insufficient (clustered-data density-probe degeneracy) must NOT trigger the ~3s bootstrap fallback", () => {
    expect(
      endpointHasSufficientLatencyAndCost({
        p50: md({ insufficient: true }),
        p95: md(),
        cost: md(),
      }),
    ).toBe(true);
    expect(
      endpointHasSufficientLatencyAndCost({
        p50: md(),
        p95: md(),
        cost: md({ insufficient: true }),
      }),
    ).toBe(true);
  });
  it("false only when p95 (the headline metric) is insufficient → raw fallback", () => {
    expect(
      endpointHasSufficientLatencyAndCost({
        p50: md(),
        p95: md({ insufficient: true }),
        cost: md(),
      }),
    ).toBe(false);
  });
});
