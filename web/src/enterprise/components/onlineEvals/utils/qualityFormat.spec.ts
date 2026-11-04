import { describe, expect, it } from "vitest";
import { gt } from "@/types/i18n";
import type {
  QualityDistributionBucket,
  QualityScore,
  QualityTimelineBucket,
} from "@/services/online-evals.service";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { ALL_AGENTS_VALUE } from "@/plugins/traces/llmAgentFilter";
import {
  DEFAULT_QUALITY_RANGE,
  agentParamsFor,
  barShare,
  bucketLabel,
  chartFilterFromQuery,
  chartFilterLabel,
  chartFilterParams,
  chartFilterToQuery,
  distributionDataType,
  trendKind,
  trendPoints,
  evaluatorTraceLink,
  formatCount,
  formatEdge,
  formatExact,
  formatNumber,
  formatPercent,
  formatScore,
  formatScoreValue,
  healthSortValue,
  nextChartFilter,
  qualityRangeFromQuery,
  qualityRangeQuery,
  scopeMixText,
  scoreAxisBounds,
  selectedAgents,
  statusRank,
  summarizeDistribution,
  targetLink,
  targetTraceId,
  targetWindow,
  typicalScore,
  typicalSortValue,
  unhealthyShare,
  unhealthyTone,
  type QualityRow,
} from "./qualityFormat";
import { thresholdForConfig } from "./scoreThreshold";

function row(overrides: Partial<QualityRow>): QualityRow {
  return {
    configId: "c",
    name: "c",
    dataType: "numeric",
    status: "healthy",
    total: 10,
    unhealthy: 0,
    average: 0.5,
    lastScoredAt: 1,
    scopeCounts: { span: 0, trace: 10, session: 0 },
    topValue: null,
    description: "",
    version: 1,
    thresholdLabel: "",
    range: { min: 0, max: 1 },
    ...overrides,
  };
}

const numericBuckets: QualityDistributionBucket[] = Array.from({ length: 10 }, (_, i) => ({
  key: i,
  lower: i / 10,
  upper: (i + 1) / 10,
  count: i,
  unhealthy: i > 6 ? i : 0,
}));

describe("status rank and default sort", () => {
  it("ranks attention, healthy, unset, then no data", () => {
    expect(["no_data", "unset", "healthy", "attention"].map((s) => statusRank(s as any))).toEqual([
      3, 2, 1, 0,
    ]);
  });

  it("sorts by status first, then the higher unhealthy share", () => {
    const rows = [
      row({ configId: "healthy", status: "healthy", unhealthy: 0 }),
      row({ configId: "low", status: "attention", unhealthy: 2 }),
      row({ configId: "nodata", status: "no_data", total: 0, unhealthy: 0 }),
      row({ configId: "high", status: "attention", unhealthy: 9 }),
      row({ configId: "unset", status: "unset", unhealthy: null }),
    ];
    const sorted = [...rows].sort((a, b) => healthSortValue(a) - healthSortValue(b));
    expect(sorted.map((r) => r.configId)).toEqual(["high", "low", "healthy", "unset", "nodata"]);
  });
});

describe("unhealthy bar tone", () => {
  it("bands the share: under 25% green, under 75% orange, 75% and up red", () => {
    const cases: [number, string][] = [
      [0, "success"],
      [0.249, "success"],
      [0.25, "warning"],
      [0.749, "warning"],
      [0.75, "danger"],
      [1, "danger"],
    ];
    for (const [share, tone] of cases) expect(unhealthyTone(share)).toBe(tone);
  });

  it("bands on the shown one-decimal percent, so the colour matches the text", () => {
    // 0.24996 shows as 25.0% and 0.74996 as 75.0%.
    expect(unhealthyTone(0.24996)).toBe("warning");
    expect(unhealthyTone(0.74996)).toBe("danger");
    expect(unhealthyTone(0.24949)).toBe("success");
  });

  it("has no tone without a threshold or without scores, where the cell shows no bar", () => {
    expect(unhealthyTone(null)).toBeNull();
    expect(unhealthyTone(unhealthyShare({ total: 10, unhealthy: null }))).toBeNull();
    expect(unhealthyTone(unhealthyShare({ total: 0, unhealthy: 0 }))).toBeNull();
  });
});

