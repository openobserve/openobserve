// @vitest-environment jsdom

const mockExecuteQuery = vi.fn();
const mockExecuteQueryOnce = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: mockExecuteQuery,
    executeQueryOnce: mockExecuteQueryOnce,
    cancelAll: vi.fn(),
  }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  buildEvaluatorSpanLookupSql,
  buildQualityRunsCountSql,
  buildQualityRunsSql,
  mapQualityRunRow,
  useQualityRuns,
} from "./useQualityRuns";

const WINDOW = { startUs: 100, endUs: 200 };

const numericConfig: ScoreConfig = {
  id: "config-version-1",
  entityId: "answer-quality",
  name: "Answer quality",
  version: 1,
  dataType: "numeric",
  healthyThreshold: { direction: "gte", value: 0.8 },
};

beforeEach(() => {
  mockExecuteQuery.mockReset();
  mockExecuteQueryOnce.mockReset();
});

describe("Quality score SQL", () => {
  it("builds the entire table from _llm_scores with canonical reasoning", () => {
    const sql = buildQualityRunsSql(numericConfig, "agent_id = 'agent-1'", "trace", "all", 3, 20);

    expect(sql).toContain('FROM "_llm_scores"');
    expect(sql).toContain("PARTITION BY _evaluation_key");
    expect(sql).toContain("WHERE _latest_score_rank = 1");
    expect(sql).toContain("value_numeric");
    expect(sql).toContain("value_categorical");
    expect(sql).toContain("value_boolean");
    expect(sql).toContain("reasoning");
    expect(sql).toContain("agent_name");
    expect(sql).toContain("agent_id");
    expect(sql).toContain("evaluator_trace_id");
    expect(sql).toContain("task_id");
    expect(sql).toContain("agent_id = 'agent-1'");
    expect(sql).toContain("= 'trace'");
    expect(sql).toContain("ORDER BY _timestamp DESC, id DESC");
    expect(sql).toContain("LIMIT 20 OFFSET 40");
    expect(sql).not.toContain("_evaluator");
    expect(sql).not.toContain("attributes_response");
  });

  it("applies the healthy condition for the unhealthy server page", () => {
    const sql = buildQualityRunsSql(numericConfig, null, "all", "unhealthy", 1, 10);
    const countsSql = buildQualityRunsCountSql(numericConfig, null, "all");

    expect(sql).toContain("value_numeric < 0.8");
    expect(countsSql).toContain("COUNT(CASE WHEN value_numeric < 0.8 THEN 1 END)");
    expect(countsSql).toContain("COUNT(*) AS all_count");
    expect(countsSql).toContain("PARTITION BY _evaluation_key");
    expect(countsSql).toContain("WHERE _latest_score_rank = 1");
  });

  it("builds a targeted evaluator-span lookup without joining the runs table", () => {
    const sql = buildEvaluatorSpanLookupSql("trace-'one", "task-'one", "score-'one");

    expect(sql).toContain('FROM "_evaluator"');
    expect(sql).toContain("trace-''one");
    expect(sql).toContain("task-''one");
    expect(sql).toContain("score-''one");
    expect(sql).toContain("attributes_task_id");
    expect(sql).toContain("attributes_score_id");
    expect(sql).toContain("ORDER BY _timestamp DESC");
    expect(sql).toContain("LIMIT 1");
  });

  it("falls back to the newest task attempt when there is no score id", () => {
    const sql = buildEvaluatorSpanLookupSql("trace-1", "task-1");

    expect(sql).toContain("trace-1");
    expect(sql).toContain("attributes_task_id");
    expect(sql).toContain("task-1");
    expect(sql).not.toContain("attributes_score_id");
    expect(sql).toContain("ORDER BY _timestamp DESC");
    expect(sql).toContain("LIMIT 1");
  });
});

