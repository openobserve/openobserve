// compareResult.ts
import type { LLMKPI } from "../composables/useLLMInsights";
import type { MetricDelta } from "@/services/gen-ai-agent-mapping.service";
import { MIN_SAMPLE, BOOTSTRAP_ITERS, CI_LEVEL } from "./constants";
import type { CompareWindows } from "./windows";
import { proportionDiffCI, bootstrapDiffCI, percentile, mean, classifyVerdict, type DiffCI, type Verdict } from "./stats";

export type MetricKey = "volume" | "errorRate" | "p50" | "p95" | "p99" | "cost";
export interface MetricResult {
  key: MetricKey; a: number; b: number; deltaPct: number | null;
  ci: DiffCI | null; verdict: Verdict; flagged: boolean; associative: boolean;
}
export interface CompareResult { metrics: MetricResult[]; enoughSample: boolean; nA: number; nB: number; }

const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / b) * 100);

export function buildCompareResult(
  kpiA: LLMKPI, kpiB: LLMKPI,
  samplesA: { durations: number[]; costs: number[] },
  samplesB: { durations: number[]; costs: number[] },
  windows: CompareWindows, seed: number,
): CompareResult {
  const nA = kpiA.traceCount, nB = kpiB.traceCount;
  const enoughSample = nA >= MIN_SAMPLE && nB >= MIN_SAMPLE;
  const associative = windows.mode !== "sameWallClock";
  // A raw-sample fetch can come back empty (network hiccup, transient error
  // swallowed upstream into `{durations:[],costs:[]}`) even when traceCount
  // clears MIN_SAMPLE. Bootstrap CIs over an empty array degenerate to delta
  // 0 / CI [0,0] — a confident "nochange" that isn't earned. Gate the
  // bootstrap-backed metrics on sample presence, independent of enoughSample.
  const hasDurationSamples = samplesA.durations.length > 0 && samplesB.durations.length > 0;
  const hasCostSamples = samplesA.costs.length > 0 && samplesB.costs.length > 0;
  const hoursA = Math.max(1e-9, (windows.a.end - windows.a.start) / 3_600_000_000);
  const hoursB = Math.max(1e-9, (windows.b.end - windows.b.start) / 3_600_000_000);

  const errRateA = nA ? kpiA.errorCount / nA : 0;
  const errRateB = nB ? kpiB.errorCount / nB : 0;
  const costPerA = nA ? kpiA.totalCost / nA : 0;
  const costPerB = nB ? kpiB.totalCost / nB : 0;
  const volA = kpiA.traceCount / hoursA, volB = kpiB.traceCount / hoursB;

  const errCI = proportionDiffCI(kpiA.errorCount, nA, kpiB.errorCount, nB);
  const p50CI = bootstrapDiffCI(samplesA.durations, samplesB.durations, (xs) => percentile(xs, 0.5), BOOTSTRAP_ITERS, CI_LEVEL, seed);
  const p95CI = bootstrapDiffCI(samplesA.durations, samplesB.durations, (xs) => percentile(xs, 0.95), BOOTSTRAP_ITERS, CI_LEVEL, seed + 1);
  const costCI = bootstrapDiffCI(samplesA.costs, samplesB.costs, mean, BOOTSTRAP_ITERS, CI_LEVEL, seed + 2);

  const metrics: MetricResult[] = [
    { key: "volume", a: volA, b: volB, deltaPct: pct(volA, volB), ci: null, verdict: "nochange", flagged: false, associative },
    { key: "errorRate", a: errRateA, b: errRateB, deltaPct: pct(errRateA, errRateB), ci: errCI, verdict: classifyVerdict(errCI, "up-worse", enoughSample), flagged: true, associative },
    { key: "p50", a: percentile(samplesA.durations, 0.5), b: percentile(samplesB.durations, 0.5), deltaPct: null, ci: hasDurationSamples ? p50CI : null, verdict: hasDurationSamples ? classifyVerdict(p50CI, "up-worse", enoughSample) : "insufficient", flagged: true, associative },
    { key: "p95", a: percentile(samplesA.durations, 0.95), b: percentile(samplesB.durations, 0.95), deltaPct: null, ci: hasDurationSamples ? p95CI : null, verdict: hasDurationSamples ? classifyVerdict(p95CI, "up-worse", enoughSample) : "insufficient", flagged: true, associative },
    { key: "cost", a: costPerA, b: costPerB, deltaPct: pct(costPerA, costPerB), ci: hasCostSamples ? costCI : null, verdict: hasCostSamples ? classifyVerdict(costCI, "up-worse", enoughSample) : "insufficient", flagged: true, associative },
    { key: "p99", a: percentile(samplesA.durations, 0.99), b: percentile(samplesB.durations, 0.99), deltaPct: null, ci: null, verdict: "nochange", flagged: false, associative },
  ];
  metrics.forEach(m => { if (m.deltaPct === null && m.ci) m.deltaPct = pct(m.a, m.b); });
  return { metrics, enoughSample, nA, nB };
}