describe("typical score", () => {
  it("shows the average on the config range for numeric configs", () => {
    const value = typicalScore(row({ average: 0.55, range: { min: 0, max: 1 } }), gt);
    expect(value).toEqual({ value: "0.55", sub: "average, 0 to 1" });
    expect(typicalSortValue(row({ average: 0.55 }))).toBe(0.55);
  });

  it("keeps up to 4 decimals of an average, so a narrow range does not round onto its rule", () => {
    const value = typicalScore(row({ average: 0.0195, range: { min: 0, max: 0.05 } }), gt);
    expect(value?.value).toBe("0.0195");
  });

  it("shows the most common value for categorical and boolean configs", () => {
    const categorical = row({
      dataType: "categorical",
      total: 37,
      topValue: { key: "medium", count: 18 },
    });
    expect(typicalScore(categorical, gt)).toEqual({
      value: "medium",
      sub: "most common · 18 of 37",
    });
    expect(typicalSortValue(categorical)).toBeCloseTo(18 / 37);
    const boolean = row({ dataType: "boolean", total: 166, topValue: { key: false, count: 166 } });
    expect(typicalScore(boolean, gt)?.value).toBe("false");
  });

  it("is empty without scores", () => {
    expect(typicalScore(row({ total: 0 }), gt)).toBeNull();
    expect(typicalSortValue(row({ total: 0 }))).toBe(-1);
  });
});

describe("summaries", () => {
  it("builds the scope mix, skipping empty scopes", () => {
    expect(scopeMixText({ span: 0, trace: 38, session: 8 }, gt)).toBe("Trace 38 · Session 8");
  });

  it("derives status and counts from distribution[] like the backend", () => {
    expect(summarizeDistribution([])).toEqual({ total: 0, unhealthy: null, status: "no_data" });
    expect(
      summarizeDistribution([
        { key: true, count: 0, unhealthy: 0 },
        { key: false, count: 0, unhealthy: 0 },
      ]).status,
    ).toBe("no_data");
    expect(
      summarizeDistribution([
        { key: "low", count: 3, unhealthy: null },
        { key: "high", count: 2, unhealthy: null },
      ]),
    ).toEqual({ total: 5, unhealthy: null, status: "unset" });
    expect(summarizeDistribution(numericBuckets)).toEqual({
      total: 45,
      unhealthy: 24,
      status: "attention",
    });
    expect(summarizeDistribution([{ key: "low", count: 4, unhealthy: 0 }]).status).toBe("healthy");
  });

  it("tells the data type from the distribution when the config is unknown", () => {
    expect(distributionDataType(numericBuckets)).toBe("numeric");
    expect(distributionDataType([{ key: true, count: 1, unhealthy: 0 }])).toBe("boolean");
    expect(distributionDataType([{ key: "low", count: 1, unhealthy: 0 }])).toBe("categorical");
  });

  it("labels numeric buckets by range and the others by value", () => {
    expect(bucketLabel(numericBuckets[3])).toBe("0.3–0.4");
    expect(bucketLabel({ key: false, count: 1, unhealthy: 0 })).toBe("false");
  });

  it("labels the edge bars open-ended, since they also hold the values outside the range", () => {
    expect(bucketLabel(numericBuckets[0], { first: true })).toBe("< 0.1");
    expect(bucketLabel(numericBuckets[9], { last: true })).toBe("≥ 0.9");
    expect(bucketLabel(numericBuckets[0], { first: true, last: true })).toBe("0–0.1");
    expect(bucketLabel({ key: "low", count: 1, unhealthy: 0 }, { first: true })).toBe("low");
  });
});

