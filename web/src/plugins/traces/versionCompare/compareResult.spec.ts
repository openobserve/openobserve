// compareResult.spec.ts
import { describe, it, expect } from "vitest";
import { buildCompareResult } from "./compareResult";

const kpi = (traceCount: number, errorCount: number, totalCost: number) => ({
  requestCount: traceCount, traceCount, errorCount, totalTokens: traceCount * 100, totalCost, p95DurationMicros: 0,
});
const disjointWin = { mode: "sinceRollout" as const, a: {start:0,end:1}, b:{start:2,end:3}, deltaMicros:1, limitedBy:null, overlap:"disjoint" as const, overlapFraction:0 };

describe("buildCompareResult", () => {
  it("suppresses ALL verdicts when either arm < MIN_SAMPLE", () => {
    const r = buildCompareResult(kpi(42, 5, 1), kpi(88, 3, 1),
      { durations: [1,2,3], costs: [1] }, { durations: [1], costs: [1] }, disjointWin, 1);
    expect(r.enoughSample).toBe(false);
    expect(r.metrics.every(m => !m.flagged || m.verdict === "insufficient")).toBe(true);
  });
  it("flags exactly {errorRate,p50,p95,cost}; volume+p99 are display-only (verdict nochange, flagged false)", () => {
    const durs = Array.from({length: 500}, (_, i) => 100 + i);
    const r = buildCompareResult(kpi(500, 100, 50), kpi(500, 20, 30),
      { durations: durs, costs: durs }, { durations: durs.map(d=>d/2), costs: durs.map(d=>d/2) }, disjointWin, 9);
    const flagged = r.metrics.filter(m => m.flagged).map(m => m.key).sort();
    expect(flagged).toEqual(["cost","errorRate","p50","p95"]);
    expect(r.metrics.find(m=>m.key==="p99")!.ci).toBeNull();
    expect(r.metrics.find(m=>m.key==="volume")!.ci).toBeNull();
  });
  it("marks results associative in sinceRollout mode", () => {
    const durs = Array.from({length: 200}, (_, i) => i + 1);
    const r = buildCompareResult(kpi(200, 10, 5), kpi(200, 8, 5),
      { durations: durs, costs: durs }, { durations: durs, costs: durs }, disjointWin, 3);
    expect(r.metrics.every(m => m.associative)).toBe(true);
  });
  it("empty raw-sample with traceCount>=MIN_SAMPLE yields insufficient p50/p95/cost, not a confident nochange", () => {
    const r = buildCompareResult(kpi(500, 10, 50), kpi(500, 8, 45),
      { durations: [], costs: [] }, { durations: [], costs: [] }, disjointWin, 5);
    expect(r.enoughSample).toBe(true);
    for (const key of ["p50", "p95", "cost"] as const) {
      const m = r.metrics.find(x => x.key === key)!;
      expect(m.verdict).toBe("insufficient");
      expect(m.ci).toBeNull();
    }
    // errorRate rides KPI aggregates (not raw samples) — unaffected by empty samples.
    const errRate = r.metrics.find(m => m.key === "errorRate")!;
    expect(errRate.verdict).not.toBe("insufficient");
    expect(errRate.ci).not.toBeNull();
  });
});