/**
 * Map a backend `MetricDelta` (sketch-endpoint response) into a `DiffCI` for
 * `classifyVerdict`. Field names are the wire names verbatim —
 * `{a,b,delta,lo,hi,straddles_zero,insufficient}` (see
 * `o2_enterprise/.../agent_signals/compare.rs`).
 */
function diffCIFromMetricDelta(md: MetricDelta): DiffCI {
  return { delta: md.delta, lower: md.lo, upper: md.hi, straddlesZero: md.straddles_zero };
}

/**
 * Build the p50/p95/p99/cost MetricResults from the sketch-compare endpoint
 * response, keeping error-rate + volume computed from KPI exactly as the
 * raw-sample path does (C2 — the endpoint does not return error-rate).
 *
 * @param endpoint the `{p50,p95,p99,cost}` response from
 *   `compareAgentVersions`. p99 stays display-only (no verdict) per spec,
 *   even though the endpoint now supplies its a/b/delta.
 */
export function buildCompareResultFromEndpoint(
  kpiA: LLMKPI, kpiB: LLMKPI,
  endpoint: { p50: MetricDelta; p95: MetricDelta; p99: MetricDelta; cost: MetricDelta },
  windows: CompareWindows,
): CompareResult {
  const nA = kpiA.traceCount, nB = kpiB.traceCount;
  const enoughSample = nA >= MIN_SAMPLE && nB >= MIN_SAMPLE;
  const associative = windows.mode !== "sameWallClock";
  const hoursA = Math.max(1e-9, (windows.a.end - windows.a.start) / 3_600_000_000);
  const hoursB = Math.max(1e-9, (windows.b.end - windows.b.start) / 3_600_000_000);

  const errRateA = nA ? kpiA.errorCount / nA : 0;
  const errRateB = nB ? kpiB.errorCount / nB : 0;
  const volA = kpiA.traceCount / hoursA, volB = kpiB.traceCount / hoursB;

  const errCI = proportionDiffCI(kpiA.errorCount, nA, kpiB.errorCount, nB);

  const p50 = endpoint.p50, p95 = endpoint.p95, p99 = endpoint.p99, cost = endpoint.cost;
  const p50CI = diffCIFromMetricDelta(p50);
  const p95CI = diffCIFromMetricDelta(p95);
  const costCI = diffCIFromMetricDelta(cost);

  const metrics: MetricResult[] = [
    { key: "volume", a: volA, b: volB, deltaPct: pct(volA, volB), ci: null, verdict: "nochange", flagged: false, associative },
    { key: "errorRate", a: errRateA, b: errRateB, deltaPct: pct(errRateA, errRateB), ci: errCI, verdict: classifyVerdict(errCI, "up-worse", enoughSample), flagged: true, associative },
    { key: "p50", a: p50.a, b: p50.b, deltaPct: pct(p50.a, p50.b), ci: p50.insufficient ? null : p50CI, verdict: p50.insufficient ? "insufficient" : classifyVerdict(p50CI, "up-worse", enoughSample), flagged: true, associative },
    { key: "p95", a: p95.a, b: p95.b, deltaPct: pct(p95.a, p95.b), ci: p95.insufficient ? null : p95CI, verdict: p95.insufficient ? "insufficient" : classifyVerdict(p95CI, "up-worse", enoughSample), flagged: true, associative },
    { key: "cost", a: cost.a, b: cost.b, deltaPct: pct(cost.a, cost.b), ci: cost.insufficient ? null : costCI, verdict: cost.insufficient ? "insufficient" : classifyVerdict(costCI, "up-worse", enoughSample), flagged: true, associative },
    { key: "p99", a: p99.a, b: p99.b, deltaPct: pct(p99.a, p99.b), ci: null, verdict: "nochange", flagged: false, associative },
  ];
  return { metrics, enoughSample, nA, nB };
}

/** Latency/cost is usable from the endpoint when none of p50/p95/cost report
 * `insufficient` and the arm produced no transport error. p99 is
 * display-only and does not gate the fallback decision. */
export function endpointHasSufficientLatencyAndCost(endpoint: {
  p50: MetricDelta; p95: MetricDelta; cost: MetricDelta;
}): boolean {
  return !endpoint.p50.insufficient && !endpoint.p95.insufficient && !endpoint.cost.insufficient;
}