describe("trend", () => {
  const hour = 3_600_000_000;
  const bucket = (
    index: number,
    fields: Partial<QualityTimelineBucket>,
  ): QualityTimelineBucket => ({
    start: index * hour,
    end: (index + 1) * hour,
    count: 0,
    unhealthy: null,
    trueCount: null,
    average: null,
    p95: null,
    ...fields,
  });

  it("draws the score for numeric configs, the healthy rate with a threshold, else the true rate or the count", () => {
    expect(trendKind([bucket(0, { count: 4, unhealthy: 1 })], "numeric")).toBe("score");
    expect(trendKind([bucket(0, { count: 4, unhealthy: 1 })], "categorical")).toBe("healthyRate");
    expect(trendKind([bucket(0, { count: 4, trueCount: 3 })], "boolean")).toBe("trueRate");
    expect(trendKind([bucket(0, { count: 4 })], "categorical")).toBe("count");
  });

  it("plots only buckets with scores, at their midpoint", () => {
    const timeline = [
      bucket(0, { count: 4, unhealthy: 1, trueCount: 3, average: 0.25, p95: 0.6 }),
      bucket(1, { count: 0, unhealthy: 0 }),
      bucket(2, { count: 2, unhealthy: 2, trueCount: 0, average: 0.5, p95: 0.9 }),
    ];
    expect(trendPoints(timeline, "average")).toEqual([
      [1_800_000, 0.25],
      [9_000_000, 0.5],
    ]);
    expect(trendPoints(timeline, "p95").map(([, value]) => value)).toEqual([0.6, 0.9]);
    expect(trendPoints(timeline, "healthyRate").map(([, value]) => value)).toEqual([75, 0]);
    expect(trendPoints(timeline, "trueRate").map(([, value]) => value)).toEqual([75, 0]);
    expect(trendPoints(timeline, "count").map(([, value]) => value)).toEqual([4, 2]);
  });

  it("widens the score axis to values outside the range, so no line is clipped", () => {
    const timeline = [
      bucket(0, { count: 3, average: -2, p95: 0.5 }),
      bucket(1, { count: 3, average: 4, p95: 7.5 }),
    ];
    expect(scoreAxisBounds({ min: 1, max: 5 }, timeline)).toEqual({ min: -2, max: 7.5 });
    expect(scoreAxisBounds({ min: 0, max: 1 }, [bucket(0, { count: 1, average: 0.4 })])).toEqual({
      min: 0,
      max: 1,
    });
    expect(scoreAxisBounds(null, timeline)).toEqual({ min: "dataMin", max: "dataMax" });
  });
});

describe("chart click to API params", () => {
  it("selects a numeric bucket, widens it with shift, and clears on a second click", () => {
    let filter = nextChartFilter(null, numericBuckets[3], false);
    expect(chartFilterParams(filter)).toEqual({ bucket_from: 3, bucket_to: 3 });
    filter = nextChartFilter(filter, numericBuckets[6], true);
    expect(chartFilterParams(filter)).toEqual({ bucket_from: 3, bucket_to: 6 });
    expect(chartFilterLabel(filter!, numericBuckets, gt)).toBe("0.3 to 0.7");
    expect(chartFilterLabel({ kind: "bucket", from: 0, to: 2 }, numericBuckets, gt)).toBe(
      "Below 0.3",
    );
    expect(chartFilterLabel({ kind: "bucket", from: 8, to: 9 }, numericBuckets, gt)).toBe(
      "0.8 or more",
    );
    expect(chartFilterLabel({ kind: "bucket", from: 0, to: 9 }, numericBuckets, gt)).toBe(
      "Any value",
    );
    filter = nextChartFilter(filter, numericBuckets[5], false);
    expect(chartFilterParams(filter)).toEqual({ bucket_from: 5, bucket_to: 5 });
    expect(nextChartFilter(filter, numericBuckets[5], false)).toBeNull();
  });

  it("selects one value for boolean and categorical bars", () => {
    const medium = { key: "medium", count: 67, unhealthy: 67 };
    const filter = nextChartFilter(null, medium, true);
    expect(chartFilterParams(filter)).toEqual({ value: "medium" });
    expect(nextChartFilter(filter, medium, false)).toBeNull();
    expect(
      chartFilterParams(nextChartFilter(null, { key: false, count: 1, unhealthy: 1 }, false)),
    ).toEqual({
      value: "false",
    });
    expect(chartFilterParams(null)).toEqual({});
  });
});

