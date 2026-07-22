// @vitest-environment jsdom

const mockExecuteQuery = vi.fn();
const mockExecuteQueryOnce = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: mockExecuteQuery,
    executeQueryOnce: mockExecuteQueryOnce,
  }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  buildTrendSeries,
  buildQualityConfigAggSql,
  configHealthStatus,
  useQualityScoreConfigs,
} from "./useQualityScoreConfigs";

beforeEach(() => {
  mockExecuteQuery.mockReset();
  mockExecuteQueryOnce.mockReset();
});

describe("buildQualityConfigAggSql", () => {
  it("aggregates every quality scope and numeric threshold health", () => {
    const config: ScoreConfig = {
      id: "version-1",
      entityId: "answer-quality",
      name: "Answer quality",
      version: 1,
      dataType: "numeric",
      healthyThreshold: { direction: "gte", value: 0.8 },
    };

    const sql = buildQualityConfigAggSql([config], "agent_id = 'agent-1'");

    expect(sql).toContain("_target_scope = 'span'");
    expect(sql).toContain("_target_scope = 'trace'");
    expect(sql).toContain("_target_scope = 'session'");
    expect(sql).toContain("COUNT(value_numeric) AS numeric_values");
    expect(sql).toContain("value_numeric < 0.8");
    expect(sql).toContain("AS unhealthy_scores");
    expect(sql).toContain("agent_id = 'agent-1'");
  });

  it("applies categorical and boolean thresholds to the shared unhealthy count", () => {
    const configs: ScoreConfig[] = [
      {
        id: "category-v1",
        entityId: "instruction-following",
        name: "Instruction following",
        version: 1,
        dataType: "categorical",
        healthyThreshold: { healthy_categories: ["high"] },
      },
      {
        id: "boolean-v1",
        entityId: "output-format",
        name: "Output format",
        version: 1,
        dataType: "boolean",
        healthyThreshold: { healthy_value: true },
      },
    ];

    const sql = buildQualityConfigAggSql(configs, null);

    expect(sql).toContain("value_categorical NOT IN ('high')");
    expect(sql).toContain("value_boolean = false");
  });
});

describe("configHealthStatus", () => {
  it.each([
    [0, null, false, "noData", 3],
    [8, null, false, "noThreshold", 2],
    [8, 0, true, "healthy", 1],
    [8, 1, true, "unhealthy", 0],
  ] as const)(
    "maps total=%s unhealthy=%s threshold=%s to %s",
    (total, unhealthy, hasThreshold, status, priority) => {
      expect(configHealthStatus(total, unhealthy, hasThreshold)).toEqual({
        status,
        priority,
      });
    },
  );
});

describe("buildTrendSeries", () => {
  it("fills empty buckets so a single observed period does not render flat", () => {
    const startMs = Date.UTC(2026, 6, 14, 0, 0, 0);
    const rows = [
      {
        score_config_id: "answer-quality",
        bucket: "2026-07-14T00:00:00",
        c: 1,
      },
      {
        score_config_id: "answer-quality",
        bucket: "2026-07-14T12:00:00",
        c: 4,
      },
    ];

    expect(
      buildTrendSeries(
        rows,
        startMs * 1000,
        (startMs + 18 * 3_600_000) * 1000,
        "6 hour",
      ),
    ).toEqual({ "answer-quality": [1, 0, 4, 0] });
  });
});

describe("useQualityScoreConfigs volume trend", () => {
  it("loads the complete histogram with the full-range query path", async () => {
    const startMs = Date.UTC(2026, 6, 14, 0, 0, 0);
    const config: ScoreConfig = {
      id: "version-1",
      entityId: "answer-quality",
      name: "Answer quality",
      version: 1,
      dataType: "numeric",
      healthyThreshold: { direction: "gte", value: 0.8 },
    };
    mockExecuteQuery.mockResolvedValue([]);
    mockExecuteQueryOnce.mockResolvedValue([
      {
        score_config_id: "answer-quality",
        bucket: "2026-07-14T00:00:00",
        c: 1,
      },
      {
        score_config_id: "answer-quality",
        bucket: "2026-07-14T00:10:00",
        c: 4,
      },
    ]);
    const { rows, refresh } = useQualityScoreConfigs(
      ref([config]),
      ref({
        startUs: startMs * 1000,
        endUs: (startMs + 15 * 60_000) * 1000,
      }),
    );

    await refresh();

    expect(mockExecuteQueryOnce).toHaveBeenCalledTimes(1);
    expect(mockExecuteQueryOnce.mock.calls[0][0]).toContain("histogram(");
    expect(mockExecuteQueryOnce.mock.calls[0][0]).toContain(
      "PARTITION BY _score_attempt_key",
    );
    expect(mockExecuteQueryOnce.mock.calls[0][0]).toContain("task_id");
    expect(rows.value[0].trendSparkline).toEqual([1, 0, 4, 0]);
  });
});