describe("quality score mapping", () => {
  it("uses typed score values and reasoning from the canonical score row", () => {
    const row = mapQualityRunRow(
      {
        _timestamp: 1_784_006_837_417_547,
        id: "score-1",
        task_id: "task-1",
        eval_run_id: "run-1",
        evaluator_trace_id: "evaluation-trace",
        target_scope: "trace",
        target_id: "target-trace",
        trace_id: "target-trace",
        source_stream: "default",
        agent_name: "Support agent",
        agent_id: "support-agent",
        value_numeric: "0.42",
        reasoning: "The response omitted the requested evidence.",
      },
      numericConfig,
    );

    expect(row).toMatchObject({
      id: "score-1",
      taskId: "task-1",
      evaluatorTraceId: "evaluation-trace",
      evaluatorSpanId: "",
      targetScope: "trace",
      targetTraceId: "target-trace",
      result: 0.42,
      resultDisplay: "0.42",
      reasoning: "The response omitted the requested evidence.",
      agentName: "Support agent",
      agentId: "support-agent",
      health: "unhealthy",
      isUnhealthy: true,
    });
    expect(row.timestampMs).toBe(1_784_006_837_418);
  });

  it("maps categorical and boolean values without a response payload", () => {
    const categorical = mapQualityRunRow(
      {
        id: "cat-score",
        evaluator_trace_id: "cat-trace",
        value_categorical: "low",
        reasoning: "missed constraints",
      },
      {
        id: "cat",
        name: "Instruction following",
        version: 1,
        dataType: "categorical",
        healthyThreshold: { healthy_categories: ["high"] },
      },
    );
    const boolean = mapQualityRunRow(
      {
        id: "bool-score",
        evaluator_trace_id: "bool-trace",
        value_boolean: false,
      },
      {
        id: "bool",
        name: "Output format",
        version: 1,
        dataType: "boolean",
        healthyThreshold: { healthy_value: true },
      },
    );

    expect(categorical).toMatchObject({
      result: "low",
      reasoning: "missed constraints",
      resultDisplay: "low",
      isUnhealthy: true,
    });
    expect(boolean).toMatchObject({
      result: false,
      resultDisplay: "false",
      isUnhealthy: true,
    });
  });
});

describe("useQualityRuns", () => {
  it("queries only the logs stream and maps the server page", async () => {
    mockExecuteQueryOnce
      .mockResolvedValueOnce([{ all_count: 42, unhealthy_count: 7 }])
      .mockResolvedValueOnce([
        {
          id: "score-1",
          task_id: "task-1",
          evaluator_trace_id: "evaluation-trace",
          agent_name: "Support agent",
          agent_id: "support-agent",
          value_numeric: 0.95,
          reasoning: "complete",
        },
      ]);
    const { runs, counts, totalCount, refresh } = useQualityRuns(
      ref<ScoreConfig | null>(numericConfig),
      ref(WINDOW),
      ref({
        name: "Support agent",
        id: "agent-1",
        source_stream: "default",
        source_stream_type: "traces",
      }),
      ref("span"),
    );

    await refresh();

    expect(mockExecuteQueryOnce).toHaveBeenCalledTimes(2);
    for (const [sql, startUs, endUs, pageType] of mockExecuteQueryOnce.mock.calls) {
      expect(sql).toContain('FROM "_llm_scores"');
      expect(sql).not.toContain("_evaluator");
      expect(sql).not.toContain("attributes_response");
      expect(startUs).toBe(100);
      expect(endUs).toBe(200);
      expect(pageType).toBe("logs");
    }
    expect(counts.value).toEqual({ all: 42, unhealthy: 7 });
    expect(totalCount.value).toBe(42);
    expect(runs.value[0]).toMatchObject({
      id: "score-1",
      taskId: "task-1",
      result: 0.95,
      reasoning: "complete",
      evaluatorTraceId: "evaluation-trace",
      agentName: "Support agent",
      agentId: "support-agent",
      health: "healthy",
    });
  });

  it("resolves the exact score attempt within its task on row activation", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ span_id: "evaluator-span-1" }]);
    const { resolveEvaluatorSpanId } = useQualityRuns(
      ref<ScoreConfig | null>(numericConfig),
      ref({ startUs: 100, endUs: 200 }),
    );
    const run = mapQualityRunRow(
      {
        _timestamp: 1_784_006_837_417_547,
        id: "score-1",
        task_id: "task-1",
        evaluator_trace_id: "evaluator-trace-1",
        value_numeric: 0.95,
      },
      numericConfig,
    );

    await expect(resolveEvaluatorSpanId(run)).resolves.toBe("evaluator-span-1");
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining("attributes_score_id"),
      1_784_006_777_418_000,
      1_784_010_437_418_000,
      "traces",
    );
    expect(mockExecuteQuery.mock.calls[0][0]).toContain("evaluator-trace-1");
    expect(mockExecuteQuery.mock.calls[0][0]).toContain("task-1");
    expect(mockExecuteQuery.mock.calls[0][0]).toContain("score-1");
  });
});