describe("agent params", () => {
  const agents: GenAiAgentListItem[] = [
    {
      name: "a",
      id: "a1",
      source_stream: "s",
      source_stream_type: "traces",
      env: "prod",
      version: "1",
    },
    {
      name: "a",
      id: "a1",
      source_stream: "s",
      source_stream_type: "traces",
      env: "prod",
      version: "2",
    },
    {
      name: "b",
      id: null,
      source_stream: "s",
      source_stream_type: "traces",
      env: "dev",
      version: "1",
    },
  ];
  const ALL = ALL_AGENTS_VALUE;

  it("sends nothing for a level at All", () => {
    expect(agentParamsFor(agents, ALL, ALL, ALL)).toEqual({});
    expect(agentParamsFor(agents, "prod", ALL, ALL)).toEqual({ agent_env: "prod" });
  });

  it("sends the agent id when the matching agents share one, else the name", () => {
    expect(agentParamsFor(agents, ALL, "a", "2")).toEqual({ agent_id: "a1", agent_version: "2" });
    expect(agentParamsFor(agents, ALL, "b", ALL)).toEqual({ agent_name: "b" });
  });

  it("selects the agents every pinned level matches, and none for All", () => {
    expect(selectedAgents(agents, ALL, ALL, ALL)).toBeNull();
    expect(selectedAgents(agents, ALL, ALL, "1")?.map((a) => a.name)).toEqual(["a", "b"]);
    expect(selectedAgents(agents, "staging", ALL, ALL)).toEqual([]);
  });
});

describe("Quality range in the URL", () => {
  it("defaults to Past 24 Hours", () => {
    expect(DEFAULT_QUALITY_RANGE).toMatchObject({
      valueType: "relative",
      relativeTimePeriod: "24h",
    });
  });

  it("reads a relative period or an absolute from/to, and ignores anything else", () => {
    expect(qualityRangeFromQuery({ period: "7d" })).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "7d",
    });
    expect(qualityRangeFromQuery({ from: "100", to: "200" })).toEqual({
      valueType: "absolute",
      startTime: 100,
      endTime: 200,
      relativeTimePeriod: null,
    });
    expect(qualityRangeFromQuery({ period: "calendar:month:-1" })).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "calendar:month:-1",
    });
    expect(qualityRangeFromQuery({})).toBeNull();
    expect(qualityRangeFromQuery({ period: "soon" })).toBeNull();
    expect(qualityRangeFromQuery({ period: "calendar:month:1" })).toBeNull();
    expect(qualityRangeFromQuery({ from: "200", to: "100" })).toBeNull();
    expect(qualityRangeFromQuery({ from: "x", to: "y" })).toBeNull();
  });

  it("writes period or from/to, and nothing for the default range", () => {
    expect(qualityRangeQuery(DEFAULT_QUALITY_RANGE)).toEqual({
      period: undefined,
      from: undefined,
      to: undefined,
    });
    expect(qualityRangeQuery({ ...DEFAULT_QUALITY_RANGE, relativeTimePeriod: "1h" })).toEqual({
      period: "1h",
      from: undefined,
      to: undefined,
    });
    expect(
      qualityRangeQuery({
        valueType: "absolute",
        startTime: 100,
        endTime: 200,
        relativeTimePeriod: null,
      }),
    ).toEqual({ period: undefined, from: "100", to: "200" });
  });
});

