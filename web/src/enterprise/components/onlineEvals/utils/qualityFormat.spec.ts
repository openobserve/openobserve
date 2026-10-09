import { describe, expect, it } from "vitest";
import { gt } from "@/types/i18n";
import type { QualityDistributionBucket, QualityScore } from "@/services/online-evals.service";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { ALL_AGENTS_VALUE } from "@/plugins/traces/llmAgentFilter";
import {
  DEFAULT_QUALITY_RANGE,
  agentParamsFor,
  bucketLabel,
  chartFilterLabel,
  chartFilterParams,
  contentSpan,
  distributionDataType,
  evaluatorAgentWhere,
  evaluatorTraceLink,
  healthSortValue,
  nextChartFilter,
  qualityRangeFromQuery,
  qualityRangeQuery,
  scopeMixText,
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
});

describe("chart click to API params", () => {
  it("selects a numeric bucket, widens it with shift, and clears on a second click", () => {
    let filter = nextChartFilter(null, numericBuckets[3], false);
    expect(chartFilterParams(filter)).toEqual({ bucket_from: 3, bucket_to: 3 });
    filter = nextChartFilter(filter, numericBuckets[6], true);
    expect(chartFilterParams(filter)).toEqual({ bucket_from: 3, bucket_to: 6 });
    expect(chartFilterLabel(filter!, numericBuckets, gt)).toBe("0.3 to 0.7");
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

  it("filters _evaluator by each selected agent's id, or its name without one", () => {
    expect(evaluatorAgentWhere(agents)).toBe(
      "(attributes_target_agent_id = 'a1') OR (attributes_target_agent_name = 'b')",
    );
    expect(evaluatorAgentWhere([])).toBeNull();
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
    expect(qualityRangeFromQuery({})).toBeNull();
    expect(qualityRangeFromQuery({ period: "soon" })).toBeNull();
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

describe("the span a score's full text comes from", () => {
  const base: QualityScore = {
    id: "s1",
    timestamp: 5,
    refTimestamp: 4,
    sourceType: "llm_judge",
    targetScope: "trace",
    targetId: "trace-1",
    spanId: null,
    traceId: "trace-1",
    sessionId: null,
    sourceStream: "default",
    sourceStreamType: "traces",
    value: 1,
    unhealthy: false,
    reasoning: null,
    evaluatorTraceId: null,
    taskId: null,
    inputPreview: null,
    outputPreview: null,
  };
  const span = (id: string, at: number, fields: Record<string, unknown> = {}) => ({
    span_id: id,
    _timestamp: at,
    parent_span_id: "parent",
    ...fields,
  });
  const chat = { gen_ai_input_messages: "question", gen_ai_output_messages: "answer" };
  const tool = { ...chat, gen_ai_tool_name: "search" };

  it("reads a span score's own span by its id", () => {
    const spans = [span("a", 1, chat), span("b", 2, chat)];
    const spanScore = { ...base, targetScope: "span" as const, spanId: "b", targetId: "b" };
    expect(contentSpan(spanScore, spans)?.span_id).toBe("b");
    expect(contentSpan({ ...spanScore, spanId: null }, spans)?.span_id).toBe("b");
    expect(contentSpan({ ...spanScore, spanId: "missing" }, spans)).toBeUndefined();
  });

  it("picks a trace's root chat span before an earlier chat span", () => {
    const spans = [
      span("child", 1, chat),
      span("root", 2, { ...chat, parent_span_id: "" }),
      span("tool", 0, { ...tool, parent_span_id: "" }),
    ];
    expect(contentSpan(base, spans)?.span_id).toBe("root");
    // An all-zero parent id and a row without parent fields are roots too.
    expect(contentSpan(base, [span("z", 3, { ...chat, parent_span_id: "0000" })])?.span_id).toBe(
      "z",
    );
    expect(contentSpan(base, [{ span_id: "bare", _timestamp: 3, ...chat }])?.span_id).toBe("bare");
  });

  it("falls back to the first chat span by time, then to any span with LLM input or output", () => {
    const noRootChat = [
      span("late", 9, chat),
      span("early", 3, chat),
      span("root-tool", 1, { ...tool, parent_span_id: "" }),
    ];
    expect(contentSpan(base, noRootChat)?.span_id).toBe("early");
    const toolsOnly = [span("t2", 5, tool), span("t1", 4, { ...tool, operation_name: "tool.run" })];
    expect(contentSpan(base, toolsOnly)?.span_id).toBe("t1");
    const executeTool = [
      span("x", 1, { ...chat, gen_ai_operation_name: "execute_tool" }),
      span("c", 2, { llm_output: "reply" }),
    ];
    expect(contentSpan(base, executeTool)?.span_id).toBe("c");
  });

  it("finds nothing without LLM input or output", () => {
    expect(contentSpan(base, [span("plain", 1, { gen_ai_input_messages: "  " })])).toBeUndefined();
    expect(contentSpan(base, [])).toBeUndefined();
  });
});
