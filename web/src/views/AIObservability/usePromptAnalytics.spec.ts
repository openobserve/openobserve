// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prompt, PromptVersion } from "@/services/llm-prompts.service";

const queryMocks = vi.hoisted(() => ({
  executeQuery: vi.fn().mockResolvedValue([]),
  executeQueryOnce: vi.fn().mockResolvedValue([]),
  cancelAll: vi.fn(),
}));

vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => queryMocks,
}));

import { usePromptAnalytics } from "./usePromptAnalytics";

describe("usePromptAnalytics", () => {
  afterEach(() => {
    queryMocks.executeQuery.mockReset().mockResolvedValue([]);
    queryMocks.executeQueryOnce.mockReset().mockResolvedValue([]);
  });

  it("queries trace streams that do not contain error_type", async () => {
    const prompt = ref({ name: "qa_prompt", entityId: "prompt-1" } as Prompt);
    const version = ref({ version: 2, contentHash: "hash" } as PromptVersion);
    const analytics = usePromptAnalytics(prompt, version, ref("default"), ref("24h"));

    await vi.waitFor(() => expect(queryMocks.executeQuery).toHaveBeenCalledTimes(3));
    const sql = queryMocks.executeQuery.mock.calls.map(([query]) => query).join("\n");

    expect(sql).not.toContain("error_type");
    expect(sql).toContain("span_status = 'ERROR'");
    expect(analytics.error.value).toBeNull();
  });

  it("converts microsecond trace durations to milliseconds", async () => {
    queryMocks.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY")) return [];
      if (sql.includes("COUNT(*) AS calls")) return [{ calls: 1, errors: 0 }];
      return [
        {
          span_id: "span-1",
          trace_id: "trace-1",
          _timestamp: 1790160215949866,
          duration: 9_255_898,
          span_status: "OK",
        },
      ];
    });
    const prompt = ref({ name: "qa_prompt", entityId: "prompt-1" } as Prompt);
    const version = ref({ version: 2, contentHash: "hash" } as PromptVersion);
    const analytics = usePromptAnalytics(prompt, version, ref("default"), ref("24h"));

    await vi.waitFor(() => expect(analytics.recent.value).toHaveLength(1));
    const sql = queryMocks.executeQuery.mock.calls.map(([query]) => query).join("\n");
    expect(sql).toContain("TRY_CAST(duration AS DOUBLE) / 1000.0");
    expect(analytics.recent.value[0].latencyMs).toBe(9255.898);
  });
});