describe("link windows", () => {
  const score: QualityScore = {
    id: "s1",
    timestamp: 5_000_000_000,
    refTimestamp: 4_000_000_000,
    sourceType: "llm_judge",
    targetScope: "span",
    targetId: "span-1",
    spanId: "span-1",
    traceId: "trace-1",
    sessionId: null,
    sourceStream: "default",
    sourceStreamType: "traces",
    value: 0.2,
    unhealthy: true,
    reasoning: null,
    evaluatorTraceId: "eval-1",
    taskId: null,
    inputPreview: null,
    outputPreview: null,
    inputSpanId: null,
    outputSpanId: null,
  };

  it("opens the target trace an hour either side of its start, with the span selected", () => {
    expect(targetLink(score, "org1")).toEqual({
      name: "traceDetails",
      query: {
        org_identifier: "org1",
        from: 4_000_000_000 - 3_600_000_000,
        to: 4_000_000_000 + 3_600_000_000,
        stream: "default",
        trace_id: "trace-1",
        span_id: "span-1",
      },
    });
  });

  it("opens a session on the session page", () => {
    const session = {
      ...score,
      targetScope: "session" as const,
      sessionId: "sess-1",
      traceId: null,
    };
    expect(targetLink(session, "org1")).toMatchObject({
      name: "sessionDetails",
      query: { session_id: "sess-1" },
    });
  });

  it("shares one window between the links and the full-text fetch, and finds the trace", () => {
    expect(targetWindow(score)).toEqual({
      startTime: 4_000_000_000 - 3_600_000_000,
      endTime: 4_000_000_000 + 3_600_000_000,
    });
    expect(targetTraceId(score)).toBe("trace-1");
    expect(
      targetTraceId({ ...score, targetScope: "trace", traceId: null, targetId: "trace-2" }),
    ).toBe("trace-2");
    expect(targetTraceId({ ...score, traceId: null })).toBeNull();
    expect(targetTraceId({ ...score, targetScope: "session", sessionId: "sess-1" })).toBeNull();
  });

  it("opens the evaluator trace around the score write time", () => {
    expect(evaluatorTraceLink(score, "org1")).toEqual({
      name: "traceDetails",
      query: {
        org_identifier: "org1",
        stream: "_evaluator",
        trace_id: "eval-1",
        from: 5_000_000_000 - 3_600_000_000,
        to: 5_000_000_000 + 3_600_000_000,
      },
    });
    expect(evaluatorTraceLink({ ...score, evaluatorTraceId: null }, "org1")).toBeNull();
  });
});

describe("chart filter in the URL", () => {
  it("writes a bucket range and a value, and reads them back", () => {
    for (const filter of [
      { kind: "bucket", from: 3, to: 5 } as const,
      { kind: "value", value: "medium" } as const,
    ]) {
      expect(chartFilterFromQuery(chartFilterToQuery(filter))).toEqual(filter);
    }
    expect(chartFilterToQuery({ kind: "bucket", from: 2, to: 2 })).toEqual({ bucket: "2-2" });
    expect(chartFilterToQuery(null)).toEqual({});
  });

  it("restores no filter from a missing or malformed value", () => {
    expect(chartFilterFromQuery({})).toBeNull();
    expect(chartFilterFromQuery({ bucket: "5-3" })).toBeNull();
    expect(chartFilterFromQuery({ bucket: "3-12" })).toBeNull();
    expect(chartFilterFromQuery({ bucket: "9-9" })).toEqual({ kind: "bucket", from: 9, to: 9 });
    expect(chartFilterFromQuery({ bucket: "x" })).toBeNull();
    expect(chartFilterFromQuery({ value: "" })).toBeNull();
    expect(chartFilterFromQuery({ value: ["a", "b"] })).toBeNull();
  });
});

