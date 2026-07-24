// @vitest-environment jsdom

const mockExecuteQuery = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQuery: mockExecuteQuery }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { ScoreConfig } from "@/services/online-evals.service";
import type { QualityScope } from "../utils/qualityScope";
import { useQualityConfigDetail } from "./useQualityConfigDetail";
import { useQualityDetailCharts } from "./useQualityDetailCharts";

const DATE_WINDOW = { startUs: 100, endUs: 200 };

async function flushAsync() {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockExecuteQuery.mockReset();
});

describe("Quality detail scope queries", () => {
  it("scopes every KPI query and refreshes its data when scope changes", async () => {
    mockExecuteQuery.mockImplementation(async (sql: string) => {
      const targets = sql.includes("_target_scope = 'session'") ? 1 : 4;
      if (sql.includes("COUNT(*) AS score_results")) {
        return [{ score_results: targets, targets_scored: targets }];
      }
      return [{ value_categorical: "high", c: targets }];
    });
    const config = ref<ScoreConfig | null>({
      id: "version-1",
      entityId: "instruction-following",
      name: "Instruction following",
      version: 1,
      dataType: "categorical",
      healthyThreshold: { healthy_categories: ["high"] },
    });
    const scope = ref<QualityScope>("trace");
    const detail = useQualityConfigDetail(config, ref(DATE_WINDOW), ref(null), scope);

    await detail.refresh();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    expect(
      mockExecuteQuery.mock.calls.every(([sql]) => sql.includes("_target_scope = 'trace'")),
    ).toBe(true);
    expect(detail.kpis.value.find((kpi) => kpi.id === "targetsScored")?.value).toBe(4);

    mockExecuteQuery.mockClear();
    scope.value = "session";
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    expect(
      mockExecuteQuery.mock.calls.every(([sql]) => sql.includes("_target_scope = 'session'")),
    ).toBe(true);
    expect(detail.kpis.value.find((kpi) => kpi.id === "targetsScored")?.value).toBe(1);
  });

  it("scopes every chart query and refreshes chart data when scope changes", async () => {
    mockExecuteQuery.mockImplementation(async (sql: string) => {
      const value = sql.includes("_target_scope = 'session'") ? 1 : 4;
      if (sql.includes("value_numeric AS v")) return [{ v: value }];
      return [
        {
          bucket: "2026-07-16T00:00:00Z",
          avg_v: value,
          p95_v: value,
        },
      ];
    });
    const config = ref<ScoreConfig | null>({
      id: "version-1",
      entityId: "answer-quality",
      name: "Answer quality",
      version: 1,
      dataType: "numeric",
      numericRange: { min: 0, max: 5 },
    });
    const scope = ref<QualityScope>("trace");
    const charts = useQualityDetailCharts(config, ref(DATE_WINDOW), ref(null), scope);

    await charts.refresh();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    expect(
      mockExecuteQuery.mock.calls.every(([sql]) => sql.includes("_target_scope = 'trace'")),
    ).toBe(true);
    expect(charts.numericTrend.value[0]?.avg).toBe(4);

    mockExecuteQuery.mockClear();
    scope.value = "session";
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    expect(
      mockExecuteQuery.mock.calls.every(([sql]) => sql.includes("_target_scope = 'session'")),
    ).toBe(true);
    expect(charts.numericTrend.value[0]?.avg).toBe(1);
  });
});
