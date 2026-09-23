// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
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
});