describe("numbers by size", () => {
  it("groups thousands and keeps tiny values distinct", () => {
    expect(formatNumber(1_000_000_000)).toBe("1,000,000,000");
    expect(formatNumber(0.7)).toBe("0.7");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-0.5)).toBe("-0.5");
    expect(formatNumber(0.000324)).toBe("0.00032");
    expect(formatScore(462_522_542.5)).toBe("462,522,542.50");
    expect(formatScore(0.7)).toBe("0.70");
    expect(formatScore(0.000324)).toBe("0.00032");
    expect(formatScoreValue(0.0003, "numeric")).not.toBe(formatScoreValue(0.0007, "numeric"));
    expect(formatCount(150_000)).toBe("150,000");
  });

  it("labels a tiny range by its real edges", () => {
    expect(bucketLabel({ key: 3, lower: 0.0003, upper: 0.0004, count: 1, unhealthy: 0 })).toBe(
      "0.0003–0.0004",
    );
  });

  it("groups the counts in the typical score and the threshold in the rule", () => {
    const top = typicalScore(
      row({ dataType: "boolean", total: 5000, topValue: { key: false, count: 4999 } }),
      gt,
    );
    expect(String(top?.sub)).toContain("4,999 of 5,000");
    const config = {
      name: "c",
      dataType: "numeric",
      healthyThreshold: { direction: "gte", value: 250_000_000 },
    } as any;
    expect(String(thresholdForConfig(config).label)).toBe("≥ 250,000,000");
  });
});

describe("unhealthy share at the ends", () => {
  it("never shows 0.0% for some or 100.0% for not all", () => {
    expect(formatPercent(1, 5000)).toBe("<0.1%");
    expect(formatPercent(4999, 5000)).toBe(">99.9%");
    expect(formatPercent(0, 5)).toBe("0.0%");
    expect(formatPercent(5, 5)).toBe("100.0%");
    expect(formatPercent(25, 100)).toBe("25.0%");
    expect(formatPercent(1, 0)).toBe("—");
  });

  it("keeps a visible sliver of bar for any non-zero share", () => {
    expect(barShare(1 / 5000)).toBe(0.02);
    expect(barShare(0.5)).toBe(0.5);
    expect(barShare(0)).toBe(0);
    expect(barShare(null)).toBe(0);
  });
});

describe("categorical rule", () => {
  const categorical = (healthyThreshold: unknown) =>
    ({ name: "c", dataType: "categorical", categories: ["a", "b"], healthyThreshold }) as any;

  it("says none for an empty healthy list, which the backend reads as every score unhealthy", () => {
    expect(String(thresholdForConfig(categorical({ healthy_categories: [] })).label)).toBe("none");
    expect(String(thresholdForConfig(categorical({ healthy_categories: ["a"] })).label)).toBe("a");
    expect(String(thresholdForConfig(categorical({})).label)).toBe("");
  });
});

describe("precision that matches the data", () => {
  it("shows a score with 2 to 4 decimals, so it never reads the same as the rule it fails", () => {
    expect(formatScoreValue(0.019, "numeric")).toBe("0.019");
    expect(formatScoreValue(0.6999, "numeric")).toBe("0.6999");
    expect(formatScoreValue(0.5, "numeric")).toBe("0.50");
    expect(formatScoreValue(1, "numeric")).toBe("1.00");
    expect(formatScoreValue(0, "numeric")).toBe("0.00");
    expect(formatScoreValue(0.00032, "numeric")).toBe("0.00032");
    expect(formatScoreValue(462_522_542.5, "numeric")).toBe("462,522,542.50");
  });

  it("shows a configured threshold exactly, so it never contradicts a score", () => {
    const config = {
      name: "c",
      dataType: "numeric",
      healthyThreshold: { direction: "gte", value: 0.333 },
    } as any;
    expect(String(thresholdForConfig(config).label)).toBe("≥ 0.333");
    expect(formatExact(1_250_000.125)).toBe("1,250,000.125");
  });

  it("labels narrow buckets with enough decimals to tell them apart", () => {
    expect(bucketLabel({ key: 4, lower: 0.02, upper: 0.025, count: 1, unhealthy: 0 })).toBe(
      "0.02–0.025",
    );
    expect(
      bucketLabel({ key: 9, lower: 0.045, upper: 0.05, count: 1, unhealthy: 0 }, { last: true }),
    ).toBe("≥ 0.045");
    expect(formatEdge(100_000_000, 100_000_000)).toBe("100,000,000");
  });

  it("never prints exponent notation for tiny values", () => {
    expect(formatNumber(1e-9)).not.toContain("e");
    expect(formatScore(2.5e-7)).not.toContain("e");
  });
});
